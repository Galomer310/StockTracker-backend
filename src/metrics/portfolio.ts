/* ===========================================================================
   Portfolio composition.
   ---------------------------------------------------------------------------
   Two kinds of weight, because the spec uses both:

   - Exposure weights divide by the whole portfolio, cash included:
       Current Exposure = Position Market Value / Portfolio Market Value
     This is what the allocation chart and every Module 4 exposure show.

   - Invested weights divide by the positions only, leaving cash out. The
     spec asks for these in Effective Holdings, so that cash is not counted
     as if it were a company.

   Lots of the same symbol are combined into one position before weighing.
   =========================================================================== */

import { ALLOCATION_TOP_N } from "./config";

export interface PositionValue {
  symbol: string;
  /** Current market value of this lot or position, in USD. */
  market_value: number;
}

export type Weights = Record<string, number>;

const combine = (positions: PositionValue[]): Weights => {
  const out: Weights = {};
  for (const { symbol, market_value } of positions) {
    if (!(market_value >= 0)) throw new RangeError(`Market value must be zero or more; got ${market_value} for ${symbol}`);
    out[symbol] = (out[symbol] ?? 0) + market_value;
  }
  return out;
};

const scale = (values: Weights, total: number): Weights =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v / total]));

export interface ExposureWeights {
  holdings: Weights;
  cash: number;
}

// Null when the portfolio is worth nothing, since no share of zero exists.
export const exposureWeights = (positions: PositionValue[], cash: number): ExposureWeights | null => {
  if (!(cash >= 0)) throw new RangeError(`Cash must be zero or more; got ${cash}`);
  const values = combine(positions);
  const total = Object.values(values).reduce((s, v) => s + v, 0) + cash;
  if (total === 0) return null;
  return { holdings: scale(values, total), cash: cash / total };
};

export const investedWeights = (positions: PositionValue[]): Weights | null => {
  const values = combine(positions);
  const total = Object.values(values).reduce((s, v) => s + v, 0);
  return total === 0 ? null : scale(values, total);
};

export interface AllocationSlice {
  kind: "holding" | "other" | "cash";
  /** The symbol for a holding; "Other" or "Cash" otherwise. */
  label: string;
  weight: number;
}

// The Module 1 chart: the N largest holdings, then Other, then Cash. Always
// totals 1 (100%) because every slice is a share of the same total. Other is
// omitted when there is nothing in it; Cash is always shown, since "Cash
// Available" is one of the slices the spec requires.
//
// Ties for the last place are broken alphabetically, so the chart does not
// reshuffle between two renders of the same data.
export const allocationSlices = (
  positions: PositionValue[],
  cash: number,
  topN = ALLOCATION_TOP_N
): AllocationSlice[] | null => {
  const w = exposureWeights(positions, cash);
  if (!w) return null;

  const ranked = Object.entries(w.holdings).sort(([a, wa], [b, wb]) => wb - wa || a.localeCompare(b));
  const slices: AllocationSlice[] = ranked
    .slice(0, topN)
    .map(([symbol, weight]) => ({ kind: "holding", label: symbol, weight }));

  const other = ranked.slice(topN).reduce((s, [, weight]) => s + weight, 0);
  if (other > 0) slices.push({ kind: "other", label: "Other", weight: other });
  slices.push({ kind: "cash", label: "Cash", weight: w.cash });
  return slices;
};

export interface Lot {
  quantity: number;
  price: number;
}

// AVG Buy Price: the purchase price of each lot of the ACTIVE position,
// weighted by its quantity. Lots already sold are not passed in.
export const weightedAverageBuyPrice = (lots: Lot[]): number | null => {
  let qty = 0;
  let cost = 0;
  for (const { quantity, price } of lots) {
    if (!(quantity > 0) || !(price > 0)) {
      throw new RangeError(`Lots need a positive quantity and price; got ${quantity} at ${price}`);
    }
    qty += quantity;
    cost += quantity * price;
  }
  return qty === 0 ? null : cost / qty;
};
