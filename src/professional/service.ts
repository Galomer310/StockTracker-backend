import pool from "../config/db";
import { localDate } from "../metrics/calendar";
import { loadBenchmark } from "../performance/service";
import { awardXp, syncProgressionSafely } from "../progression/service";
import type { Award } from "../services/playerCard";
import { evaluatePortfolio, PortfolioEvaluation, ProRecord } from "./engine";
import { autoOrder, computeMedals, DEFAULT_MEDAL_TIERS, MedalState, MedalTiers } from "./medals";
import { computeRare, DEFAULT_FIVE_STAR_MEDALS, levelReachedDates, RarePlayer, SPECIAL_MEDALS } from "./rare";

/* ===========================================================================
   Professional achievements and medals, stage 2: the database side.
   ---------------------------------------------------------------------------
   runProfessionalEvaluation(), after every valuation run:
     1. each portfolio whose history matches its live state is evaluated
        (engine.ts) up to the last date that is final for it AND for the
        benchmark;
     2. new records are inserted (never updated or deleted), the evidence
        and the 30-day windows are stored;
     3. each player's medals are recomputed (medals.ts); a tier only goes
        up, and every unlock or upgrade is logged for its notice;
     4. configured XP is granted to every record that has none yet
        (none is configured today: Gal decides the amounts).
   =========================================================================== */

const dateText = (d: Date | string): string => {
  if (typeof d === "string") return d.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const loadMedalTiers = async (): Promise<MedalTiers> => {
  const r = await pool.query("SELECT value FROM progression_settings WHERE key = 'medal_tiers'");
  return { ...DEFAULT_MEDAL_TIERS, ...(r.rows[0]?.value ?? {}) };
};

/** One portfolio: evaluate and store. Null when its history cannot be trusted yet. */
export const evaluateAndStore = async (portfolioId: number) => {
  const p = (
    await pool.query(
      `SELECT p.id, p.user_id, p.name, p.created_at, s.consistent, s.final_through
       FROM portfolios p LEFT JOIN portfolio_history_status s ON s.portfolio_id = p.id WHERE p.id = $1`,
      [portfolioId]
    )
  ).rows[0];
  // Nothing is awarded from a record that does not match the live portfolio.
  if (!p || !p.consistent || !p.final_through) return null;

  const benchmark = await loadBenchmark();
  const [daysR, closesR, covR] = await Promise.all([
    pool.query("SELECT date, perf_index FROM portfolio_daily_values WHERE portfolio_id = $1 ORDER BY date", [portfolioId]),
    pool.query("SELECT date, close FROM daily_prices WHERE symbol = $1 ORDER BY date", [benchmark.symbol]),
    pool.query("SELECT checked_through FROM price_coverage WHERE symbol = $1", [benchmark.symbol]),
  ]);
  const benchThrough = covR.rows[0] ? dateText(covR.rows[0].checked_through) : null;
  const portfolioThrough = dateText(p.final_through);
  // Final for both the portfolio and the benchmark: the earlier of the two.
  const finalThrough = benchThrough === null ? null : benchThrough < portfolioThrough ? benchThrough : portfolioThrough;

  const evaluation = evaluatePortfolio({
    openedOn: localDate(new Date(p.created_at)),
    days: daysR.rows.map((r) => ({ date: dateText(r.date), index: r.perf_index === null ? null : Number(r.perf_index) })),
    benchmark: closesR.rows.map((r) => ({ date: dateText(r.date), close: Number(r.close) })),
    finalThrough,
  });

  const client = await pool.connect();
  let inserted: number[] = [];
  try {
    await client.query("BEGIN");
    for (const rec of evaluation.records) {
      const r = await client.query(
        `INSERT INTO player_professional_achievements
           (user_id, achievement_id, portfolio_id, portfolio_name, period_id, earned_on, qualifying_value, benchmark_value, outperformance, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (achievement_id, portfolio_id, period_id) WHERE portfolio_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [p.user_id, rec.achievement_id, p.id, p.name, rec.period_id, rec.earned_on, rec.qualifying_value, rec.benchmark_value, rec.outperformance, rec.details]
      );
      if (r.rows[0]) inserted.push(r.rows[0].id);
    }
    await client.query("DELETE FROM return_qualification_windows WHERE portfolio_id = $1", [p.id]);
    for (const w of evaluation.windows) {
      await client.query(
        `INSERT INTO return_qualification_windows
           (portfolio_id, threshold, start_date, day30, grace_until, best_streak, seven_met, day30_result, status, closed_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING`,
        [p.id, w.threshold, w.start, w.day30, w.grace_until, w.best_streak, w.seven_met, w.day30_result, w.status, w.closed_on]
      );
    }
    await client.query(
      `INSERT INTO professional_evaluations (portfolio_id, final_through, evaluation, evaluated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (portfolio_id) DO UPDATE SET final_through = EXCLUDED.final_through, evaluation = EXCLUDED.evaluation, evaluated_at = NOW()`,
      [p.id, finalThrough, JSON.stringify({ ...evaluation, records: undefined, windows: undefined })]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    inserted = [];
    throw error;
  } finally {
    client.release();
  }
  return { portfolioId: p.id, userId: p.user_id as number, finalThrough, new_records: inserted.length };
};

/** Recomputes one player's medals from every evaluated portfolio. Tiers never go down. */
export const updateMedals = async (userId: number, tiers?: MedalTiers) => {
  const [evalR, retR] = await Promise.all([
    pool.query(
      `SELECT e.portfolio_id, e.evaluation FROM professional_evaluations e
       JOIN portfolios p ON p.id = e.portfolio_id WHERE p.user_id = $1`,
      [userId]
    ),
    // The return medal is built from the permanent records, not the latest run.
    pool.query(
      `SELECT portfolio_id, period_id, earned_on FROM player_professional_achievements
       WHERE user_id = $1 AND achievement_id = 'portfolio_return'`,
      [userId]
    ),
  ]);
  const returns = new Map<number, ProRecord[]>();
  for (const r of retR.rows) {
    const list = returns.get(r.portfolio_id) ?? [];
    list.push({ achievement_id: "portfolio_return", period_id: r.period_id, earned_on: dateText(r.earned_on), qualifying_value: null, benchmark_value: null, outperformance: null, details: {} });
    returns.set(r.portfolio_id, list);
  }
  const ids = new Set<number>([...evalR.rows.map((r) => r.portfolio_id), ...returns.keys()]);
  const byId = new Map(evalR.rows.map((r) => [r.portfolio_id, r.evaluation as PortfolioEvaluation]));
  const blank: PortfolioEvaluation = evaluatePortfolio({ openedOn: "2000-01-01", days: [], benchmark: [], finalThrough: null });
  const medals = computeMedals(
    [...ids].map((id) => ({ id, evaluation: { ...(byId.get(id) ?? blank), records: returns.get(id) ?? [] } })),
    tiers ?? (await loadMedalTiers())
  );

  const changes: { medal_id: string; period_key: string; tier: number; decoration: number }[] = [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const m of medals) {
      const cur = (
        await client.query(
          "SELECT highest_tier, decoration FROM player_medals WHERE user_id = $1 AND medal_id = $2 AND period_key = $3 FOR UPDATE",
          [userId, m.medal_id, m.period_key]
        )
      ).rows[0];
      const upgraded = !cur || m.tier > cur.highest_tier || (m.tier === cur.highest_tier && m.decoration > cur.decoration);
      if (!cur) {
        await client.query(
          `INSERT INTO player_medals (user_id, medal_id, period_key, current_tier, highest_tier, decoration, relevant_portfolio_id,
             relevant_period, qualifying_value, highest_streak, current_streak, subtitle, as_of)
           VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [userId, m.medal_id, m.period_key, m.tier, m.decoration, m.portfolio_id, m.relevant_period, m.qualifying_value, m.highest_streak, m.current_streak, m.subtitle, m.as_of]
        );
      } else if (upgraded) {
        await client.query(
          `UPDATE player_medals SET current_tier = $4, highest_tier = $4, decoration = $5, relevant_portfolio_id = $6,
             relevant_period = $7, qualifying_value = $8, highest_streak = $9, current_streak = $10, subtitle = $11, as_of = $12,
             last_upgraded_at = NOW()
           WHERE user_id = $1 AND medal_id = $2 AND period_key = $3`,
          [userId, m.medal_id, m.period_key, m.tier, m.decoration, m.portfolio_id, m.relevant_period, m.qualifying_value, m.highest_streak, m.current_streak, m.subtitle, m.as_of]
        );
      } else {
        // Same tier: the live figures move (an active streak can break; the
        // quarterly COMBO line follows it) but the earned tier stays.
        await client.query(
          `UPDATE player_medals SET current_streak = $4,
             subtitle = CASE WHEN medal_id = 'btm_quarterly' THEN $5 ELSE subtitle END
           WHERE user_id = $1 AND medal_id = $2 AND period_key = $3`,
          [userId, m.medal_id, m.period_key, m.current_streak, m.subtitle]
        );
      }
      if (upgraded) {
        await client.query(
          "INSERT INTO player_medal_events (user_id, medal_id, period_key, tier, decoration) VALUES ($1, $2, $3, $4, $5)",
          [userId, m.medal_id, m.period_key, m.tier, m.decoration]
        );
        changes.push({ medal_id: m.medal_id, period_key: m.period_key, tier: m.tier, decoration: m.decoration });
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return changes;
};

/** Platform-unique achievements: at most one player ever (27.2, 27.3). */
const PLATFORM_UNIQUE = ["first_to_beat_market", "first_to_level_25", "first_to_level_50", "first_to_level_100"];

/**
 * Stage 4: the player-level rare achievements and their special medals,
 * from the permanent records, the medals and the XP ledger.
 */
export const evaluateRare = async () => {
  const [users, recs, firsts, gold, ledger, thresholds, taken, setting] = await Promise.all([
    pool.query("SELECT id, is_tester FROM users ORDER BY id"),
    pool.query(
      `SELECT user_id, portfolio_id, achievement_id, period_id, earned_on, outperformance
       FROM player_professional_achievements
       WHERE portfolio_id IS NOT NULL AND (achievement_id IN ('btm_month', 'btm_quarter', 'btm_year')
         OR (achievement_id = 'portfolio_return' AND period_id = '100'))`
    ),
    pool.query(
      `SELECT user_id, portfolio_id, MIN(earned_on) AS first FROM player_professional_achievements
       WHERE portfolio_id IS NOT NULL GROUP BY user_id, portfolio_id`
    ),
    pool.query(
      `SELECT user_id, medal_id, MIN(happened_at) AS at FROM player_medal_events
       WHERE tier >= 3 AND medal_id NOT LIKE 'special_%' GROUP BY user_id, medal_id`
    ),
    pool.query("SELECT user_id, awarded_at, xp_amount FROM xp_transactions ORDER BY awarded_at, id"),
    pool.query("SELECT level, xp_required FROM level_thresholds"),
    pool.query("SELECT DISTINCT achievement_id FROM player_professional_achievements WHERE achievement_id = ANY($1::text[])", [PLATFORM_UNIQUE]),
    pool.query("SELECT value FROM progression_settings WHERE key = 'five_star_medals'"),
  ]);
  const players = new Map<number, RarePlayer>(
    users.rows.map((u) => [u.id, { user_id: u.id, is_tester: u.is_tester, btm: [], quarters: [], return100: [], portfolios: [], gold: [], level_reached: {} }])
  );
  for (const r of recs.rows) {
    const p = players.get(r.user_id);
    if (!p) continue;
    const on = dateText(r.earned_on);
    if (r.achievement_id === "portfolio_return") p.return100.push({ portfolio_id: r.portfolio_id, earned_on: on });
    else {
      p.btm.push({ portfolio_id: r.portfolio_id, achievement_id: r.achievement_id, period_id: r.period_id, earned_on: on, outperformance: Number(r.outperformance) });
      if (r.achievement_id === "btm_quarter") p.quarters.push({ portfolio_id: r.portfolio_id, quarter: r.period_id, earned_on: on, outperformance: Number(r.outperformance) });
    }
  }
  for (const r of firsts.rows) players.get(r.user_id)?.portfolios.push({ portfolio_id: r.portfolio_id, first_earned_on: dateText(r.first) });
  for (const r of gold.rows) players.get(r.user_id)?.gold.push({ medal_id: r.medal_id, on: localDate(new Date(r.at)) });
  const byUser = new Map<number, { at: string; amount: number }[]>();
  for (const r of ledger.rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), { at: new Date(r.awarded_at).toISOString(), amount: r.xp_amount }]);
  const levels = thresholds.rows.map((t) => ({ level: t.level, xp_required: t.xp_required }));
  for (const [uid, entries] of byUser) {
    const p = players.get(uid);
    if (p) p.level_reached = levelReachedDates(entries, levels);
  }

  const found = computeRare({
    players: [...players.values()],
    taken: new Set(taken.rows.map((r) => r.achievement_id)),
    fiveStarMedals: Array.isArray(setting.rows[0]?.value) ? setting.rows[0].value : DEFAULT_FIVE_STAR_MEDALS,
  });

  let inserted = 0;
  for (const r of found) {
    // A platform-first is inserted only while nobody holds it (one statement, no race).
    const res = await pool.query(
      `INSERT INTO player_professional_achievements (user_id, achievement_id, portfolio_id, period_id, earned_on, outperformance, details)
       SELECT $1, $2::text, NULL, $3, $4::date, $5::numeric, $6::jsonb
       WHERE NOT ($7::boolean AND EXISTS (SELECT 1 FROM player_professional_achievements WHERE achievement_id = $2::text))
       ON CONFLICT (user_id, achievement_id, period_id) WHERE portfolio_id IS NULL DO NOTHING
       RETURNING id`,
      [r.user_id, r.achievement_id, r.period_id, r.earned_on, r.outperformance, JSON.stringify(r.details), PLATFORM_UNIQUE.includes(r.achievement_id)]
    );
    inserted += res.rowCount ?? 0;
  }

  // Special medals (28): one each, the first time its achievement exists.
  let medals = 0;
  const holders = await pool.query(
    `SELECT achievement_id, user_id, MIN(earned_on) AS first_on FROM player_professional_achievements
     WHERE achievement_id = ANY($1::text[]) GROUP BY achievement_id, user_id`,
    [Object.keys(SPECIAL_MEDALS)]
  );
  for (const h of holders.rows) {
    const m = SPECIAL_MEDALS[h.achievement_id];
    const res = await pool.query(
      `INSERT INTO player_medals (user_id, medal_id, period_key, current_tier, highest_tier, as_of)
       SELECT $1, $2::text, '', $3::int, $3::int, $4::date WHERE EXISTS (SELECT 1 FROM medals WHERE id = $2::text AND is_enabled)
       ON CONFLICT DO NOTHING RETURNING user_id`,
      [h.user_id, m.medal_id, m.tier, dateText(h.first_on)]
    );
    if (res.rowCount) {
      await pool.query("INSERT INTO player_medal_events (user_id, medal_id, period_key, tier) VALUES ($1, $2, '', $3)", [h.user_id, m.medal_id, m.tier]);
      medals++;
    }
  }
  return { records: inserted, medals };
};

/** The XP key of one record, as the `professional_xp` setting names it. */
export const xpKeyOf = (achievementId: string, periodId: string): string => {
  if (achievementId === "btm_quarter") return `btm_quarter_q${periodId.slice(-1)}`;
  if (achievementId === "portfolio_return") return `portfolio_return_${periodId}`;
  return achievementId;
};

/**
 * Grants the configured XP to every record that has none (spec 32). Amounts
 * are Gal's to set; with none set this grants nothing. A quarter scale that
 * does not rise from Q1 to Q4 is refused for quarters rather than applied.
 */
export const grantProfessionalXp = async (): Promise<Set<number>> => {
  const cfg: Record<string, number | null> = (
    await pool.query("SELECT value FROM progression_settings WHERE key = 'professional_xp'")
  ).rows[0]?.value ?? {};
  const amount = (k: string) => (typeof cfg[k] === "number" && (cfg[k] as number) > 0 ? (cfg[k] as number) : 0);
  const quarters = [1, 2, 3, 4].map((n) => amount(`btm_quarter_q${n}`));
  const quartersOk = quarters.every((v) => v === 0) || quarters.every((v, i) => v > 0 && (i === 0 || v > quarters[i - 1]));
  if (!quartersOk) console.warn("[professional] quarter XP must rise from Q1 to Q4; quarter XP not granted");

  const pending = await pool.query(
    "SELECT id, user_id, achievement_id, period_id FROM player_professional_achievements WHERE reward_transaction_id IS NULL ORDER BY id"
  );
  const touched = new Set<number>();
  for (const r of pending.rows) {
    const key = xpKeyOf(r.achievement_id, r.period_id);
    if (key.startsWith("btm_quarter_q") && !quartersOk) continue;
    const xp = amount(key);
    if (xp === 0) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const tx = await awardXp(client, {
        userId: r.user_id,
        sourceType: "professional_achievement",
        sourceId: `${r.achievement_id}:${r.period_id}`,
        amount: xp,
        idempotencyKey: `professional:${r.id}`,
      });
      if (tx !== null) {
        await client.query("UPDATE player_professional_achievements SET xp_awarded = $2, reward_transaction_id = $3 WHERE id = $1", [r.id, xp, tx]);
        touched.add(r.user_id);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      console.error(`[professional] XP for record ${r.id} failed:`, error);
    } finally {
      client.release();
    }
  }
  return touched;
};

let running = false;

/** Every portfolio, then every affected player's medals, then XP. One run at a time. */
export const runProfessionalEvaluation = async () => {
  if (running) return null;
  running = true;
  try {
    const tiers = await loadMedalTiers();
    const portfolios = await pool.query("SELECT id, user_id FROM portfolios ORDER BY id");
    const users = new Set<number>();
    let records = 0;
    for (const { id, user_id } of portfolios.rows) {
      try {
        const r = await evaluateAndStore(id);
        if (r) records += r.new_records;
      } catch (error) {
        console.error(`[professional] portfolio ${id} failed:`, error);
      }
      users.add(user_id);
    }
    let upgrades = 0;
    for (const u of users) {
      try {
        upgrades += (await updateMedals(u, tiers)).length;
      } catch (error) {
        console.error(`[professional] medals for player ${u} failed:`, error);
      }
    }
    let rare = { records: 0, medals: 0 };
    try {
      rare = await evaluateRare();
    } catch (error) {
      console.error("[professional] rare achievements failed:", error);
    }
    records += rare.records;
    upgrades += rare.medals;
    const xpUsers = await grantProfessionalXp();
    for (const u of xpUsers) await syncProgressionSafely(u);
    console.log(`[professional] ${records} new achievement record(s), ${upgrades} medal unlock(s)/upgrade(s), XP granted to ${xpUsers.size} player(s)`);
    return { records, upgrades, xp_players: xpUsers.size };
  } finally {
    running = false;
  }
};

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const MONTHS_HE = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const words = (n: number) => (n < 20 ? ONES[n] : n < 100 ? TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "") : String(n));

/** "2026-09" -> September 2026, "2026-Q3" -> Q3 2026, "2026" -> 2026. */
export const periodLabel = (period: string) => {
  if (/^\d{4}-\d{2}$/.test(period)) {
    const m = Number(period.slice(5)) - 1;
    return { en: `${MONTHS_EN[m]} ${period.slice(0, 4)}`, he: `${MONTHS_HE[m]} ${period.slice(0, 4)}` };
  }
  if (/^\d{4}-Q\d$/.test(period)) return { en: `${period.slice(5)} ${period.slice(0, 4)}`, he: `רבעון ${period.slice(6)} ${period.slice(0, 4)}` };
  return { en: period, he: period };
};

const fillName = (template: string, achievementId: string, periodId: string, lang: "en" | "he") => {
  const n = Number(periodId);
  const period = periodLabel(periodId)[lang];
  // Green streaks keep the spec's English names: "Six Green Months", "Two Green Years".
  const greenWords = n % 12 === 0 && n >= 24 ? `${words(n / 12)} Green Years` : `${words(n)} Green Months`;
  return template
    .replace("{period}", period)
    .replace("{n}", achievementId.endsWith("streak") || achievementId === "btm_quarter_combo" ? String(n) : periodId)
    .replace("{pct}", periodId)
    .replace("{roman}", ROMAN[n] ?? String(n))
    .replace("{words}", greenWords);
};

const nameOf = (a: { id: string; title_en: string; title_he: string }, periodId: string) => ({
  en: fillName(a.title_en, a.id, periodId, "en"),
  he: fillName(a.title_he, a.id, periodId, "he"),
});
const descriptionOf = (a: { id: string; description_en: string; description_he: string }, periodId: string) => ({
  en: fillName(a.description_en, a.id, periodId, "en"),
  he: fillName(a.description_he, a.id, periodId, "he"),
});

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export interface MedalView {
  medal_id: string;
  period_key: string;
  name: { en: string; he: string };
  description: { en: string; he: string };
  track: string;
  icon: string;
  tier: number;
  highest_tier: number;
  decoration: number;
  portfolio: { id: number; name: string | null } | null;
  relevant_period: string | null;
  relevant_period_label: { en: string; he: string } | null;
  qualifying_value: number | null;
  highest_streak: number | null;
  current_streak: number | null;
  subtitle: string | null;
  as_of: string;
  first_unlocked_at: string;
  last_upgraded_at: string;
  history: { tier: number; decoration: number; at: string }[];
}

const medalsOf = async (userId: number): Promise<MedalView[]> => {
  const [rows, events] = await Promise.all([
    pool.query(
      `SELECT pm.*, m.title_en, m.title_he, m.description_en, m.description_he, m.track, m.icon, p.name AS portfolio_name
       FROM player_medals pm JOIN medals m ON m.id = pm.medal_id
       LEFT JOIN portfolios p ON p.id = pm.relevant_portfolio_id
       WHERE pm.user_id = $1 ORDER BY m.sort_order, pm.period_key DESC`,
      [userId]
    ),
    pool.query("SELECT medal_id, period_key, tier, decoration, happened_at FROM player_medal_events WHERE user_id = $1 ORDER BY happened_at, id", [userId]),
  ]);
  return rows.rows.map((r) => ({
    medal_id: r.medal_id,
    period_key: r.period_key,
    name: { en: r.title_en, he: r.title_he },
    description: { en: r.description_en, he: r.description_he },
    track: r.track,
    icon: r.icon,
    tier: r.current_tier,
    highest_tier: r.highest_tier,
    decoration: r.decoration,
    portfolio: r.relevant_portfolio_id ? { id: r.relevant_portfolio_id, name: r.portfolio_name } : null,
    relevant_period: r.relevant_period,
    relevant_period_label: r.relevant_period ? periodLabel(r.relevant_period) : null,
    qualifying_value: num(r.qualifying_value),
    highest_streak: r.highest_streak,
    current_streak: r.current_streak,
    subtitle: r.subtitle,
    as_of: dateText(r.as_of),
    first_unlocked_at: new Date(r.first_unlocked_at).toISOString(),
    last_upgraded_at: new Date(r.last_upgraded_at).toISOString(),
    history: events.rows
      .filter((e) => e.medal_id === r.medal_id && e.period_key === r.period_key)
      .map((e) => ({ tier: e.tier, decoration: e.decoration, at: new Date(e.happened_at).toISOString() })),
  }));
};

/** A medal in the Player Card's award shape (the panel shared with game achievements). */
export const medalAward = (m: MedalView): Award => ({
  id: `${m.medal_id}|${m.period_key}`,
  art: m.icon,
  name: m.name,
  description: m.description,
  condition: m.description,
  rank: m.tier,
  // A medal upgrade carries no XP of its own (spec 3.2, 32).
  xp: 0,
  // The date the results earned it (the end of the period that decided the
  // tier), not when the evaluation happened to record it - history is
  // evaluated in bulk on the first run.
  earned_at: m.as_of,
  medal: {
    medal_id: m.medal_id,
    period_key: m.period_key,
    tier: m.tier,
    decoration: m.decoration,
    subtitle: m.subtitle,
    // Phoenix shows no figure: never the depth of the fall (spec 25).
    figure:
      m.medal_id === "phoenix_recovery"
        ? null
        : m.medal_id === "btm_monthly_combo" || m.medal_id === "green_months" || m.medal_id === "capital_protector"
          ? m.highest_streak
          : m.qualifying_value,
    figure_kind:
      m.medal_id === "portfolio_performance"
        ? "return"
        : m.medal_id === "btm_monthly_combo" || m.medal_id === "green_months"
          ? "months"
          : m.medal_id === "capital_protector"
            ? "quarters"
            : "outperformance",
    period_label: m.medal_id === "btm_annual" ? periodLabel(m.period_key) : m.relevant_period_label,
    current_streak: m.current_streak,
  },
});

export const MAX_DISPLAYED_MEDALS = 4;

/** The medals the Player Card shows: the player's choice, or the automatic order. */
export const displayedMedals = async (userId: number, medals?: MedalView[]) => {
  const all = medals ?? (await medalsOf(userId));
  const pref = (await pool.query("SELECT automatic, selected FROM player_medal_preferences WHERE user_id = $1", [userId])).rows[0];
  const automatic = pref ? pref.automatic : true;
  const key = (m: { medal_id: string; period_key: string }) => `${m.medal_id}|${m.period_key}`;
  const byKey = new Map(all.map((m) => [key(m), m]));
  const shown = automatic
    ? autoOrder(all).slice(0, MAX_DISPLAYED_MEDALS)
    : (pref.selected as { medal_id: string; period_key: string }[]).map((s) => byKey.get(key(s))).filter((m): m is MedalView => !!m);
  return { automatic, selected: automatic ? [] : (pref.selected as unknown[]), shown };
};

export class MedalDisplayError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/** Sets the Player Card's medals (6.2): owned medals only, at most four, in order. */
export const setMedalDisplay = async (userId: number, body: { automatic?: unknown; selected?: unknown }) => {
  const automatic = body.automatic === true;
  let selected: { medal_id: string; period_key: string }[] = [];
  if (!automatic) {
    if (!Array.isArray(body.selected)) throw new MedalDisplayError("INVALID_SELECTION");
    selected = body.selected.map((s) => ({ medal_id: String((s as any)?.medal_id ?? ""), period_key: String((s as any)?.period_key ?? "") }));
    if (selected.length > MAX_DISPLAYED_MEDALS) throw new MedalDisplayError("TOO_MANY_MEDALS");
    const keys = selected.map((s) => `${s.medal_id}|${s.period_key}`);
    if (new Set(keys).size !== keys.length) throw new MedalDisplayError("DUPLICATE_MEDAL");
    const owned = await pool.query("SELECT medal_id, period_key FROM player_medals WHERE user_id = $1", [userId]);
    const own = new Set(owned.rows.map((r) => `${r.medal_id}|${r.period_key}`));
    if (keys.some((k) => !own.has(k))) throw new MedalDisplayError("MEDAL_NOT_OWNED");
  }
  await pool.query(
    `INSERT INTO player_medal_preferences (user_id, automatic, selected, updated_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE SET automatic = EXCLUDED.automatic, selected = EXCLUDED.selected, updated_at = NOW()`,
    [userId, automatic, JSON.stringify(selected)]
  );
  return displayedMedals(userId);
};

/** Everything the collection page shows (spec 6.3, 36). */
export const professionalView = async (userId: number) => {
  const [cats, defs, recs, medalDefs, windows, evals, cfgR] = await Promise.all([
    pool.query("SELECT id, name_en, name_he, status FROM professional_categories ORDER BY sort_order"),
    pool.query("SELECT * FROM professional_achievements WHERE is_enabled ORDER BY sort_order"),
    pool.query(
      `SELECT r.*, p.name AS current_name FROM player_professional_achievements r
       LEFT JOIN portfolios p ON p.id = r.portfolio_id
       WHERE r.user_id = $1 ORDER BY r.earned_on DESC, r.id DESC`,
      [userId]
    ),
    pool.query("SELECT id, track, title_en, title_he, description_en, description_he, icon, is_historical, is_special FROM medals WHERE is_enabled ORDER BY sort_order"),
    pool.query(
      `SELECT w.*, p.name FROM return_qualification_windows w JOIN portfolios p ON p.id = w.portfolio_id
       WHERE p.user_id = $1 AND w.status = 'in_progress' ORDER BY w.threshold`,
      [userId]
    ),
    pool.query(
      `SELECT e.portfolio_id, p.name, e.final_through, e.evaluation->'streaks' AS streaks FROM professional_evaluations e
       JOIN portfolios p ON p.id = e.portfolio_id WHERE p.user_id = $1 ORDER BY p.id`,
      [userId]
    ),
    pool.query("SELECT value FROM progression_settings WHERE key = 'professional_xp'"),
  ]);
  const cfg: Record<string, number | null> = cfgR.rows[0]?.value ?? {};
  const medals = await medalsOf(userId);
  const display = await displayedMedals(userId, medals);
  const recordsBy = new Map<string, any[]>();
  for (const r of recs.rows) recordsBy.set(r.achievement_id, [...(recordsBy.get(r.achievement_id) ?? []), r]);

  return {
    categories: cats.rows.map((c) => ({ id: c.id, name: { en: c.name_en, he: c.name_he }, status: c.status })),
    achievements: defs.rows.map((a) => ({
      id: a.id,
      category_id: a.category_id,
      name: nameOf(a, ""),
      scope: a.scope,
      measurement_period: a.measurement_period,
      contributes_to_medal: a.contributes_to_medal,
      rarity: a.rarity,
      records: (recordsBy.get(a.id) ?? []).map((r) => ({
        id: r.id,
        name: nameOf(a, r.period_id),
        description: descriptionOf(a, r.period_id),
        portfolio: r.portfolio_id ? { id: r.portfolio_id, name: r.current_name ?? r.portfolio_name } : null,
        period_id: r.period_id,
        period_label: periodLabel(r.period_id),
        earned_on: dateText(r.earned_on),
        qualifying_value: num(r.qualifying_value),
        benchmark_value: num(r.benchmark_value),
        outperformance: num(r.outperformance),
        details: r.details,
        xp_awarded: r.xp_awarded,
        // What this record would earn once amounts are set; null = not decided yet.
        xp_configured: typeof cfg[xpKeyOf(a.id, r.period_id)] === "number" ? cfg[xpKeyOf(a.id, r.period_id)] : null,
      })),
    })),
    progress: {
      windows: windows.rows.map((w) => ({
        portfolio: { id: w.portfolio_id, name: w.name },
        threshold: Number(w.threshold),
        start: dateText(w.start_date),
        day30: dateText(w.day30),
        grace_until: dateText(w.grace_until),
        best_streak: w.best_streak,
        seven_met: w.seven_met,
        day30_result: w.day30_result,
      })),
      portfolios: evals.rows.map((e) => ({
        portfolio: { id: e.portfolio_id, name: e.name },
        final_through: e.final_through ? dateText(e.final_through) : null,
        btm_month_streak: e.streaks?.btm_month?.current ?? 0,
        green_streak: e.streaks?.green?.current ?? 0,
        btm_quarter_streak: e.streaks?.btm_quarter?.current ?? 0,
      })),
    },
    medal_catalog: medalDefs.rows.map((m) => ({
      id: m.id,
      track: m.track,
      icon: m.icon,
      is_historical: m.is_historical,
      is_special: m.is_special,
      name: { en: m.title_en, he: m.title_he },
      description: { en: m.description_en, he: m.description_he },
    })),
    medals,
    display: { automatic: display.automatic, shown: display.shown.map((m) => ({ medal_id: m.medal_id, period_key: m.period_key })) },
    xp_configured: Object.values(cfg).some((v) => typeof v === "number" && v > 0),
  };
};

/** Unseen professional unlocks and medal upgrades, for the notice. */
export const professionalNotifications = async (userId: number) => {
  const [recs, ups] = await Promise.all([
    pool.query(
      `SELECT r.id, r.achievement_id, r.period_id, r.portfolio_name, r.xp_awarded, a.title_en, a.title_he, a.rarity
       FROM player_professional_achievements r JOIN professional_achievements a ON a.id = r.achievement_id
       WHERE r.user_id = $1 AND r.notified_at IS NULL ORDER BY r.earned_on, r.id`,
      [userId]
    ),
    pool.query(
      `SELECT e.id, e.medal_id, e.period_key, e.tier, e.decoration, m.title_en, m.title_he, m.icon,
              EXISTS (SELECT 1 FROM player_medal_events x WHERE x.user_id = e.user_id AND x.medal_id = e.medal_id
                      AND x.period_key = e.period_key AND x.id < e.id) AS is_upgrade
       FROM player_medal_events e JOIN medals m ON m.id = e.medal_id
       WHERE e.user_id = $1 AND e.notified_at IS NULL ORDER BY e.tier DESC, e.happened_at DESC`,
      [userId]
    ),
  ]);
  return {
    achievements: recs.rows.map((r) => ({
      id: r.id,
      name: nameOf({ id: r.achievement_id, title_en: r.title_en, title_he: r.title_he }, r.period_id),
      portfolio_name: r.portfolio_name,
      rarity: r.rarity,
      xp_awarded: r.xp_awarded,
    })),
    // The most prestigious first (spec 37: one notice at a time, best first).
    medals: ups.rows.map((u) => ({
      id: u.id,
      medal_id: u.medal_id,
      period_key: u.period_key,
      name: { en: u.title_en, he: u.title_he },
      icon: u.icon,
      tier: u.tier,
      decoration: u.decoration,
      is_upgrade: u.is_upgrade,
    })),
  };
};

export const acknowledgeProfessional = async (userId: number, ack: { achievement_ids: number[]; medal_event_ids: number[] }) => {
  if (ack.achievement_ids.length) {
    await pool.query(
      "UPDATE player_professional_achievements SET notified_at = NOW() WHERE user_id = $1 AND id = ANY($2::int[]) AND notified_at IS NULL",
      [userId, ack.achievement_ids]
    );
  }
  if (ack.medal_event_ids.length) {
    await pool.query(
      "UPDATE player_medal_events SET notified_at = NOW() WHERE user_id = $1 AND id = ANY($2::int[]) AND notified_at IS NULL",
      [userId, ack.medal_event_ids]
    );
  }
};
