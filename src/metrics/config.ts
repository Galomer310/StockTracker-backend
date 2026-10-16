/* ===========================================================================
   Metric engine - thresholds and weights.
   ---------------------------------------------------------------------------
   Every threshold, window and weight the spec defines lives here and only
   here, so changing one is a one-line edit rather than a search. Changing a
   value that alters results also means bumping the version of every metric
   that uses it.
   =========================================================================== */

// Module 1: the allocation chart shows this many holdings, then Other, then Cash.
export const ALLOCATION_TOP_N = 5;

// Concentration: "Top 3 Holdings".
export const TOP_HOLDINGS_N = 3;

// Volatility: rolling window in trading days, and the annualization factor.
export const VOLATILITY_WINDOW_DAYS = 90;
export const TRADING_DAYS_PER_YEAR = 252;

// Market-cap buckets, in USD. Micro: below MICRO. Small: MICRO up to, not
// including, SMALL. The two never overlap.
export const MICRO_CAP_MAX_USD = 100_000_000;
export const SMALL_CAP_MAX_USD = 1_000_000_000;

// Liquidity. The spec marks the threshold as configurable and suggests $5M as
// the initial value.
export const DOLLAR_VOLUME_WINDOW_DAYS = 20;
export const LOW_LIQUIDITY_DOLLAR_VOLUME_USD = 5_000_000;

// Momentum: short and long moving-average windows, in trading days.
export const MOMENTUM_SHORT_MA_DAYS = 50;
export const MOMENTUM_LONG_MA_DAYS = 200;

// Risk Score weights. Each input is a 0-100 sub-score.
export const RISK_WEIGHTS = {
  volatility: 0.3,
  max_drawdown: 0.25,
  concentration: 0.2,
  liquidity: 0.15,
  turnover: 0.1,
} as const;

// Concentration Score weights. Each input is a 0-100 sub-score.
export const CONCENTRATION_WEIGHTS = {
  effective_holdings: 0.4,
  largest_position: 0.25,
  top_3_holdings: 0.15,
  sector_concentration: 0.2,
} as const;

// Player Card: the average return (4.1 / 9.3) and best portfolio gain (4.6)
// unlock at this many active portfolios.
export const MIN_ACTIVE_PORTFOLIOS_FOR_PLAYER_STATS = 2;

// Player Card: the top portfolio (9.5 / 9.6) is shown only when its cumulative
// return is strictly ABOVE this. 0.2 = 20%.
export const TOP_PORTFOLIO_MIN_RETURN = 0.2;

// Risk classification, by inclusive upper bound. The spec states the bands in
// whole numbers (0-20, 21-40, ...); a fractional score between two bands
// (20.5) falls into the higher one.
export const RISK_BANDS = [
  { max: 20, label: "Very Low" },
  { max: 40, label: "Low" },
  { max: 60, label: "Medium" },
  { max: 80, label: "High" },
  { max: 100, label: "Very High" },
] as const;
