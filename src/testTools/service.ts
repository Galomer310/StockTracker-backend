import { randomUUID } from "crypto";
import pool from "../config/db";
import { levelFor } from "../progression/levels";
import { awardXp, cardProgression, syncProgression } from "../progression/service";
import { runValuationJob } from "../performance/service";
import { checkIn, rewardsView } from "../rewards/service";
import { DEFAULT_TIMEZONE, localDate } from "../rewards/schedule";

/* ===========================================================================
   The test player's tools (decided by Gal 2026-11-09).
   ---------------------------------------------------------------------------
   One dedicated account - its email listed in TEST_PLAYER_EMAILS - can jump
   through the game to check that everything behaves as specified: streak
   days, XP and levels, title ceremonies, achievement notices, the username
   lock, the valuation job. Everyone else gets 403 from every route.

   The tools go through the real code paths wherever there is one (the
   daily check-in, syncProgression), so what the tester sees is what a
   player would see. Everyone else gets 404 from every tool route (see
   routes/testToolsRoutes.ts). The test account is hidden from other players'
   leaderboard and feed (users.is_tester), and two resets take it back:
   progress only, or all the way to a new player.
   =========================================================================== */

/** Lower-cased emails of the test accounts, from TEST_PLAYER_EMAILS (comma separated). */
export const testerEmails = (): string[] =>
  (process.env.TEST_PLAYER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export const isTester = async (userId: number): Promise<boolean> => {
  const emails = testerEmails();
  if (emails.length === 0) return false;
  const r = await pool.query("SELECT lower(email) AS email, is_tester FROM users WHERE id = $1", [userId]);
  const tester = !!r.rows[0] && emails.includes(r.rows[0].email);
  // An account registered after the server started is marked on its first use.
  if (tester && !r.rows[0].is_tester) await pool.query("UPDATE users SET is_tester = TRUE WHERE id = $1", [userId]);
  return tester;
};

/** Marks exactly the listed accounts as testers (run at startup). */
export const syncTesterFlags = async () => {
  const emails = testerEmails();
  const r = await pool.query(
    "UPDATE users SET is_tester = (lower(email) = ANY($1::text[])) WHERE is_tester <> (lower(email) = ANY($1::text[])) RETURNING id, is_tester",
    [emails]
  );
  return r.rowCount ?? 0;
};

const timeZone = async () => {
  const r = await pool.query("SELECT value FROM progression_settings WHERE key = 'rewards_timezone'");
  return typeof r.rows[0]?.value === "string" ? r.rows[0].value : DEFAULT_TIMEZONE;
};

export class ToolError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Daily rewards
// ---------------------------------------------------------------------------

/**
 * Moves the account's whole daily-reward record back by `days` calendar
 * days - login dates, capital reward dates, the daily XP's keys, the streak's
 * last date - as if that much time had passed. Today becomes free, so the
 * next check-in counts a new day through the real code.
 */
const shiftDailyRecord = async (userId: number, days: number) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT 1 FROM daily_login_state WHERE user_id = $1 FOR UPDATE", [userId]);
    // Two steps through a far-off date, so no row collides with another
    // while its neighbours are still being moved.
    for (const table of ["daily_logins", "capital_rewards"]) {
      await client.query(`UPDATE ${table} SET login_date = login_date + 36500 WHERE user_id = $1`, [userId]);
      await client.query(`UPDATE ${table} SET login_date = login_date - 36500 - $2::int WHERE user_id = $1`, [userId, days]);
    }
    await client.query(
      `UPDATE xp_transactions SET idempotency_key = 'shifting:' || id
       WHERE id IN (SELECT xp_transaction_id FROM daily_logins WHERE user_id = $1 AND xp_transaction_id IS NOT NULL)`,
      [userId]
    );
    await client.query(
      `UPDATE xp_transactions x
       SET idempotency_key = 'daily_login:' || d.user_id || ':' || to_char(d.login_date, 'YYYY-MM-DD'),
           source_id = to_char(d.login_date, 'YYYY-MM-DD')
       FROM daily_logins d WHERE d.user_id = $1 AND d.xp_transaction_id = x.id`,
      [userId]
    );
    await client.query("UPDATE daily_login_state SET last_login_date = last_login_date - $2::int WHERE user_id = $1", [userId, days]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

/** Tomorrow: one day passes, then the app opens. The streak continues. */
export const nextDay = async (userId: number) => {
  await checkIn(userId); // make sure today is counted before moving on
  await shiftDailyRecord(userId, 1);
  await checkIn(userId);
  return rewardsView(userId);
};

/** Today becomes streak day `day` (1-1000): yesterday was day - 1. */
export const jumpToStreakDay = async (userId: number, day: number) => {
  if (!Number.isInteger(day) || day < 1 || day > 1000) throw new ToolError(400, "INVALID_DAY", "Choose a streak day from 1 to 1000.");
  await checkIn(userId);
  await shiftDailyRecord(userId, 1);
  const today = localDate(new Date(), await timeZone());
  await pool.query(
    `INSERT INTO daily_login_state (user_id, current_streak, last_login_date) VALUES ($1, $2, $3::date - 1)
     ON CONFLICT (user_id) DO UPDATE SET current_streak = EXCLUDED.current_streak, last_login_date = EXCLUDED.last_login_date`,
    [userId, day - 1, today]
  );
  await checkIn(userId);
  return rewardsView(userId);
};

/** A missed day: two days pass, so the next check-in restarts the streak. */
export const missADay = async (userId: number) => {
  await checkIn(userId);
  await shiftDailyRecord(userId, 2);
  await checkIn(userId);
  return rewardsView(userId);
};

// ---------------------------------------------------------------------------
// XP, levels and titles
// ---------------------------------------------------------------------------

const MAX_TEST_XP = 1_000_000;

/** Test XP, in the ledger as source 'test' so it can be told apart. */
export const addXp = async (userId: number, amount: number) => {
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_TEST_XP) {
    throw new ToolError(400, "INVALID_AMOUNT", `Add between 1 and ${MAX_TEST_XP} XP.`);
  }
  const client = await pool.connect();
  try {
    await awardXp(client, { userId, sourceType: "test", sourceId: "test_tools", amount, idempotencyKey: `test:${userId}:${randomUUID()}` });
  } finally {
    client.release();
  }
  await syncProgression(userId);
  return cardProgression(userId);
};

/** Adds exactly the XP needed to reach `level`. Levels only go up this way. */
export const raiseToLevel = async (userId: number, level: number) => {
  const thresholds = (await pool.query("SELECT level, xp_required FROM level_thresholds")).rows;
  if (thresholds.length === 0) throw new ToolError(409, "NO_THRESHOLDS", "No level thresholds are configured, so levels cannot change.");
  const target = thresholds.find((t) => t.level === level);
  if (!target) throw new ToolError(400, "INVALID_LEVEL", "Choose a level from 2 to 100.");
  const total = Number((await pool.query("SELECT COALESCE(SUM(xp_amount), 0) AS t FROM xp_transactions WHERE user_id = $1", [userId])).rows[0].t);
  if (levelFor(total, thresholds) >= level) throw new ToolError(409, "ALREADY_THERE", "The account is already at or above that level.");
  return addXp(userId, target.xp_required - total);
};

/** Opens every title ceremony again, as if each tier had just been reached. */
export const replayCeremonies = async (userId: number) => {
  await pool.query("UPDATE title_ceremonies SET acknowledged_at = NULL WHERE user_id = $1", [userId]);
  return { ok: true };
};

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

/** Shows every unlocked achievement's notice again. */
export const replayAchievementNotices = async (userId: number) => {
  const r = await pool.query("UPDATE player_achievements SET notified_at = NULL WHERE user_id = $1", [userId]);
  return { notices: r.rowCount ?? 0 };
};

/** Forgets every game achievement and its XP, then lets them unlock again from what the account has done. */
export const resetAchievements = async (userId: number) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM player_achievements WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM xp_transactions WHERE user_id = $1 AND source_type = 'game_achievement'", [userId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  await syncProgression(userId);
  const n = await pool.query("SELECT COUNT(*)::int AS n FROM player_achievements WHERE user_id = $1", [userId]);
  return { unlocked_again: n.rows[0].n };
};

// ---------------------------------------------------------------------------
// Limits and resets
// ---------------------------------------------------------------------------

export const resetUsernameLock = async (userId: number) => {
  await pool.query("UPDATE users SET nickname_changed_at = NULL WHERE id = $1", [userId]);
  await pool.query("DELETE FROM nickname_holds WHERE user_id = $1", [userId]);
  return { ok: true };
};

export const runValuationNow = async () => {
  const out = await runValuationJob();
  if (!out) return { already_running: true };
  return {
    symbols: out.prices.length,
    failed: out.prices.filter((p) => p.error).map((p) => ({ symbol: p.symbol, error: p.error })),
    portfolios: out.rebuilt.length,
    inconsistent: out.rebuilt.filter((r) => r && !r.consistent).length,
  };
};

/**
 * Progress only: XP, level, titles, ceremonies, achievements, the streak and
 * every daily login, and capital rewards - taking the cash they added back
 * out of the portfolios. The profile, username and portfolios stay.
 */
export const resetProgress = async (userId: number) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Take added capital back out, portfolio by portfolio.
    await client.query(
      `UPDATE portfolios p SET cash = p.cash - a.added, capital_base = NULL
       FROM (SELECT portfolio_id, SUM(cash_after - cash_before) AS added FROM capital_adjustments
             WHERE user_id = $1 GROUP BY portfolio_id) a
       WHERE p.id = a.portfolio_id`,
      [userId]
    );
    for (const sql of [
      "DELETE FROM capital_rewards WHERE user_id = $1", // cascades to capital_adjustments
      "DELETE FROM daily_logins WHERE user_id = $1",
      "DELETE FROM daily_login_state WHERE user_id = $1",
      "DELETE FROM player_achievements WHERE user_id = $1",
      "DELETE FROM player_titles WHERE user_id = $1",
      "DELETE FROM title_ceremonies WHERE user_id = $1",
      "DELETE FROM xp_transactions WHERE user_id = $1",
      "DELETE FROM player_progression WHERE user_id = $1",
    ]) {
      await client.query(sql, [userId]);
    }
    await client.query("COMMIT");
  } catch (error: any) {
    await client.query("ROLLBACK").catch(() => undefined);
    // Cash can never go below zero: the added capital was already invested.
    if (error?.code === "23514") {
      throw new ToolError(409, "CAPITAL_INVESTED", "The added capital is already invested. Sell enough to cover it, or reset to a new player.");
    }
    throw error;
  } finally {
    client.release();
  }
  return { ok: true };
};

/** Back to a brand-new player: progress, profile, username and every portfolio. */
export const resetToNewPlayer = async (userId: number) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Portfolios first: their capital goes with them, so nothing needs taking back.
    await client.query("DELETE FROM capital_rewards WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM portfolios WHERE user_id = $1", [userId]); // trades, holdings and history cascade
    await client.query("DELETE FROM trade_notes WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM nickname_holds WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM follows WHERE follower_id = $1 OR followee_id = $1", [userId]);
    await client.query(
      `UPDATE users SET nickname = NULL, nickname_changed_at = NULL, first_name = NULL, bio = '', avatar_id = NULL, avatar_url = NULL
       WHERE id = $1`,
      [userId]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  await resetProgress(userId);
  return { ok: true };
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export const testerState = async (userId: number) => {
  const [user, xp, ach, notices, ceremonies, portfolios, thresholds] = await Promise.all([
    pool.query("SELECT email, nickname, nickname_changed_at FROM users WHERE id = $1", [userId]),
    pool.query(
      "SELECT COALESCE(SUM(xp_amount), 0)::int AS total, COALESCE(SUM(xp_amount) FILTER (WHERE source_type = 'test'), 0)::int AS test FROM xp_transactions WHERE user_id = $1",
      [userId]
    ),
    pool.query("SELECT COUNT(*)::int AS n FROM player_achievements WHERE user_id = $1", [userId]),
    pool.query("SELECT COUNT(*)::int AS n FROM player_achievements WHERE user_id = $1 AND notified_at IS NULL", [userId]),
    pool.query("SELECT COUNT(*)::int AS n FROM title_ceremonies WHERE user_id = $1 AND acknowledged_at IS NULL", [userId]),
    pool.query("SELECT COUNT(*)::int AS n FROM portfolios WHERE user_id = $1", [userId]),
    pool.query("SELECT COUNT(*)::int AS n FROM level_thresholds"),
  ]);
  const progression = await cardProgression(userId).catch(() => null);
  return {
    email: user.rows[0]?.email,
    nickname: user.rows[0]?.nickname ?? null,
    nickname_locked: !!user.rows[0]?.nickname_changed_at,
    xp: { total: xp.rows[0].total, from_tests: xp.rows[0].test },
    level: progression ? progression.progress.level : null,
    thresholds_configured: thresholds.rows[0].n > 0,
    achievements: { unlocked: ach.rows[0].n, notices_pending: notices.rows[0].n },
    ceremonies_pending: ceremonies.rows[0].n,
    portfolios: portfolios.rows[0].n,
    daily: await rewardsView(userId),
  };
};
