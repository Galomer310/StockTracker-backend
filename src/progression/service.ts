/* ===========================================================================
   Progression service: XP, levels, titles and game achievements.
   ---------------------------------------------------------------------------
   The database side of the system. syncProgression is the one entry point
   that changes a player's progression, and every event calls it: account
   creation, a new portfolio, a profile edit, a title choice, sign-in, the
   card and collection screens, and a periodic sweep for time-based
   achievements (server.ts). It is safe to call any number of times:

   1. It locks the player's progression row, so two syncs for one player run
      one after the other instead of racing.
   2. It evaluates the catalog against the player's current facts
      (evaluate.ts) and grants what is newly met. Each grant is an XP ledger
      row with a unique idempotency key, so a replay inserts nothing.
   3. It recomputes the total from the ledger and the level from the
      configured thresholds (levels.ts), grants every level title up to the
      current tier, and queues one unlock ceremony per newly reached tier.

   awardXp is the shared ledger write, so future sources (professional
   achievements, competitions, daily login) grant XP the same way.
   =========================================================================== */

import { PoolClient } from "pg";
import pool from "../config/db";
import { AchievementDef, evaluate, FoundingPeriod, newlyUnlocked, PlayerFacts } from "./evaluate";
import { levelFor, progressFor, Threshold, tierOfLevel } from "./levels";

export type XpSource = "game_achievement" | "professional_achievement" | "competition" | "daily_login";

export interface SyncResult {
  new_achievements: string[];
  level_before: number;
  level_after: number;
  new_tiers: number[];
}

export class ProgressionError extends Error {
  constructor(public code: "TITLE_NOT_OWNED" | "PLAYER_NOT_FOUND") {
    super(code);
  }
}

const achievementKey = (userId: number, achievementId: string) => `game_achievement:${achievementId}:user:${userId}`;

// Records an XP grant once. Returns the ledger row id, or null when this key
// was already granted (the replay inserts nothing).
export const awardXp = async (
  client: PoolClient,
  grant: { userId: number; sourceType: XpSource; sourceId: string; amount: number; idempotencyKey: string }
): Promise<number | null> => {
  const r = await client.query(
    `INSERT INTO xp_transactions (user_id, source_type, source_id, xp_amount, idempotency_key)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [grant.userId, grant.sourceType, grant.sourceId, grant.amount, grant.idempotencyKey]
  );
  return r.rows[0]?.id ?? null;
};

const loadSettings = async (client: PoolClient) => {
  const r = await client.query("SELECT key, value FROM progression_settings");
  const map = new Map<string, any>(r.rows.map((row) => [row.key, row.value]));
  const founding = map.get("founding_period") ?? {};
  return {
    backfill: map.get("backfill_history") !== false,
    startedAt: map.has("xp_system_started_at") ? new Date(map.get("xp_system_started_at")) : null,
    founding: { start: founding.start ?? null, end: founding.end ?? null } as FoundingPeriod,
  };
};

const loadThresholds = async (client: PoolClient): Promise<Threshold[]> =>
  (await client.query("SELECT level, xp_required, is_provisional FROM level_thresholds")).rows;

const loadDefs = async (client: PoolClient): Promise<AchievementDef[]> =>
  (
    await client.query(
      `SELECT id, category_id, condition_type, target_value, condition_params, prerequisite_ids, xp_reward
       FROM achievements WHERE is_enabled ORDER BY sort_order`
    )
  ).rows;

// What is known about the player. Systems that do not exist yet (follows,
// subscriptions, competitions) are left out, which evaluate.ts reports as
// blocked; their loaders belong here once those tables exist.
const loadFacts = async (client: PoolClient, userId: number, titleSelected: boolean): Promise<PlayerFacts | null> => {
  const user = await client.query("SELECT created_at, nickname, first_name, bio FROM users WHERE id = $1", [userId]);
  const portfolios = await client.query("SELECT created_at, closed_at FROM portfolios WHERE user_id = $1", [userId]);
  if (user.rows.length === 0) return null;
  const u = user.rows[0];
  return {
    created_at: new Date(u.created_at),
    nickname: u.nickname,
    first_name: u.first_name,
    bio: u.bio ?? "",
    portfolios: portfolios.rows.map((p) => ({
      created_at: new Date(p.created_at),
      closed_at: p.closed_at ? new Date(p.closed_at) : null,
    })),
    title_selected: titleSelected,
  };
};

const unlockedIds = async (client: PoolClient, userId: number): Promise<Set<string>> =>
  new Set(
    (await client.query("SELECT achievement_id FROM player_achievements WHERE user_id = $1", [userId])).rows.map(
      (r) => r.achievement_id
    )
  );

const inTransaction = async <T>(work: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

export const syncProgression = (userId: number, now: Date = new Date()): Promise<SyncResult> =>
  inTransaction(async (client) => {
    const created = await client.query(
      "INSERT INTO player_progression (user_id) SELECT id FROM users WHERE id = $1 ON CONFLICT DO NOTHING RETURNING user_id",
      [userId]
    );
    const isFirstSync = created.rows.length > 0;
    const state = await client.query(
      "SELECT level, first_title_selected_at FROM player_progression WHERE user_id = $1 FOR UPDATE",
      [userId]
    );
    if (state.rows.length === 0) throw new ProgressionError("PLAYER_NOT_FOUND");
    const levelBefore: number = state.rows[0].level;

    // One client runs one query at a time, so these are sequential.
    const settings = await loadSettings(client);
    const defs = await loadDefs(client);
    const thresholds = await loadThresholds(client);
    const unlocked = await unlockedIds(client, userId);
    const facts = await loadFacts(client, userId, state.rows[0].first_title_selected_at !== null);
    if (!facts) throw new ProgressionError("PLAYER_NOT_FOUND");

    const fresh = newlyUnlocked({ defs, facts, unlocked, founding: settings.founding, now });

    // With backfill_history off, what an account that predates the XP system
    // had already done is recorded as unlocked but earns no XP, and raises no
    // notice. Only the first sync of such an account is treated this way.
    const silent =
      isFirstSync && !settings.backfill && settings.startedAt !== null && facts.created_at < settings.startedAt;

    const defById = new Map(defs.map((d) => [d.id, d]));
    for (const id of fresh) {
      const def = defById.get(id)!;
      const transactionId = silent
        ? null
        : await awardXp(client, {
            userId,
            sourceType: "game_achievement",
            sourceId: id,
            amount: def.xp_reward,
            idempotencyKey: achievementKey(userId, id),
          });
      await client.query(
        `INSERT INTO player_achievements (user_id, achievement_id, xp_awarded, reward_transaction_id, notified_at)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [userId, id, silent ? 0 : def.xp_reward, transactionId, silent ? now : null]
      );
    }

    const total = Number(
      (await client.query("SELECT COALESCE(SUM(xp_amount), 0) AS total FROM xp_transactions WHERE user_id = $1", [userId]))
        .rows[0].total
    );
    const level = levelFor(total, thresholds);

    // Every level title up to the current tier. Owning a title never depends
    // on the active choice, and a title once granted is never taken away.
    const granted = await client.query(
      `INSERT INTO player_titles (user_id, title_id, source)
       SELECT $1, id, 'level' FROM titles
       WHERE source_type = 'level' AND is_enabled AND tier <= $2
       ON CONFLICT DO NOTHING
       RETURNING (SELECT tier FROM titles t WHERE t.id = title_id) AS tier`,
      [userId, tierOfLevel(level)]
    );
    const newTiers = [...new Set<number>(granted.rows.map((r) => r.tier))].sort((a, b) => a - b);
    for (const tier of newTiers) {
      await client.query("INSERT INTO title_ceremonies (user_id, tier) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
        userId,
        tier,
      ]);
    }

    await client.query(
      "UPDATE player_progression SET total_xp = $2, level = $3, updated_at = NOW() WHERE user_id = $1",
      [userId, total, level]
    );

    return { new_achievements: silent ? [] : fresh, level_before: levelBefore, level_after: level, new_tiers: newTiers };
  });

// For event hooks: progression must never make the action that triggered it
// fail. A failed sync is logged and caught up by the next one.
export const syncProgressionSafely = async (userId: number): Promise<void> => {
  try {
    await syncProgression(userId);
  } catch (error) {
    console.error(`[progression] sync failed for user ${userId}:`, error);
  }
};

// Makes an owned title the active one. Ownership is checked in the same
// transaction as the write, so a locked or unknown title can never be set.
export const selectTitle = async (userId: number, titleId: string): Promise<void> => {
  await syncProgression(userId);
  await inTransaction(async (client) => {
    const owned = await client.query(
      `SELECT 1 FROM player_titles pt JOIN titles t ON t.id = pt.title_id
       WHERE pt.user_id = $1 AND pt.title_id = $2 AND t.is_enabled`,
      [userId, titleId]
    );
    if (owned.rows.length === 0) throw new ProgressionError("TITLE_NOT_OWNED");
    await client.query(
      `UPDATE player_progression
       SET active_title_id = $2, first_title_selected_at = COALESCE(first_title_selected_at, NOW()), updated_at = NOW()
       WHERE user_id = $1`,
      [userId, titleId]
    );
  });
  // Choosing a title for the first time is itself an achievement.
  await syncProgression(userId);
};

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

const TITLE_COLUMNS = `t.id, t.name, t.category, t.source_type, t.required_level, t.tier, t.icon,
                       t.accent_color, t.sort_order, t.rarity`;

export interface TitleView {
  id: string;
  name: string;
  category: string;
  source_type: "level" | "special" | "store";
  required_level: number | null;
  tier: number | null;
  icon: string;
  accent_color: string;
  sort_order: number;
  rarity: string | null;
}

const RARITY_RANK: Record<string, number> = { basic: 1, advanced: 2, rare: 3, epic: 4, exceptional: 5 };

const isoDate = (d: Date | string): string => new Date(d).toISOString().slice(0, 10);

// What the Player Card shows about progression. Reads only: the caller syncs first.
export const cardProgression = async (userId: number) => {
  const client = await pool.connect();
  try {
    // One client runs one query at a time, so these are sequential.
    const state = await client.query(
      `SELECT pp.total_xp, ${TITLE_COLUMNS}
       FROM player_progression pp LEFT JOIN titles t ON t.id = pp.active_title_id
       WHERE pp.user_id = $1`,
      [userId]
    );
    const thresholds = await loadThresholds(client);
    // The card's four: highest reward first, then most recent.
    const top = await client.query(
      `SELECT a.id, a.category_id, a.title_en, a.title_he, a.description_en, a.description_he, a.rarity,
              a.icon, c.icon AS category_icon, c.accent_color, pa.xp_awarded, pa.unlocked_at
       FROM player_achievements pa
       JOIN achievements a ON a.id = pa.achievement_id
       JOIN achievement_categories c ON c.id = a.category_id
       WHERE pa.user_id = $1
       ORDER BY pa.xp_awarded DESC, pa.unlocked_at DESC, a.sort_order
       LIMIT 4`,
      [userId]
    );
    const totals = await client.query("SELECT COUNT(*)::int AS n FROM player_achievements WHERE user_id = $1", [
      userId,
    ]);
    const row = state.rows[0];
    const xp = row ? Number(row.total_xp) : 0;
    return {
      progress: progressFor(xp, thresholds),
      active_title: row?.id ? (titleOf(row) as TitleView) : null,
      achievements: {
        total: totals.rows[0].n as number,
        top: top.rows.map((a) => ({
          id: a.id,
          art: a.icon ?? a.category_icon,
          category: a.category_id,
          accent_color: a.accent_color,
          rarity: a.rarity,
          name: { en: a.title_en, he: a.title_he },
          description: { en: a.description_en, he: a.description_he },
          condition: { en: a.description_en, he: a.description_he },
          rank: RARITY_RANK[a.rarity] ?? 1,
          xp: a.xp_awarded,
          earned_at: isoDate(a.unlocked_at),
        })),
      },
    };
  } finally {
    client.release();
  }
};

const titleOf = (row: any): TitleView => ({
  id: row.id,
  name: row.name,
  category: row.category,
  source_type: row.source_type,
  required_level: row.required_level,
  tier: row.tier,
  icon: row.icon,
  accent_color: row.accent_color,
  sort_order: row.sort_order,
  rarity: row.rarity,
});

// The title collection: every enabled level title, plus special or store
// titles the player owns, each marked owned or not.
export const titlesView = async (userId: number) => {
  const [state, titles] = await Promise.all([
    pool.query("SELECT level, active_title_id FROM player_progression WHERE user_id = $1", [userId]),
    pool.query(
      `SELECT ${TITLE_COLUMNS}, pt.unlocked_at
       FROM titles t LEFT JOIN player_titles pt ON pt.title_id = t.id AND pt.user_id = $1
       WHERE t.is_enabled AND (t.source_type = 'level' OR pt.user_id IS NOT NULL)
       ORDER BY t.sort_order`,
      [userId]
    ),
  ]);
  return {
    level: state.rows[0]?.level ?? 1,
    active_title_id: state.rows[0]?.active_title_id ?? null,
    titles: titles.rows.map((row) => ({
      ...titleOf(row),
      unlocked: row.unlocked_at !== null,
      unlocked_at: row.unlocked_at ? new Date(row.unlocked_at).toISOString() : null,
    })),
  };
};

// The achievement collection: every enabled achievement with its state and
// progress for this player, and per-category counts.
export const achievementsView = async (userId: number, now: Date = new Date()) => {
  const client = await pool.connect();
  try {
    const state = await client.query("SELECT first_title_selected_at FROM player_progression WHERE user_id = $1", [
      userId,
    ]);
    const settings = await loadSettings(client);
    const categories = await client.query(
      "SELECT id, name_en, name_he, icon, accent_color FROM achievement_categories ORDER BY sort_order"
    );
    const catalog = await client.query(
      `SELECT id, category_id, title_en, title_he, description_en, description_he, condition_type, target_value,
              condition_params, prerequisite_ids, xp_reward, rarity, icon
       FROM achievements WHERE is_enabled ORDER BY sort_order`
    );
    const mine = await client.query(
      "SELECT achievement_id, unlocked_at, xp_awarded FROM player_achievements WHERE user_id = $1",
      [userId]
    );
    const facts = await loadFacts(client, userId, state.rows[0]?.first_title_selected_at != null);
    if (!facts) throw new ProgressionError("PLAYER_NOT_FOUND");

    const earned = new Map<string, any>(mine.rows.map((r) => [r.achievement_id, r]));
    const unlocked = new Set(earned.keys());
    const defs: AchievementDef[] = catalog.rows;
    const ctx = { defs, facts, unlocked, founding: settings.founding, now };

    const achievements = catalog.rows.map((a) => {
      const mineRow = earned.get(a.id);
      const result = evaluate(a, ctx);
      const progress = mineRow && result.progress ? { ...result.progress, current: result.progress.target } : result.progress;
      return {
        id: a.id,
        category_id: a.category_id,
        name: { en: a.title_en, he: a.title_he },
        description: { en: a.description_en, he: a.description_he },
        xp_reward: a.xp_reward,
        rarity: a.rarity,
        icon: a.icon,
        state: mineRow ? "unlocked" : progress && progress.current > 0 ? "in_progress" : "locked",
        progress,
        blocked_by: mineRow ? [] : result.blocked_by,
        unlocked_at: mineRow ? new Date(mineRow.unlocked_at).toISOString() : null,
        xp_awarded: mineRow ? mineRow.xp_awarded : null,
      };
    });

    return {
      totals: {
        total: achievements.length,
        unlocked: achievements.filter((a) => a.state === "unlocked").length,
        xp_earned: achievements.reduce((sum, a) => sum + (a.xp_awarded ?? 0), 0),
      },
      categories: categories.rows.map((c) => {
        const inCategory = achievements.filter((a) => a.category_id === c.id);
        return {
          id: c.id,
          name: { en: c.name_en, he: c.name_he },
          icon: c.icon,
          accent_color: c.accent_color,
          total: inCategory.length,
          unlocked: inCategory.filter((a) => a.state === "unlocked").length,
        };
      }),
      achievements,
    };
  } finally {
    client.release();
  }
};

// Unseen unlock notices and the pending title ceremony. When several tiers
// were crossed at once, the ceremony offers the highest tier's three titles;
// the lower tiers' titles are already in the collection, and acknowledging
// closes every pending ceremony up to that tier, so none is shown twice.
export const notificationsView = async (userId: number) => {
  const [achievements, ceremonies, state] = await Promise.all([
    pool.query(
      `SELECT a.id, a.category_id, a.title_en, a.title_he, a.rarity, a.icon, c.icon AS category_icon, c.accent_color,
              pa.xp_awarded, pa.unlocked_at
       FROM player_achievements pa
       JOIN achievements a ON a.id = pa.achievement_id
       JOIN achievement_categories c ON c.id = a.category_id
       WHERE pa.user_id = $1 AND pa.notified_at IS NULL
       ORDER BY pa.unlocked_at, a.sort_order`,
      [userId]
    ),
    pool.query(
      "SELECT tier FROM title_ceremonies WHERE user_id = $1 AND acknowledged_at IS NULL ORDER BY tier",
      [userId]
    ),
    pool.query("SELECT active_title_id FROM player_progression WHERE user_id = $1", [userId]),
  ]);
  const pendingTiers: number[] = ceremonies.rows.map((r) => r.tier);
  const tier = pendingTiers.length ? pendingTiers[pendingTiers.length - 1] : null;
  const titles = tier
    ? (
        await pool.query(
          `SELECT ${TITLE_COLUMNS} FROM titles t WHERE t.source_type = 'level' AND t.tier = $1 AND t.is_enabled
           ORDER BY t.sort_order`,
          [tier]
        )
      ).rows.map(titleOf)
    : [];
  return {
    achievements: achievements.rows.map((a) => ({
      id: a.id,
      category_id: a.category_id,
      name: { en: a.title_en, he: a.title_he },
      rarity: a.rarity,
      icon: a.icon ?? a.category_icon,
      accent_color: a.accent_color,
      xp_awarded: a.xp_awarded,
      unlocked_at: new Date(a.unlocked_at).toISOString(),
    })),
    ceremony: tier ? { tier, titles, pending_tiers: pendingTiers } : null,
    // Lets the ceremony offer "keep my current title" only when there is one.
    active_title_id: (state.rows[0]?.active_title_id ?? null) as string | null,
  };
};

export const acknowledge = async (
  userId: number,
  ack: { achievement_ids: string[]; ceremony_tier: number | null }
): Promise<void> => {
  if (ack.achievement_ids.length) {
    await pool.query(
      `UPDATE player_achievements SET notified_at = NOW()
       WHERE user_id = $1 AND achievement_id = ANY($2) AND notified_at IS NULL`,
      [userId, ack.achievement_ids]
    );
  }
  if (ack.ceremony_tier !== null) {
    await pool.query(
      `UPDATE title_ceremonies SET acknowledged_at = NOW()
       WHERE user_id = $1 AND tier <= $2 AND acknowledged_at IS NULL`,
      [userId, ack.ceremony_tier]
    );
  }
};

// Re-evaluates every player, for achievements that become due with time
// (portfolio age) when nobody is signed in to trigger a sync. Sequential and
// gentle: the user count is small and each sync is a handful of queries.
export const sweepAll = async (): Promise<void> => {
  const users = await pool.query("SELECT id FROM users ORDER BY id");
  for (const { id } of users.rows) await syncProgressionSafely(id);
};
