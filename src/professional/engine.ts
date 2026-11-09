import { addDays, closeOn, PricePoint } from "../performance/history";

/* ===========================================================================
   Professional achievements, stage 2: the evaluation engine. Pure.
   ---------------------------------------------------------------------------
   Spec "Professional Achievements & Premium Medal System" v1.0, sections
   7-20: Beat the Market (monthly, quarterly, annual, their streaks), the
   Portfolio Return milestones with the 30-day qualification, and Green
   Months. One portfolio at a time; medals (player level) are in medals.ts.

   Measured on the genuine performance index (capital boosts stripped out,
   spec 30) against the S&P 500 stand-in (SPY, decided 2026-11-09), over
   identical dates (spec 31.1):

   - A period's portfolio return runs from the index on the day before the
     period starts to the index on its last day. A portfolio opened inside
     the period runs from its opening date instead, and so does the
     benchmark - never a partial portfolio against a full benchmark (7.3).
   - The benchmark is valued like a holding: its close on or before a date.
   - "Outperform" is strictly greater; a tie does not win.
   - Only finished periods whose every day is final are evaluated
     (`finalThrough`, which the caller limits to verified data), so nothing
     is awarded from incomplete or estimated values (31.9).

   Every calendar period is in the platform's zone (the history's dates).
   =========================================================================== */

export interface DayIndex {
  date: string;
  /** Genuine performance index (1 at opening); null once the value is not positive. */
  index: number | null;
}

export interface EngineInput {
  openedOn: string;
  /** One value per calendar date from the opening date, ascending. */
  days: DayIndex[];
  benchmark: PricePoint[];
  /** The last date whose portfolio values and benchmark close are final; null = nothing final yet. */
  finalThrough: string | null;
}

export interface PeriodResult {
  period: string;
  start: string;
  end: string;
  /** The baseline date: the day before the period, or the opening date. */
  from: string;
  portfolio_return: number;
  benchmark_return: number;
  partial: boolean;
}

export interface ProRecord {
  achievement_id: string;
  /** Month "2026-09", quarter "2026-Q3", year "2026", streak length "6", threshold "20". */
  period_id: string;
  earned_on: string;
  qualifying_value: number | null;
  benchmark_value: number | null;
  /** In return terms (0.068 = 6.8 percentage points). */
  outperformance: number | null;
  details: Record<string, unknown>;
}

export const RETURN_THRESHOLDS = [0.1, 0.2, 0.5, 0.75, 1, 2, 3] as const;
export const WINDOW_DAYS = 30;
export const GRACE_DAYS = 7;
export const REQUIRED_STREAK_DAYS = 7;

const pad = (n: number) => String(n).padStart(2, "0");
const monthStart = (m: string) => `${m}-01`;
export const monthEnd = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
};
const nextMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${pad(mo + 1)}`;
};
export const quarterOf = (date: string) => `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
const quarterMonths = (q: string) => {
  const y = q.slice(0, 4);
  const n = Number(q.slice(6));
  return [1, 2, 3].map((k) => `${y}-${pad((n - 1) * 3 + k)}`);
};
const nextQuarter = (q: string) => {
  const y = Number(q.slice(0, 4));
  const n = Number(q.slice(6));
  return n === 4 ? `${y + 1}-Q1` : `${y}-Q${n + 1}`;
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export const evaluatePortfolio = (input: EngineInput) => {
  const { openedOn, benchmark, finalThrough } = input;
  const byDate = new Map(input.days.map((d) => [d.date, d.index]));
  const records: ProRecord[] = [];
  const empty = {
    records,
    months: [] as (PeriodResult & { win: boolean; green: boolean })[],
    quarters: [] as (PeriodResult & { win: boolean; medal_eligible: boolean })[],
    years: [] as (PeriodResult & { win: boolean; sweep: boolean })[],
    streaks: {
      btm_month: { current: 0, highest: 0, highest_end: null as string | null },
      green: { current: 0, highest: 0, highest_end: null as string | null },
      btm_quarter: { current: 0, highest: 0, highest_end: null as string | null },
      btm_year: { current: 0, highest: 0, highest_end: null as string | null },
    },
    windows: [] as ReturnType<typeof returnWindows>["windows"],
  };
  if (!finalThrough || finalThrough < openedOn) return empty;

  const result = (period: string, start: string, end: string): PeriodResult | null => {
    const from = openedOn >= start ? openedOn : addDays(start, -1);
    const p0 = byDate.get(from);
    const p1 = byDate.get(end);
    const b0 = closeOn(benchmark, from);
    const b1 = closeOn(benchmark, end);
    if (p0 == null || p1 == null || b0 == null || b1 == null) return null;
    return { period, start, end, from, portfolio_return: p1 / p0 - 1, benchmark_return: b1 / b0 - 1, partial: openedOn >= start };
  };

  // ---- Months: Beat the Market and Green Months, with their streaks.
  const out = empty;
  const tally = (key: keyof typeof out.streaks, won: boolean, end: string) => {
    const s = out.streaks[key];
    s.current = won ? s.current + 1 : 0;
    if (s.current > s.highest) {
      s.highest = s.current;
      s.highest_end = end;
    }
    return s.current;
  };
  for (let m = openedOn.slice(0, 7); monthEnd(m) <= finalThrough; m = nextMonth(m)) {
    const r = result(m, monthStart(m), monthEnd(m));
    if (!r) break; // the index stopped: nothing after it is measurable
    const win = r.portfolio_return > r.benchmark_return;
    const green = r.portfolio_return > 0;
    out.months.push({ ...r, win, green });
    const evidence = { from: r.from, to: r.end, partial: r.partial };
    if (win) {
      records.push({
        achievement_id: "btm_month",
        period_id: m,
        earned_on: r.end,
        qualifying_value: r.portfolio_return,
        benchmark_value: r.benchmark_return,
        outperformance: r.portfolio_return - r.benchmark_return,
        details: evidence,
      });
    }
    const ws = tally("btm_month", win, r.end);
    if (win && ws % 3 === 0) {
      records.push({ achievement_id: "btm_month_streak", period_id: String(ws), earned_on: r.end, qualifying_value: ws, benchmark_value: null, outperformance: null, details: { through: m } });
    }
    if (green) {
      records.push({ achievement_id: "green_month", period_id: m, earned_on: r.end, qualifying_value: r.portfolio_return, benchmark_value: null, outperformance: null, details: evidence });
    }
    const gs = tally("green", green, r.end);
    if (green && gs % 3 === 0) {
      records.push({ achievement_id: "green_streak", period_id: String(gs), earned_on: r.end, qualifying_value: gs, benchmark_value: null, outperformance: null, details: { through: m } });
    }
  }

  // ---- Quarters (9-11).
  const quarterWins = new Set<string>();
  for (let q = quarterOf(openedOn); monthEnd(quarterMonths(q)[2]) <= finalThrough; q = nextQuarter(q)) {
    const [m1, m2, m3] = quarterMonths(q);
    const start = monthStart(m1);
    const end = monthEnd(m3);
    // Opened in the quarter's third month: no quarterly result at all (9.3).
    const openedMonth = openedOn.slice(0, 7);
    if (openedOn >= start && openedMonth !== m1 && openedMonth !== m2) {
      tally("btm_quarter", false, end);
      continue;
    }
    const r = result(q, start, end);
    if (!r) break;
    const win = r.portfolio_return > r.benchmark_return;
    // The medal needs the whole quarter: opened before it began (9.3, "Before April 1").
    const medal_eligible = openedOn < start;
    out.quarters.push({ ...r, win, medal_eligible });
    if (win) {
      quarterWins.add(q);
      records.push({
        achievement_id: "btm_quarter",
        period_id: q,
        earned_on: end,
        qualifying_value: r.portfolio_return,
        benchmark_value: r.benchmark_return,
        outperformance: r.portfolio_return - r.benchmark_return,
        details: { from: r.from, to: r.end, partial: r.partial, medal_eligible, quarter: Number(q.slice(6)) },
      });
    }
    const qs = tally("btm_quarter", win, end);
    // Quarter Combo II-V: once each per portfolio; streaks may cross years.
    if (win && qs >= 2 && qs <= 5) {
      records.push({ achievement_id: "btm_quarter_combo", period_id: String(qs), earned_on: end, qualifying_value: qs, benchmark_value: null, outperformance: null, details: { through: q } });
    }
    // Unbroken Four: all four quarters of one calendar year.
    if (q.endsWith("Q4") && win && [1, 2, 3].every((n) => quarterWins.has(`${q.slice(0, 4)}-Q${n}`))) {
      records.push({ achievement_id: "btm_unbroken_four", period_id: q.slice(0, 4), earned_on: end, qualifying_value: null, benchmark_value: null, outperformance: null, details: {} });
    }
  }

  // ---- Years (12-13): full calendar years only.
  // Opened before 1 January (12.1), so the first candidate is the next year.
  for (let y = Number(openedOn.slice(0, 4)) + 1; `${y}-12-31` <= finalThrough; y++) {
    const start = `${y}-01-01`;
    const r = result(String(y), start, `${y}-12-31`);
    if (!r) break;
    const win = r.portfolio_return > r.benchmark_return;
    const sweep = win && [1, 2, 3, 4].every((n) => quarterWins.has(`${y}-Q${n}`));
    out.years.push({ ...r, win, sweep });
    if (win) {
      records.push({
        achievement_id: "btm_year",
        period_id: String(y),
        earned_on: r.end,
        qualifying_value: r.portfolio_return,
        benchmark_value: r.benchmark_return,
        outperformance: r.portfolio_return - r.benchmark_return,
        details: { from: r.from, to: r.end, sweep },
      });
    }
    const ys = tally("btm_year", win, r.end);
    if (win && ys >= 2 && ys <= 5) {
      records.push({ achievement_id: "btm_year_streak", period_id: String(ys), earned_on: r.end, qualifying_value: ys, benchmark_value: null, outperformance: null, details: { through: y } });
    }
  }

  // ---- Portfolio Return milestones (15-16).
  const w = returnWindows(input.days.filter((d) => d.date >= openedOn && d.date <= finalThrough));
  out.windows = w.windows;
  for (const q of w.qualified) {
    records.push({
      achievement_id: "portfolio_return",
      period_id: String(Math.round(q.threshold * 100)),
      earned_on: q.on,
      qualifying_value: q.value,
      benchmark_value: null,
      outperformance: null,
      details: { window_start: q.start, threshold: q.threshold, via_grace: q.via_grace },
    });
  }

  // A streak milestone is once per portfolio: a later streak reaching 3
  // again does not repeat it (11, 19).
  const seen = new Set<string>();
  out.records = records.filter((r) => {
    const k = `${r.achievement_id}:${r.period_id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return out;
};

export type PortfolioEvaluation = ReturnType<typeof evaluatePortfolio>;

export interface ReturnWindow {
  threshold: number;
  start: string;
  day30: string;
  grace_until: string;
  best_streak: number;
  seven_met: boolean;
  /** "above" / "below" at Day 30, null before it. */
  day30_result: "above" | "below" | null;
  status: "in_progress" | "qualified" | "failed";
  closed_on: string | null;
}

/**
 * The 30-day qualification (16), for every threshold, over calendar days
 * (non-trading days carry the last valuation, as the history already does).
 *
 * Day 1 is the first day at or above the threshold. Within Days 1-30 the
 * return must hold at or above it for seven consecutive days. On Day 30 it
 * must be at or above it; if not, Days 31-37 are a grace period in which
 * reaching the threshold again is enough (the seven days must already have
 * happened). Failing closes the attempt; a new one starts the next day the
 * return is at or above the threshold. A threshold once qualified is never
 * evaluated again for that portfolio.
 */
export const returnWindows = (days: DayIndex[]) => {
  const windows: ReturnWindow[] = [];
  const qualified: { threshold: number; on: string; value: number; start: string; via_grace: boolean }[] = [];
  for (const threshold of RETURN_THRESHOLDS) {
    let open: ReturnWindow | null = null;
    let streak = 0;
    for (const d of days) {
      if (d.index === null) break;
      const r = d.index - 1;
      const above = r >= threshold - 1e-12;
      if (!open) {
        if (!above) continue;
        open = {
          threshold,
          start: d.date,
          day30: addDays(d.date, WINDOW_DAYS - 1),
          grace_until: addDays(d.date, WINDOW_DAYS + GRACE_DAYS - 1),
          best_streak: 0,
          seven_met: false,
          day30_result: null,
          status: "in_progress",
          closed_on: null,
        };
        streak = 0;
        windows.push(open);
      }
      const day = daysBetween(open.start, d.date) + 1;
      if (day <= WINDOW_DAYS) {
        streak = above ? streak + 1 : 0;
        open.best_streak = Math.max(open.best_streak, streak);
        open.seven_met = open.best_streak >= REQUIRED_STREAK_DAYS;
        if (day === WINDOW_DAYS) {
          open.day30_result = above ? "above" : "below";
          if (open.seven_met && above) {
            open.status = "qualified";
            open.closed_on = d.date;
            qualified.push({ threshold, on: d.date, value: r, start: open.start, via_grace: false });
            break;
          }
          if (!open.seven_met) {
            open.status = "failed";
            open.closed_on = d.date;
            open = null;
          }
        }
      } else if (above) {
        open.status = "qualified";
        open.closed_on = d.date;
        qualified.push({ threshold, on: d.date, value: r, start: open.start, via_grace: true });
        break;
      } else if (day >= WINDOW_DAYS + GRACE_DAYS) {
        open.status = "failed";
        open.closed_on = d.date;
        open = null;
      }
    }
  }
  return { windows, qualified };
};
