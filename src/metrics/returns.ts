/* ===========================================================================
   Returns, with game-earned capital excluded.
   ---------------------------------------------------------------------------
   Game capital is an external cash flow: it raises NAV without being earned
   by investing, so it must never read as return. A daily return therefore
   strips out any flow that arrived that day before comparing with yesterday:

     Daily Return = (NAV(today) - flow(today)) / NAV(previous day) - 1

   With no flow this is exactly the spec's NAV(today) / NAV(previous) - 1.

   A flow is treated as arriving at the END of its day: the day's market move
   applies to yesterday's capital only. That matches the spec's example, where
   the reward lands after the +10% was earned.

   Chaining these daily returns gives a time-weighted return, which is what
   keeps the example at +10% rather than +20%.
   =========================================================================== */

import { DatedValue, MetricDefinition } from "./types";

export const TOTAL_RETURN: MetricDefinition = {
  id: "total_return",
  version: "return_model_v1",
  sources: ["internal_portfolio_db", "market_data_api", "game_engine"],
  explanation: null,
};

export interface NavPoint {
  date: string;
  /** Portfolio value at the close of this date, including cash. */
  nav: number;
  /** Game-earned capital credited on this date, already included in nav. */
  external_flow?: number;
}

const assertAscending = (dates: string[]): void => {
  for (let i = 1; i < dates.length; i++) {
    if (!(dates[i] > dates[i - 1])) {
      throw new RangeError(`Series must be strictly ascending by date: ${dates[i - 1]} then ${dates[i]}`);
    }
  }
};

// One return per date after the first. The first point is the base the
// series starts from, so it has no return of its own.
export const dailyReturns = (series: NavPoint[]): DatedValue[] => {
  assertAscending(series.map((p) => p.date));

  const out: DatedValue[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].nav;
    const { date, nav, external_flow = 0 } = series[i];
    if (!(prev > 0)) {
      throw new RangeError(`NAV must be positive to compute a return; got ${prev} on ${series[i - 1].date}`);
    }
    out.push({ date, value: (nav - external_flow) / prev - 1 });
  }
  return out;
};

// Compounds a run of returns into one: (1 + r1)(1 + r2)... - 1.
export const chainReturns = (returns: number[]): number =>
  returns.reduce((acc, r) => acc * (1 + r), 1) - 1;

// The portfolio's performance as an index starting at `base`, with flows
// removed. Drawdowns and benchmark charts are measured on this rather than on
// raw NAV, so a reward can neither set a new peak nor look like a rally.
export const performanceIndex = (series: NavPoint[], base = 100): DatedValue[] => {
  if (series.length === 0) return [];
  const index: DatedValue[] = [{ date: series[0].date, value: base }];
  for (const r of dailyReturns(series)) {
    index.push({ date: r.date, value: index[index.length - 1].value * (1 + r.value) });
  }
  return index;
};

// Investment return over the whole series, flows excluded.
export const totalReturn = (series: NavPoint[]): number | null =>
  series.length < 2 ? null : chainReturns(dailyReturns(series).map((r) => r.value));
