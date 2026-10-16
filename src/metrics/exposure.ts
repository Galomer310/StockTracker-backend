/* ===========================================================================
   Exposure & Characteristics (Module 4).
   ---------------------------------------------------------------------------
   Every exposure is the same shape: the sum of current exposure weights
   (cash in the total, as in Module 1) of the holdings that meet a test. What
   differs is the test, and each test lives here as its own pure function so
   the classification of one security can be checked on its own.

   Tech Oriented comes from a controlled mapping table that does not exist
   yet; exposureOf() accepts the flag however it is produced. Dividend and
   Profitability exposure are not defined by the spec and are not here.
   =========================================================================== */

import {
  DOLLAR_VOLUME_WINDOW_DAYS,
  LOW_LIQUIDITY_DOLLAR_VOLUME_USD,
  MICRO_CAP_MAX_USD,
  MOMENTUM_LONG_MA_DAYS,
  MOMENTUM_SHORT_MA_DAYS,
  SMALL_CAP_MAX_USD,
} from "./config";
import { MetricDefinition } from "./types";

const exposureMetric = (id: string, version: string, sources: MetricDefinition["sources"]): MetricDefinition => ({
  id,
  version,
  sources,
  explanation: null,
});

export const MICRO_CAP_EXPOSURE = exposureMetric("micro_cap_exposure", "market_cap_model_v1", [
  "internal_portfolio_db",
  "market_data_api",
  "fundamentals_api",
]);
export const SMALL_CAP_EXPOSURE = exposureMetric("small_cap_exposure", "market_cap_model_v1", [
  "internal_portfolio_db",
  "market_data_api",
  "fundamentals_api",
]);
export const LOW_VOLUME_EXPOSURE = exposureMetric("low_volume_exposure", "liquidity_model_v1", [
  "internal_portfolio_db",
  "market_data_api",
]);
export const TECH_EXPOSURE = exposureMetric("tech_exposure", "tech_classification_v1", [
  "internal_portfolio_db",
  "market_data_api",
  "fundamentals_api",
]);
export const MOMENTUM_EXPOSURE = exposureMetric("momentum_exposure", "momentum_model_v1", [
  "internal_portfolio_db",
  "market_data_api",
]);

export interface FlaggedHolding {
  /** Exposure weight: share of the whole portfolio, cash included. */
  weight: number;
  /** null when the data to classify it is missing. */
  flag: boolean | null;
}

export interface Exposure {
  /** Weight of the holdings that meet the test. */
  value: number;
  /** Weight that could not be classified, so the gap is visible rather than read as "no". */
  unclassified: number;
}

export const exposureOf = (holdings: FlaggedHolding[]): Exposure => {
  let value = 0;
  let unclassified = 0;
  for (const { weight, flag } of holdings) {
    if (flag === null) unclassified += weight;
    else if (flag) value += weight;
  }
  return { value, unclassified };
};

// ---- Market cap ------------------------------------------------------------

export type CapBucket = "micro" | "small" | null;

// Micro: below $100M. Small: $100M up to, not including, $1B. Never both.
export const capBucket = (marketCapUsd: number): CapBucket => {
  if (!(marketCapUsd >= 0)) throw new RangeError(`Market cap must be zero or more; got ${marketCapUsd}`);
  if (marketCapUsd < MICRO_CAP_MAX_USD) return "micro";
  if (marketCapUsd < SMALL_CAP_MAX_USD) return "small";
  return null;
};

// ---- Liquidity ---------------------------------------------------------------

export interface DailyBar {
  close: number;
  volume: number;
}

// Average Daily Dollar Volume = 20-day average price × 20-day average share
// volume, as the spec states it - the product of two averages, not the
// average of daily products. Price is the daily close. Bars oldest first;
// null with fewer bars than the window.
export const averageDailyDollarVolume = (bars: DailyBar[], window = DOLLAR_VOLUME_WINDOW_DAYS): number | null => {
  if (bars.length < window) return null;
  const recent = bars.slice(-window);
  const avgPrice = recent.reduce((s, b) => s + b.close, 0) / window;
  const avgVolume = recent.reduce((s, b) => s + b.volume, 0) / window;
  return avgPrice * avgVolume;
};

export const isLowLiquidity = (dollarVolume: number, threshold = LOW_LIQUIDITY_DOLLAR_VOLUME_USD): boolean =>
  dollarVolume < threshold;

// ---- Momentum ----------------------------------------------------------------

// Mean of the last n closes; null with fewer than n.
export const simpleMovingAverage = (closes: number[], n: number): number | null =>
  closes.length < n ? null : closes.slice(-n).reduce((s, c) => s + c, 0) / n;

// Positive Momentum: price above both moving averages, and the 50-day above
// the 200-day. null when there are fewer than 200 closes, since what to say
// about a newer listing is not yet decided.
export const positiveMomentum = (
  currentPrice: number,
  closes: number[],
  shortDays = MOMENTUM_SHORT_MA_DAYS,
  longDays = MOMENTUM_LONG_MA_DAYS
): boolean | null => {
  const short = simpleMovingAverage(closes, shortDays);
  const long = simpleMovingAverage(closes, longDays);
  if (short === null || long === null) return null;
  return currentPrice > short && currentPrice > long && short > long;
};
