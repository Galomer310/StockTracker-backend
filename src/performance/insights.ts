import { DatedValue } from "../metrics/types";
import { maxDrawdown } from "../metrics/drawdown";
import { closeOn, PricePoint } from "./history";

/* ===========================================================================
   Module 5 - Performance Insights (spec Part 1). Pure; no database.
   ---------------------------------------------------------------------------
   Everything is measured on the genuine performance index (history.ts), so
   capital growth rewards never count as return.

   The series is taken on US trading sessions only: the stored history has a
   value for every calendar date, and a weekend would otherwise be a "daily
   return" of exactly 0. The sessions are the dates the benchmarks traded.
   It starts on the opening date (index 1) and ends on the last session
   every available benchmark has a close for, so the portfolio and every
   benchmark use exactly the same start and end dates (spec).

   Benchmarks are valued like holdings: the close on or before a date.
   Price return only, like the portfolio (dividends are not credited);
   the funds stand in for the indices on the current data plan.

   Months are calendar months in the platform's time zone. A month counts in
   the monthly figures once it is over; the opening month counts from the
   opening date and is marked partial. The month in progress is shown but
   not counted.
   =========================================================================== */

export interface IndexDay {
  date: string;
  /** Null from the first day the value was not positive. */
  perf_index: number | null;
  estimated: boolean;
}

export interface BenchmarkInput {
  key: string;
  symbol: string;
  name: string;
  closes: PricePoint[];
}

export interface DatedReturn {
  date: string;
  value: number;
}

export interface MonthReturn {
  month: string;
  value: number;
  /** The opening month, measured from the opening date. */
  partial: boolean;
  /** Still in progress: shown, not counted. */
  in_progress: boolean;
}

export interface BenchmarkResult {
  key: string;
  symbol: string;
  name: string;
  /** Null when there are no closes to compare with. */
  return: number | null;
  excess_return: number | null;
}

export interface Insights {
  start: string;
  end: string;
  /** Sessions in the series, not counting the opening date. */
  sessions: number;
  total_return: number;
  average_monthly_return: number | null;
  best_month: MonthReturn | null;
  worst_month: MonthReturn | null;
  positive_months: { positive: number; counted: number };
  months: MonthReturn[];
  max_drawdown: { value: number; peak_date: string | null; trough_date: string | null };
  max_daily_gain: DatedReturn | null;
  max_daily_loss: DatedReturn | null;
  age_days: number;
  benchmarks: BenchmarkResult[];
  /** 100 at the start, for the chart: the portfolio and every benchmark with data. */
  chart: { date: string; portfolio: number; [key: string]: number | string | null }[];
  /** Some day in the period valued a holding at its trade price (no close yet). */
  estimated: boolean;
}

export type InsightsOutcome =
  | { ok: true; insights: Insights }
  | { ok: false; reason: "no_history" | "too_new"; age_days: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** The last Monday-to-Friday date of a month ("2026-10" -> "2026-10-30"). */
export const lastWeekdayOf = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  let d = new Date(Date.UTC(y, m, 0)); // day 0 of the next month = last day of this one
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(d.getTime() - DAY_MS);
  return d.toISOString().slice(0, 10);
};

export interface SessionPoint {
  date: string;
  index: number;
  estimated: boolean;
}

/**
 * The performance index on the opening date and then on every trading
 * session, up to the last session every benchmark with data has a close
 * for (so comparisons share their end). Sessions are the benchmarks' trading
 * dates; with no benchmark data yet, Monday to Friday stands in. Stops where
 * the index stops. Null when the opening date is not in the history.
 */
export const sessionPoints = (openedOn: string, days: IndexDay[], benchmarks: BenchmarkInput[]): SessionPoint[] | null => {
  const opening = days.find((d) => d.date === openedOn);
  if (!opening || opening.perf_index === null) return null;

  const withData = benchmarks.filter((b) => b.closes.length > 0);
  const sessionSet = new Set<string>();
  for (const b of withData) for (const c of b.closes) sessionSet.add(c.date);
  const cap = withData.length ? withData.map((b) => b.closes[b.closes.length - 1].date).sort()[0] : null;
  const isSession = (date: string) => {
    if (sessionSet.size > 0) return sessionSet.has(date);
    const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
    return wd !== 0 && wd !== 6;
  };

  const points: SessionPoint[] = [{ date: openedOn, index: opening.perf_index, estimated: opening.estimated }];
  for (const d of days) {
    if (d.date <= openedOn || !isSession(d.date) || (cap && d.date > cap)) continue;
    if (d.perf_index === null) break;
    points.push({ date: d.date, index: d.perf_index, estimated: d.estimated });
  }
  return points;
};

export const computeInsights = (input: {
  openedOn: string;
  /** Today in the platform's time zone. */
  today: string;
  days: IndexDay[];
  benchmarks: BenchmarkInput[];
}): InsightsOutcome => {
  const { openedOn, today, days, benchmarks } = input;
  const age_days = Math.max(0, daysBetween(openedOn, today));
  const points = sessionPoints(openedOn, days, benchmarks);
  if (points === null) return { ok: false, reason: "no_history", age_days };
  if (points.length < 2) return { ok: false, reason: "too_new", age_days };

  const start = points[0];
  const last = points[points.length - 1];

  // Daily returns, session to session.
  const daily: DatedReturn[] = [];
  for (let i = 1; i < points.length; i++) {
    daily.push({ date: points[i].date, value: points[i].index / points[i - 1].index - 1 });
  }
  const max_daily_gain = daily.reduce<DatedReturn | null>((a, r) => (!a || r.value > a.value ? r : a), null);
  const max_daily_loss = daily.reduce<DatedReturn | null>((a, r) => (!a || r.value < a.value ? r : a), null);

  // Months: the last point of each month against the last point before it.
  const months: MonthReturn[] = [];
  let prevIndex = start.index;
  for (let i = 1; i < points.length; i++) {
    const month = points[i].date.slice(0, 7);
    const isLastOfMonth = i === points.length - 1 || points[i + 1].date.slice(0, 7) !== month;
    if (!isLastOfMonth) continue;
    const over = month < today.slice(0, 7) && (last.date.slice(0, 7) > month || last.date >= lastWeekdayOf(month));
    months.push({
      month,
      value: points[i].index / prevIndex - 1,
      partial: month === openedOn.slice(0, 7),
      in_progress: !over,
    });
    prevIndex = points[i].index;
  }
  const counted = months.filter((m) => !m.in_progress);
  const best_month = counted.reduce<MonthReturn | null>((a, m) => (!a || m.value > a.value ? m : a), null);
  const worst_month = counted.reduce<MonthReturn | null>((a, m) => (!a || m.value < a.value ? m : a), null);

  const dd = maxDrawdown(points.map((p) => ({ date: p.date, value: p.index }) as DatedValue))!;
  const total_return = last.index / start.index - 1;

  const results: BenchmarkResult[] = benchmarks.map((b) => {
    const s = closeOn(b.closes, start.date);
    const e = closeOn(b.closes, last.date);
    const r = s && e ? e / s - 1 : null;
    return { key: b.key, symbol: b.symbol, name: b.name, return: r, excess_return: r === null ? null : total_return - r };
  });

  const usable = benchmarks.filter((b) => closeOn(b.closes, start.date));
  const chart = points.map((p) => {
    const row: Insights["chart"][number] = { date: p.date, portfolio: (p.index / start.index) * 100 };
    for (const b of usable) {
      const base = closeOn(b.closes, start.date)!;
      const c = closeOn(b.closes, p.date);
      row[b.key] = c === null ? null : (c / base) * 100;
    }
    return row;
  });

  return {
    ok: true,
    insights: {
      start: start.date,
      end: last.date,
      sessions: points.length - 1,
      total_return,
      average_monthly_return: counted.length ? counted.reduce((s, m) => s + m.value, 0) / counted.length : null,
      best_month,
      worst_month,
      positive_months: { positive: counted.filter((m) => m.value > 0).length, counted: counted.length },
      months,
      max_drawdown: dd,
      max_daily_gain,
      max_daily_loss,
      age_days,
      benchmarks: results,
      chart,
      estimated: points.some((p) => p.estimated),
    },
  };
};
