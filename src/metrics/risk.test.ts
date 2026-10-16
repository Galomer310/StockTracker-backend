import { describe, expect, it } from "vitest";
import { classifyRisk, riskScore } from "./risk";

describe("riskScore", () => {
  it("weights the sub-scores 30 / 25 / 20 / 15 / 10", () => {
    expect(riskScore({ volatility: 100, max_drawdown: 0, concentration: 0, liquidity: 0, turnover: 0 })).toBeCloseTo(30, 12);
    expect(riskScore({ volatility: 0, max_drawdown: 0, concentration: 0, liquidity: 0, turnover: 100 })).toBeCloseTo(10, 12);
    expect(riskScore({ volatility: 60, max_drawdown: 40, concentration: 50, liquidity: 20, turnover: 80 })).toBeCloseTo(
      0.3 * 60 + 0.25 * 40 + 0.2 * 50 + 0.15 * 20 + 0.1 * 80,
      12
    );
  });

  it("stays within 0-100", () => {
    const all = (v: number) => ({ volatility: v, max_drawdown: v, concentration: v, liquidity: v, turnover: v });
    expect(riskScore(all(0))).toBe(0);
    expect(riskScore(all(100))).toBeCloseTo(100, 12);
  });

  it("rejects sub-scores outside 0-100", () => {
    expect(() => riskScore({ volatility: -5, max_drawdown: 0, concentration: 0, liquidity: 0, turnover: 0 })).toThrow(RangeError);
  });
});

describe("classifyRisk", () => {
  it("applies the five bands at their boundaries", () => {
    expect(classifyRisk(0)).toBe("Very Low");
    expect(classifyRisk(20)).toBe("Very Low");
    expect(classifyRisk(21)).toBe("Low");
    expect(classifyRisk(40)).toBe("Low");
    expect(classifyRisk(41)).toBe("Medium");
    expect(classifyRisk(60)).toBe("Medium");
    expect(classifyRisk(61)).toBe("High");
    expect(classifyRisk(80)).toBe("High");
    expect(classifyRisk(81)).toBe("Very High");
    expect(classifyRisk(100)).toBe("Very High");
  });

  it("puts a fractional score between two bands into the higher one", () => {
    expect(classifyRisk(20.5)).toBe("Low");
  });

  it("rejects scores outside 0-100", () => {
    expect(() => classifyRisk(101)).toThrow(RangeError);
    expect(() => classifyRisk(NaN)).toThrow(RangeError);
  });
});
