/* ===========================================================================
   Daily rewards: the rules, without a database.
   ---------------------------------------------------------------------------
   Spec: "Daily Rewards, Login Streaks & Capital Growth System" v1.0
   (docs/PRODUCT-SPEC-AND-GAP.md, "Daily rewards").

   - A login day is a calendar date in ONE configured IANA time zone
     (Asia/Jerusalem by default), worked out on the server from the server's
     clock. The player's device clock and time zone play no part, so neither
     can be used to earn a day twice. Dates come from Intl, which applies
     daylight saving time, and the gap between two dates is counted in
     calendar days, so a 23- or 25-hour day is still one day.
   - The streak grows by one for each consecutive date and restarts at 1
     after a missed date. Nothing already earned is taken back.
   - XP: a base amount every day, replaced (not topped up) by the largest
     milestone the day hits - 75 every 7th day, 150 every 30th, 250 every
     150th.
   - Capital growth: on the days that hit a milestone, the largest
     percentage only - 1% every 7th day, 3% every 30th, 5% every 90th.
   - The amounts are configuration (progression_settings), not code.
   =========================================================================== */

export interface XpSchedule {
  base: number;
  milestones: { every: number; xp: number }[];
}

export type CapitalTier = "weekly" | "monthly" | "quarterly" | string;

export interface CapitalSchedule {
  milestones: { every: number; pct: number; tier: CapitalTier }[];
}

export const DEFAULT_TIMEZONE = "Asia/Jerusalem";

export const DEFAULT_XP_SCHEDULE: XpSchedule = {
  base: 50,
  milestones: [
    { every: 7, xp: 75 },
    { every: 30, xp: 150 },
    { every: 150, xp: 250 },
  ],
};

export const DEFAULT_CAPITAL_SCHEDULE: CapitalSchedule = {
  milestones: [
    { every: 7, pct: 1, tier: "weekly" },
    { every: 30, pct: 3, tier: "monthly" },
    { every: 90, pct: 5, tier: "quarterly" },
  ],
};

/** The calendar date ("YYYY-MM-DD") that `now` falls on in `timeZone`. */
export const localDate = (now: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole calendar days from date `a` to date `b` (both "YYYY-MM-DD"). */
export const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** The calendar date `n` days after `date`. */
export const addDays = (date: string, n: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * What a login on `today` does to the streak.
 * - "repeat": already counted today (or the date went backwards): no reward.
 * - otherwise the streak day this login is.
 */
export const streakAfterLogin = (
  lastDate: string | null,
  currentStreak: number,
  today: string
): { kind: "repeat" } | { kind: "counted"; streak: number } => {
  if (lastDate === null) return { kind: "counted", streak: 1 };
  const gap = daysBetween(lastDate, today);
  if (gap <= 0) return { kind: "repeat" };
  return { kind: "counted", streak: gap === 1 ? currentStreak + 1 : 1 };
};

/** The streak as it stands on `today`: 0 once a date has been missed. */
export const liveStreak = (lastDate: string | null, currentStreak: number, today: string): number => {
  if (lastDate === null) return 0;
  const gap = daysBetween(lastDate, today);
  return gap <= 1 ? currentStreak : 0;
};

/** XP for streak day `day`: the base, or the largest milestone it hits instead. */
export const xpForDay = (day: number, schedule: XpSchedule): number =>
  schedule.milestones.reduce((best, m) => (day % m.every === 0 && m.xp > best ? m.xp : best), schedule.base);

/** The capital reward for streak day `day`, or null: only the largest milestone it hits. */
export const capitalForDay = (day: number, schedule: CapitalSchedule) =>
  schedule.milestones.reduce<CapitalSchedule["milestones"][number] | null>(
    (best, m) => (day % m.every === 0 && (!best || m.pct > best.pct) ? m : best),
    null
  );

const longestCycle = (everies: number[]) => Math.max(1, ...everies);

/** The next streak day after `day` that pays more than the base XP. */
export const nextXpMilestone = (day: number, schedule: XpSchedule) => {
  const limit = longestCycle(schedule.milestones.map((m) => m.every));
  for (let d = day + 1; d <= day + limit; d++) {
    const xp = xpForDay(d, schedule);
    if (xp > schedule.base) return { day: d, xp };
  }
  return null;
};

/**
 * The next streak day after `day` that earns capital growth, and `from_day`:
 * the last capital day at or before `day` (0 before the first), so a
 * progress track can run from one boost to the next.
 */
export const nextCapitalMilestone = (day: number, schedule: CapitalSchedule) => {
  const limit = longestCycle(schedule.milestones.map((m) => m.every));
  let from = 0;
  for (let d = day; d > Math.max(0, day - limit); d--) {
    if (capitalForDay(d, schedule)) {
      from = d;
      break;
    }
  }
  for (let d = day + 1; d <= day + limit; d++) {
    const reward = capitalForDay(d, schedule);
    if (reward) return { day: d, pct: reward.pct, tier: reward.tier, from_day: from };
  }
  return null;
};

/* ---------------------------------------------------------------------------
   Motivational messages.
   Each capital reward carries one. Within a cycle no message repeats; once
   every enabled message has been used a new cycle starts, and its first
   message is never the one just shown. The chosen id and cycle are stored on
   the reward, so a reward redeemed later shows the same message.
   --------------------------------------------------------------------------- */
export const chooseMessage = (
  enabledIds: string[],
  history: { message_id: string | null; message_cycle: number | null }[],
  random: () => number = Math.random
): { id: string; cycle: number } | null => {
  if (enabledIds.length === 0) return null;
  const last = history.length > 0 ? history[history.length - 1] : null;
  const cycle = last?.message_cycle ?? 1;
  const used = new Set(
    history.filter((h) => (h.message_cycle ?? 1) === cycle && h.message_id).map((h) => h.message_id as string)
  );
  const unused = enabledIds.filter((id) => !used.has(id));
  if (history.length > 0 && unused.length === 0) {
    const fresh = enabledIds.length > 1 ? enabledIds.filter((id) => id !== last?.message_id) : enabledIds;
    return { id: fresh[Math.floor(random() * fresh.length)], cycle: cycle + 1 };
  }
  const pool = history.length > 0 ? unused : enabledIds;
  return { id: pool[Math.floor(random() * pool.length)], cycle };
};

/* ---------------------------------------------------------------------------
   Applying capital growth to one portfolio.

   The portfolio's value V = cash + positions, its capital base B (what its
   return is measured against; the $10,000 it opened with until a boost),
   and the reward r. The boost adds r x V to the portfolio's CASH and grows
   B by the same factor:

     V' = V (1 + r)      B' = B (1 + r)      return' = V'/B' - 1 = V/B - 1

   so the return is unchanged and the added money is never counted as
   profit (profit = V - B). Holdings are whole shares bought in separate
   lots, each with its own price, so they cannot all be scaled by 1%: the
   new capital arrives as cash, like a real deposit, and the player decides
   where to invest it. Positions keep their shares; cash's share of the
   portfolio rises by the added amount.

   Money is rounded to the cent like every other cash movement; the base
   keeps four decimals. The return moves by at most a few millionths of a
   percentage point from that rounding.
   --------------------------------------------------------------------------- */
const cents = (x: number) => Math.round(x * 100) / 100;
const fourDp = (x: number) => Math.round(x * 10000) / 10000;

export type BoostResult =
  | {
      ok: true;
      value_before: number;
      value_after: number;
      capital_added: number;
      cash_before: number;
      cash_after: number;
      base_before: number;
      base_after: number;
      return_before_pct: number;
      return_after_pct: number;
    }
  | { ok: false; reason: "INVALID_VALUATION" };

export const applyBoost = (
  p: { cash: number; positionsValue: number; capitalBase: number },
  pct: number
): BoostResult => {
  const value = p.cash + p.positionsValue;
  if (![p.cash, p.positionsValue, p.capitalBase, pct].every(Number.isFinite) || value <= 0 || p.capitalBase <= 0 || pct <= 0) {
    return { ok: false, reason: "INVALID_VALUATION" };
  }
  const added = cents(value * (pct / 100));
  const baseAfter = fourDp(p.capitalBase * (1 + pct / 100));
  const valueAfter = value + added;
  return {
    ok: true,
    value_before: value,
    value_after: valueAfter,
    capital_added: added,
    cash_before: p.cash,
    cash_after: cents(p.cash + added),
    base_before: p.capitalBase,
    base_after: baseAfter,
    return_before_pct: (value / p.capitalBase - 1) * 100,
    return_after_pct: (valueAfter / baseAfter - 1) * 100,
  };
};
