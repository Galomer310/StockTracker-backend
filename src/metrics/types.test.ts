import { describe, expect, it } from "vitest";
import { RISK_SCORE, classifyRisk, riskScore, toResult } from "./index";

describe("toResult", () => {
  it("records the formula version, sources and time alongside the value", () => {
    const score = riskScore({ volatility: 50, max_drawdown: 50, concentration: 50, liquidity: 50, turnover: 50 });
    const r = toResult(RISK_SCORE, score, {
      calculatedAt: new Date("2026-10-16T12:00:00Z"),
      normalized: score,
      classification: classifyRisk(score),
    });
    expect(r).toEqual({
      metric_id: "risk_score",
      metric_version: "risk_model_v1",
      raw_value: 50,
      normalized_score: 50,
      classification: "Medium",
      calculated_at: "2026-10-16T12:00:00.000Z",
      data_sources: ["internal_portfolio_db", "market_data_api", "fundamentals_api"],
      explanation: null,
    });
  });

  it("does not share its sources array with the definition", () => {
    const r = toResult(RISK_SCORE, null, { calculatedAt: new Date(0) });
    r.data_sources.push("game_engine");
    expect(RISK_SCORE.sources).not.toContain("game_engine");
    expect(r.raw_value).toBeNull();
    expect(r.classification).toBeNull();
  });
});
