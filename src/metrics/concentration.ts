/* ===========================================================================
   Concentration and diversification.
   ---------------------------------------------------------------------------
   The raw measures - Effective Holdings, Largest Position, Top 3, Largest
   Sector and Sector HHI - are fully defined and computed here.

   The Concentration Score is a weighted sum of four 0-100 sub-scores, and
   the weighted sum is implemented. Turning a raw measure INTO its sub-score
   is not defined by the spec yet, so concentrationScore() takes sub-scores
   that have already been normalized and does not produce them.

   Whether Largest Position, Top 3 and the sector measures use exposure
   weights (cash in the total) or invested weights is also undecided, so
   those functions take whichever weights the caller passes.
   =========================================================================== */

import { CONCENTRATION_WEIGHTS, TOP_HOLDINGS_N } from "./config";
import { MetricDefinition } from "./types";
import { Weights } from "./portfolio";

export const CONCENTRATION: MetricDefinition = {
  id: "concentration_score",
  version: "concentration_model_v1",
  sources: ["internal_portfolio_db", "market_data_api", "fundamentals_api"],
  explanation: null,
};

export const DIVERSIFICATION: MetricDefinition = {
  id: "diversification_score",
  version: "diversification_model_v1",
  sources: CONCENTRATION.sources,
  explanation: null,
};

// Effective Holdings = 1 / Σ(weight²), over invested holdings only.
//
// The weights are rescaled to sum to 1 first, so passing exposure weights
// (which leave a share for cash) gives the same answer as invested weights:
// cash is never counted as a company. Ten equal holdings give 10; one
// dominant holding gives a figure close to 1.
export const effectiveHoldings = (weights: Weights): number | null => {
  const ws = Object.values(weights);
  const total = ws.reduce((s, w) => s + w, 0);
  if (!(total > 0)) return null;
  return 1 / ws.reduce((s, w) => s + (w / total) ** 2, 0);
};

export const largestPosition = (weights: Weights): { symbol: string; weight: number } | null => {
  let best: { symbol: string; weight: number } | null = null;
  for (const [symbol, weight] of Object.entries(weights)) {
    if (!best || weight > best.weight || (weight === best.weight && symbol < best.symbol)) {
      best = { symbol, weight };
    }
  }
  return best;
};

// Combined weight of the N largest holdings.
export const topHoldingsWeight = (weights: Weights, n = TOP_HOLDINGS_N): number =>
  Object.values(weights)
    .sort((a, b) => b - a)
    .slice(0, n)
    .reduce((s, w) => s + w, 0);

export interface SectorHolding {
  weight: number;
  sector: string;
}

// Sums holding weights by sector. Every holding must carry a sector: what to
// do with a security the security master has not classified is a data
// question for the caller, not something to guess at here.
export const sectorWeights = (holdings: SectorHolding[]): Weights => {
  const out: Weights = {};
  for (const { weight, sector } of holdings) out[sector] = (out[sector] ?? 0) + weight;
  return out;
};

// Sector HHI = Σ(sector weight²). Twenty stocks in one sector score the same
// as one stock: a full 1 (on weights summing to 1).
export const sectorHHI = (sectors: Weights): number =>
  Object.values(sectors).reduce((s, w) => s + w ** 2, 0);

export const largestSectorWeight = (sectors: Weights): number =>
  Object.values(sectors).reduce((m, w) => Math.max(m, w), 0);

export interface ConcentrationSubScores {
  effective_holdings: number;
  largest_position: number;
  top_3_holdings: number;
  sector_concentration: number;
}

const assertScore = (name: string, v: number): void => {
  if (!(v >= 0 && v <= 100)) throw new RangeError(`${name} must be a 0-100 score; got ${v}`);
};

export const concentrationScore = (sub: ConcentrationSubScores): number => {
  for (const [k, v] of Object.entries(sub)) assertScore(k, v);
  return (
    CONCENTRATION_WEIGHTS.effective_holdings * sub.effective_holdings +
    CONCENTRATION_WEIGHTS.largest_position * sub.largest_position +
    CONCENTRATION_WEIGHTS.top_3_holdings * sub.top_3_holdings +
    CONCENTRATION_WEIGHTS.sector_concentration * sub.sector_concentration
  );
};

// Defined as the complement of concentration, so the two can never disagree.
export const diversificationScore = (concentration: number): number => {
  assertScore("concentration", concentration);
  return 100 - concentration;
};
