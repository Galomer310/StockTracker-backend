import type { PoolClient } from "pg";
import pool from "../config/db";
import { awardXp, syncProgressionSafely } from "../progression/service";
import {
  applyBoost,
  CapitalSchedule,
  capitalForDay,
  chooseMessage,
  DEFAULT_CAPITAL_SCHEDULE,
  DEFAULT_TIMEZONE,
  DEFAULT_XP_SCHEDULE,
  liveStreak,
  localDate,
  nextCapitalMilestone,
  nextXpMilestone,
  streakAfterLogin,
  XpSchedule,
  xpForDay,
} from "./schedule";

/* ===========================================================================
   Daily rewards: the database side.
   ---------------------------------------------------------------------------
   checkIn     - the day's login, once per calendar date: streak, daily XP
                 (central XP ledger, source 'daily_login'), and a capital
                 growth reward on milestone days. Called by the app whenever
                 a signed-in player opens it; repeats the same day do nothing.
   rewardsView - the streak, today's and the next rewards, pending capital.
   redeem      - applies one pending capital reward to one portfolio.
   history     - every login day and every capital reward.

   Everything that grants or spends runs in one transaction holding a row
   lock (the player's streak row, or the reward and the portfolio), and is
   backed by a unique key, so concurrent or repeated requests cannot grant
   or redeem twice. Level, level-ups and title ceremonies follow from the XP
   ledger through syncProgression, as for achievements.
   =========================================================================== */

export class RewardsError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

interface Settings {
  timeZone: string;
  xp: XpSchedule;
  capital: CapitalSchedule;
}

const loadSettings = async (db: Pick<PoolClient, "query">): Promise<Settings> => {
  const r = await db.query(
    "SELECT key, value FROM progression_settings WHERE key IN ('rewards_timezone', 'daily_login_xp', 'capital_growth')"
  );
  const map = new Map<string, any>(r.rows.map((row) => [row.key, row.value]));
  const timeZone = typeof map.get("rewards_timezone") === "string" ? map.get("rewards_timezone") : DEFAULT_TIMEZONE;
  return {
    timeZone,
    xp: map.get("daily_login_xp") ?? DEFAULT_XP_SCHEDULE,
    capital: map.get("capital_growth") ?? DEFAULT_CAPITAL_SCHEDULE,
  };
};

// A DATE column as "YYYY-MM-DD". node-postgres turns DATE into a local-midnight
// Date; reading it back in local time keeps the calendar date intact.
const dateText = (d: Date | string | null): string | null => {
  if (d === null) return null;
  if (typeof d === "string") return d.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const rewardView = (row: any) => ({
  id: row.id,
  login_date: dateText(row.login_date),
  streak_day: row.streak_day,
  percentage: Number(row.percentage),
  tier: row.tier,
  earned_at: row.earned_at,
  status: row.status as "pending" | "redeemed",
  message: row.message_id ? { id: row.message_id, en: row.text_en, he: row.text_he } : null,
  portfolio: row.portfolio_id ? { id: row.portfolio_id, name: row.portfolio_name ?? null } : null,
  redeemed_at: row.redeemed_at,
  value_before: num(row.value_before),
  value_after: num(row.value_after),
  base_before: num(row.base_before),
  base_after: num(row.base_after),
  capital_added: num(row.capital_added),
});

const REWARD_COLUMNS = `r.*, m.text_en, m.text_he, p.name AS portfolio_name`;
const REWARD_JOINS = `LEFT JOIN capital_messages m ON m.id = r.message_id
                      LEFT JOIN portfolios p ON p.id = r.portfolio_id`;

// ---------------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------------
export interface CheckInResult {
  /** True the first time today; false for every repeat. */
  counted: boolean;
  date: string;
  streak: number;
  xp: number | null;
  capital_reward_id: number | null;
}

export const checkIn = async (userId: number, now: Date = new Date()): Promise<CheckInResult> => {
  const client = await pool.connect();
  let result: CheckInResult;
  try {
    await client.query("BEGIN");
    const settings = await loadSettings(client);
    const today = localDate(now, settings.timeZone);

    await client.query("INSERT INTO daily_login_state (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
    const state = (
      await client.query("SELECT current_streak, last_login_date FROM daily_login_state WHERE user_id = $1 FOR UPDATE", [userId])
    ).rows[0];
    const step = streakAfterLogin(dateText(state.last_login_date), state.current_streak, today);

    if (step.kind === "repeat") {
      await client.query("COMMIT");
      return { counted: false, date: today, streak: state.current_streak, xp: null, capital_reward_id: null };
    }

    const streak = step.streak;
    const xp = xpForDay(streak, settings.xp);
    const txId = await awardXp(client, {
      userId,
      sourceType: "daily_login",
      sourceId: today,
      amount: xp,
      idempotencyKey: `daily_login:${userId}:${today}`,
    });
    await client.query(
      `INSERT INTO daily_logins (user_id, login_date, streak_day, xp_amount, xp_transaction_id)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [userId, today, streak, xp, txId]
    );

    let rewardId: number | null = null;
    const capital = capitalForDay(streak, settings.capital);
    if (capital) {
      const [enabled, history] = await Promise.all([
        client.query("SELECT id FROM capital_messages WHERE is_enabled ORDER BY sort_order, id"),
        client.query("SELECT message_id, message_cycle FROM capital_rewards WHERE user_id = $1 ORDER BY earned_at, id", [userId]),
      ]);
      const message = chooseMessage(enabled.rows.map((r) => r.id), history.rows);
      const inserted = await client.query(
        `INSERT INTO capital_rewards (user_id, login_date, streak_day, percentage, tier, message_id, message_cycle)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (user_id, login_date) DO NOTHING RETURNING id`,
        [userId, today, streak, capital.pct, capital.tier, message?.id ?? null, message?.cycle ?? null]
      );
      rewardId = inserted.rows[0]?.id ?? null;
    }

    await client.query(
      `UPDATE daily_login_state
       SET current_streak = $2, last_login_date = $3, total_login_days = total_login_days + 1, updated_at = NOW()
       WHERE user_id = $1`,
      [userId, streak, today]
    );
    await client.query("COMMIT");
    result = { counted: true, date: today, streak, xp, capital_reward_id: rewardId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  // Level, level-up and any title ceremony, from the updated ledger.
  await syncProgressionSafely(userId);
  return result;
};

// ---------------------------------------------------------------------------
// The dashboard
// ---------------------------------------------------------------------------
export const rewardsView = async (userId: number, now: Date = new Date()) => {
  const settings = await loadSettings(pool);
  const today = localDate(now, settings.timeZone);
  const [stateRow, todayRow, pending] = await Promise.all([
    pool.query("SELECT current_streak, last_login_date, total_login_days FROM daily_login_state WHERE user_id = $1", [userId]),
    pool.query("SELECT streak_day, xp_amount, seen_at FROM daily_logins WHERE user_id = $1 AND login_date = $2", [userId, today]),
    pool.query(
      `SELECT ${REWARD_COLUMNS} FROM capital_rewards r ${REWARD_JOINS}
       WHERE r.user_id = $1 AND r.status = 'pending' ORDER BY r.earned_at, r.id`,
      [userId]
    ),
  ]);
  const state = stateRow.rows[0];
  const last = dateText(state?.last_login_date ?? null);
  const streak = liveStreak(last, state?.current_streak ?? 0, today);
  const todays = todayRow.rows[0] ?? null;
  const todaysCapital = todays
    ? (
        await pool.query(
          `SELECT ${REWARD_COLUMNS} FROM capital_rewards r ${REWARD_JOINS} WHERE r.user_id = $1 AND r.login_date = $2`,
          [userId, today]
        )
      ).rows[0] ?? null
    : null;

  return {
    date: today,
    time_zone: settings.timeZone,
    streak,
    total_login_days: state?.total_login_days ?? 0,
    checked_in_today: todays !== null,
    today: todays
      ? {
          streak_day: todays.streak_day,
          xp: todays.xp_amount,
          capital_reward: todaysCapital ? rewardView(todaysCapital) : null,
          // The notice for today's reward has not been shown yet.
          unseen: todays.seen_at === null,
        }
      : null,
    // The next day that pays more than the base, and the next capital day,
    // counted from the streak as it stands.
    next_xp: nextXpMilestone(streak, settings.xp),
    next_capital: nextCapitalMilestone(streak, settings.capital),
    base_xp: settings.xp.base,
    pending: pending.rows.map(rewardView),
  };
};

/** Marks today's reward notice as seen, so it is shown once. */
export const acknowledgeToday = async (userId: number) => {
  await pool.query("UPDATE daily_logins SET seen_at = NOW() WHERE user_id = $1 AND seen_at IS NULL", [userId]);
};

// ---------------------------------------------------------------------------
// Redemption
// ---------------------------------------------------------------------------
export const redeem = async (userId: number, rewardId: number, portfolioId: number) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reward = (
      await client.query("SELECT id, status, percentage FROM capital_rewards WHERE id = $1 AND user_id = $2 FOR UPDATE", [
        rewardId,
        userId,
      ])
    ).rows[0];
    if (!reward) throw new RewardsError(404, "REWARD_NOT_FOUND", "That reward does not exist.");
    if (reward.status !== "pending") throw new RewardsError(409, "REWARD_ALREADY_REDEEMED", "That reward has already been applied.");

    // The same lock a trade takes, so a buy or sale cannot change the cash
    // between the valuation and the update.
    const portfolio = (
      await client.query(
        `SELECT id, name, status, cash, starting_balance, COALESCE(capital_base, starting_balance) AS capital_base, created_at
         FROM portfolios WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [portfolioId, userId]
      )
    ).rows[0];
    if (!portfolio) throw new RewardsError(404, "PORTFOLIO_NOT_FOUND", "That portfolio does not exist.");
    if (portfolio.status !== "active") {
      throw new RewardsError(409, "PORTFOLIO_NOT_ELIGIBLE", "Capital can only be added to an active portfolio.");
    }

    // The same valuation as every screen (POSITION_VALUES): the cached close,
    // or the price paid where a symbol has none.
    const positions = (
      await client.query(
        `SELECT COALESCE(SUM(COALESCE(s.last_price, w.price_at_time) * w.quantity), 0) AS value,
                MIN(s.updated_at) AS prices_as_of
         FROM watchlist w LEFT JOIN stocks s ON s.stock_symbol = w.stock_symbol
         WHERE w.portfolio_id = $1`,
        [portfolioId]
      )
    ).rows[0];

    const pct = Number(reward.percentage);
    const boost = applyBoost(
      { cash: Number(portfolio.cash), positionsValue: Number(positions.value), capitalBase: Number(portfolio.capital_base) },
      pct
    );
    if (!boost.ok) {
      throw new RewardsError(409, "INVALID_VALUATION", "This portfolio has no valuation to apply the reward to. The reward stays pending.");
    }

    await client.query("UPDATE portfolios SET cash = $1, capital_base = $2 WHERE id = $3", [
      boost.cash_after,
      boost.base_after,
      portfolioId,
    ]);
    const now = new Date();
    await client.query(
      `INSERT INTO capital_adjustments
         (user_id, portfolio_id, reward_id, percentage, valued_at, prices_as_of,
          cash_before, cash_after, value_before, value_after, base_before, base_after)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        userId, portfolioId, rewardId, pct, now, positions.prices_as_of,
        boost.cash_before, boost.cash_after, boost.value_before, boost.value_after, boost.base_before, boost.base_after,
      ]
    );
    await client.query(
      `UPDATE capital_rewards
       SET status = 'redeemed', portfolio_id = $2, redeemed_at = $3, value_before = $4, value_after = $5,
           base_before = $6, base_after = $7, capital_added = $8
       WHERE id = $1`,
      [rewardId, portfolioId, now, boost.value_before, boost.value_after, boost.base_before, boost.base_after, boost.capital_added]
    );
    await client.query("COMMIT");
    return {
      reward_id: rewardId,
      portfolio: { id: portfolioId, name: portfolio.name },
      percentage: pct,
      ...boost,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
export const history = async (userId: number) => {
  const [logins, rewards] = await Promise.all([
    pool.query(
      "SELECT login_date, streak_day, xp_amount FROM daily_logins WHERE user_id = $1 ORDER BY login_date DESC LIMIT 400",
      [userId]
    ),
    pool.query(`SELECT ${REWARD_COLUMNS} FROM capital_rewards r ${REWARD_JOINS} WHERE r.user_id = $1 ORDER BY r.earned_at DESC, r.id DESC`, [
      userId,
    ]),
  ]);
  return {
    logins: logins.rows.map((r) => ({ type: "DAILY_LOGIN_XP", date: dateText(r.login_date), streak_day: r.streak_day, xp: r.xp_amount })),
    capital_rewards: rewards.rows.map((r) => ({ type: "CAPITAL_BOOST_REWARD", ...rewardView(r) })),
  };
};
