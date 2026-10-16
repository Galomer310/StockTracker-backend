/* ===========================================================================
   Drawdown.
   ---------------------------------------------------------------------------
   The decline from the highest value reached so far, not the worst single
   day:

     Drawdown = (Current NAV - Previous Peak NAV) / Previous Peak NAV

   Measured on the flow-free performance index from returns.ts rather than on
   raw NAV. On raw NAV a game reward would lift the peak, and an ordinary dip
   afterwards would be measured from a high the player never earned.

   Which window counts as "the selected history" is not yet decided, so the
   caller chooses it by what it passes in.
   =========================================================================== */

import { DatedValue, MetricDefinition } from "./types";

export const MAX_DRAWDOWN: MetricDefinition = {
  id: "max_drawdown",
  version: "drawdown_model_v1",
  sources: ["internal_portfolio_db", "market_data_api"],
  explanation: null,
};

// Drawdown on every date: 0 at a new high, negative below it.
export const drawdownSeries = (index: DatedValue[]): DatedValue[] => {
  let peak = -Infinity;
  return index.map(({ date, value }) => {
    if (!(value > 0)) throw new RangeError(`Index values must be positive; got ${value} on ${date}`);
    peak = Math.max(peak, value);
    return { date, value: (value - peak) / peak };
  });
};

export interface MaxDrawdown {
  /** Zero or negative: -0.25 is a fall of 25% from the peak. */
  value: number;
  /** Null when the series never fell below a previous peak. */
  peak_date: string | null;
  trough_date: string | null;
}

export const maxDrawdown = (index: DatedValue[]): MaxDrawdown | null => {
  if (index.length === 0) return null;

  let peak = index[0];
  let worst: MaxDrawdown = { value: 0, peak_date: null, trough_date: null };
  for (const point of index) {
    if (!(point.value > 0)) throw new RangeError(`Index values must be positive; got ${point.value} on ${point.date}`);
    if (point.value > peak.value) peak = point;
    const dd = (point.value - peak.value) / peak.value;
    if (dd < worst.value) worst = { value: dd, peak_date: peak.date, trough_date: point.date };
  }
  return worst;
};
