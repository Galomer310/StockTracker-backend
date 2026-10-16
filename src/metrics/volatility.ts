/* ===========================================================================
   Portfolio volatility and daily-move statistics.
   ---------------------------------------------------------------------------
   Volatility is the standard deviation of daily returns over the most recent
   rolling window, counting up days and down days alike. Daily returns come
   from returns.ts, so game-earned capital never appears as a move.

   Standard deviation is the SAMPLE form (divides by n - 1), the usual choice
   when a window of returns stands in for the portfolio's behaviour in
   general. Changing it means a new volatility_model version.

   When there are fewer returns than the window, the result is null rather
   than a figure computed over less history: what to show a portfolio younger
   than the window is not yet decided.
   =========================================================================== */

import { TRADING_DAYS_PER_YEAR, VOLATILITY_WINDOW_DAYS } from "./config";
import { DatedValue, MetricDefinition } from "./types";

export const PORTFOLIO_VOLATILITY: MetricDefinition = {
  id: "portfolio_volatility",
  version: "volatility_model_v1",
  sources: ["internal_portfolio_db", "market_data_api"],
  explanation: null,
};

export const sampleStdDev = (values: number[]): number | null => {
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const sq = values.reduce((s, v) => s + (v - mean) ** 2, 0);
  return Math.sqrt(sq / (values.length - 1));
};

// Daily standard deviation over the last `window` returns.
export const dailyVolatility = (
  returns: DatedValue[],
  window = VOLATILITY_WINDOW_DAYS
): number | null => {
  if (returns.length < window) return null;
  return sampleStdDev(returns.slice(-window).map((r) => r.value));
};

export const annualizeVolatility = (daily: number, tradingDays = TRADING_DAYS_PER_YEAR): number =>
  daily * Math.sqrt(tradingDays);

export interface DailyMoveStats {
  average_positive_day: number | null;
  average_negative_day: number | null;
  max_daily_gain: DatedValue | null;
  max_daily_loss: DatedValue | null;
}

// Over whichever returns the caller passes - the volatility window, or the
// whole history for Performance Insights. A flat day (exactly 0) is neither a
// positive nor a negative day, so it is left out of both averages.
export const dailyMoveStats = (returns: DatedValue[]): DailyMoveStats => {
  const ups = returns.filter((r) => r.value > 0).map((r) => r.value);
  const downs = returns.filter((r) => r.value < 0).map((r) => r.value);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);

  // The earliest date wins a tie, so the result does not depend on sort order.
  let gain: DatedValue | null = null;
  let loss: DatedValue | null = null;
  for (const r of returns) {
    if (!gain || r.value > gain.value) gain = r;
    if (!loss || r.value < loss.value) loss = r;
  }

  return {
    average_positive_day: mean(ups),
    average_negative_day: mean(downs),
    max_daily_gain: gain,
    max_daily_loss: loss,
  };
};
