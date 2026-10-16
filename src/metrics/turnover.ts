/* ===========================================================================
   Portfolio turnover.
   ---------------------------------------------------------------------------
   How much of the portfolio one change replaced:

     Turnover Event = 0.5 × Σ |Weight After - Weight Before|

   A holding missing from one side counts as weight 0 there, so opening or
   closing a position is counted in full. Selling all of A to buy B is 100%.

   Two things are undecided and left to the caller: whether cash is one of
   the weights (it changes the answer), and how event turnovers combine into
   the rolling 90-day figure. This file therefore stops at the single event.
   =========================================================================== */

import { MetricDefinition } from "./types";
import { Weights } from "./portfolio";

export const PORTFOLIO_TURNOVER: MetricDefinition = {
  id: "portfolio_turnover",
  version: "turnover_model_v1",
  sources: ["internal_portfolio_db", "market_data_api"],
  explanation: null,
};

export const turnoverEvent = (before: Weights, after: Weights): number => {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  let moved = 0;
  for (const k of keys) moved += Math.abs((after[k] ?? 0) - (before[k] ?? 0));
  return 0.5 * moved;
};
