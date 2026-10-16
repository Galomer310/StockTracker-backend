/* ===========================================================================
   Risk Score.
   ---------------------------------------------------------------------------
   A weighted sum of five 0-100 sub-scores, and a classification of the
   result. Both are defined and implemented.

   How each raw measure (volatility, drawdown, liquidity, turnover) becomes
   its 0-100 sub-score is not defined by the spec yet, so riskScore() takes
   sub-scores that have already been normalized.
   =========================================================================== */

import { RISK_BANDS, RISK_WEIGHTS } from "./config";
import { MetricDefinition } from "./types";

export const RISK_SCORE: MetricDefinition = {
  id: "risk_score",
  version: "risk_model_v1",
  sources: ["internal_portfolio_db", "market_data_api", "fundamentals_api"],
  explanation: null,
};

export interface RiskSubScores {
  volatility: number;
  max_drawdown: number;
  concentration: number;
  liquidity: number;
  turnover: number;
}

export const riskScore = (sub: RiskSubScores): number => {
  for (const [k, v] of Object.entries(sub)) {
    if (!(v >= 0 && v <= 100)) throw new RangeError(`${k} must be a 0-100 score; got ${v}`);
  }
  return (
    RISK_WEIGHTS.volatility * sub.volatility +
    RISK_WEIGHTS.max_drawdown * sub.max_drawdown +
    RISK_WEIGHTS.concentration * sub.concentration +
    RISK_WEIGHTS.liquidity * sub.liquidity +
    RISK_WEIGHTS.turnover * sub.turnover
  );
};

export const classifyRisk = (score: number): string => {
  if (!(score >= 0 && score <= 100)) throw new RangeError(`Risk score must be 0-100; got ${score}`);
  return RISK_BANDS.find((band) => score <= band.max)!.label;
};
