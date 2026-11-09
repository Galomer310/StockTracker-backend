import { averageDailyDollarVolume, capBucket, exposureOf, isLowLiquidity, positiveMomentum } from "../metrics/exposure";
import { LOW_LIQUIDITY_DOLLAR_VOLUME_USD } from "../metrics/config";

/* ===========================================================================
   Module 4 - Exposure & Characteristics (spec Part 1). Pure.
   ---------------------------------------------------------------------------
   Each exposure is the share of the whole portfolio (cash included, as in
   Module 1) held in securities that meet a test; holdings that cannot be
   classified for lack of data are reported apart, never counted as "no".

   - Micro / Small Cap: market cap from the security master (the company
     reference data), < $100M micro, $100M up to $1B small; never both.
   - Low Volume: 20-day average price x 20-day average share volume below
     the configured threshold ($5M).
   - Tech: a controlled mapping (tech_classification): explicit symbols
     first, then SIC code ranges. Deterministic; never decided at runtime.
   - Momentum: price above the 50- and 200-day averages and the 50-day
     above the 200-day; needs 200 closes.
   - Dividend and Profitability: not defined by the spec and no data on the
     current plan, so not computed.
   =========================================================================== */

export interface TechRule {
  /** "symbol" matches one ticker; "sic" a range of SIC codes. */
  kind: "symbol" | "sic";
  symbol?: string | null;
  sic_from?: number | null;
  sic_to?: number | null;
  tech: boolean;
}

/** Tech Oriented by the controlled mapping: a symbol rule wins over a SIC range. Null when unknown. */
export const techOriented = (symbol: string, sic: number | null, rules: TechRule[]): boolean | null => {
  const bySymbol = rules.find((r) => r.kind === "symbol" && r.symbol === symbol);
  if (bySymbol) return bySymbol.tech;
  if (sic === null) return null;
  const range = rules.find((r) => r.kind === "sic" && r.sic_from != null && r.sic_to != null && sic >= r.sic_from && sic <= r.sic_to);
  return range ? range.tech : false;
};

export interface ExposureHolding {
  symbol: string;
  value: number;
  market_cap: number | null;
  sic: number | null;
  /** Daily closes and volumes, oldest first (at least the last 200 for momentum). */
  bars: { close: number; volume: number | null }[];
}

export const computeExposures = (input: {
  holdings: ExposureHolding[];
  cash: number;
  rules: TechRule[];
  lowLiquidityUsd?: number;
}) => {
  const threshold = input.lowLiquidityUsd ?? LOW_LIQUIDITY_DOLLAR_VOLUME_USD;
  const total = input.holdings.reduce((s, h) => s + Math.max(0, h.value), 0) + input.cash;
  const w = (h: ExposureHolding) => (total > 0 ? Math.max(0, h.value) / total : 0);
  const per = input.holdings.map((h) => {
    const bucket = h.market_cap === null || !(h.market_cap > 0) ? null : capBucket(h.market_cap);
    const withVolume = h.bars.filter((b) => b.volume !== null) as { close: number; volume: number }[];
    const dv = averageDailyDollarVolume(withVolume);
    const closes = h.bars.map((b) => b.close);
    return {
      symbol: h.symbol,
      weight: w(h),
      market_cap: h.market_cap,
      cap: bucket,
      dollar_volume: dv,
      low_liquidity: dv === null ? null : isLowLiquidity(dv, threshold),
      tech: techOriented(h.symbol, h.sic, input.rules),
      momentum: closes.length ? positiveMomentum(closes[closes.length - 1], closes) : null,
    };
  });
  const exposure = (flag: (p: (typeof per)[number]) => boolean | null) => exposureOf(per.map((p) => ({ weight: p.weight, flag: flag(p) })));
  // Without a market cap a holding is unclassified for both cap exposures.
  const capIs = (p: (typeof per)[number], bucket: "micro" | "small") => (p.market_cap === null || !(p.market_cap > 0) ? null : p.cap === bucket);
  return {
    micro_cap: exposure((p) => capIs(p, "micro")),
    small_cap: exposure((p) => capIs(p, "small")),
    low_volume: exposure((p) => p.low_liquidity),
    tech: exposure((p) => p.tech),
    momentum: exposure((p) => p.momentum),
    cash: total > 0 ? input.cash / total : 0,
    threshold_usd: threshold,
    holdings: per,
  };
};
