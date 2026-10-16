import { describe, expect, it } from "vitest";
import {
  concentrationScore,
  diversificationScore,
  effectiveHoldings,
  largestPosition,
  largestSectorWeight,
  sectorHHI,
  sectorWeights,
  topHoldingsWeight,
} from "./concentration";

describe("effectiveHoldings", () => {
  it("is the number of holdings when they are equal", () => {
    const ten = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`S${i}`, 0.1]));
    expect(effectiveHoldings(ten)).toBeCloseTo(10, 12);
  });

  it("falls toward 1 as one holding dominates", () => {
    // 1 / (0.9² + 0.1²) = 1 / 0.82
    expect(effectiveHoldings({ A: 0.9, B: 0.1 })).toBeCloseTo(1 / 0.82, 12);
  });

  it("does not count cash as a company", () => {
    // Exposure weights leaving 50% in cash give the same answer as invested weights.
    expect(effectiveHoldings({ A: 0.25, B: 0.25 })).toBeCloseTo(effectiveHoldings({ A: 0.5, B: 0.5 })!, 12);
    expect(effectiveHoldings({ A: 0.25, B: 0.25 })).toBeCloseTo(2, 12);
  });

  it("is null with nothing invested", () => {
    expect(effectiveHoldings({})).toBeNull();
  });
});

describe("largestPosition and topHoldingsWeight", () => {
  const w = { A: 0.1, B: 0.4, C: 0.2, D: 0.3 };

  it("finds the single largest holding", () => {
    expect(largestPosition(w)).toEqual({ symbol: "B", weight: 0.4 });
    expect(largestPosition({})).toBeNull();
  });

  it("breaks a tie alphabetically", () => {
    expect(largestPosition({ Z: 0.5, A: 0.5 })?.symbol).toBe("A");
  });

  it("sums the three largest", () => {
    expect(topHoldingsWeight(w)).toBeCloseTo(0.9, 12);
    expect(topHoldingsWeight({ A: 0.6 })).toBeCloseTo(0.6, 12);
  });
});

describe("sector concentration", () => {
  it("treats twenty stocks in one sector as fully concentrated", () => {
    const holdings = Array.from({ length: 20 }, () => ({ weight: 0.05, sector: "Technology" }));
    const sectors = sectorWeights(holdings);
    expect(sectors.Technology).toBeCloseTo(1, 12);
    expect(sectorHHI(sectors)).toBeCloseTo(1, 12);
    expect(largestSectorWeight(sectors)).toBeCloseTo(1, 12);
  });

  it("computes HHI across sectors", () => {
    const sectors = sectorWeights([
      { weight: 0.3, sector: "Technology" },
      { weight: 0.2, sector: "Technology" },
      { weight: 0.3, sector: "Energy" },
      { weight: 0.2, sector: "Health Care" },
    ]);
    // 0.5² + 0.3² + 0.2² = 0.38
    expect(sectorHHI(sectors)).toBeCloseTo(0.38, 12);
    expect(largestSectorWeight(sectors)).toBeCloseTo(0.5, 12);
  });
});

describe("concentrationScore and diversificationScore", () => {
  it("weights the sub-scores 40 / 25 / 15 / 20", () => {
    expect(
      concentrationScore({ effective_holdings: 100, largest_position: 0, top_3_holdings: 0, sector_concentration: 0 })
    ).toBeCloseTo(40, 12);
    expect(
      concentrationScore({ effective_holdings: 50, largest_position: 80, top_3_holdings: 60, sector_concentration: 10 })
    ).toBeCloseTo(0.4 * 50 + 0.25 * 80 + 0.15 * 60 + 0.2 * 10, 12);
  });

  it("is bounded: all zeros give 0 and all hundreds give 100", () => {
    const all = (v: number) => ({ effective_holdings: v, largest_position: v, top_3_holdings: v, sector_concentration: v });
    expect(concentrationScore(all(0))).toBe(0);
    expect(concentrationScore(all(100))).toBeCloseTo(100, 12);
  });

  it("rejects sub-scores outside 0-100", () => {
    expect(() =>
      concentrationScore({ effective_holdings: 101, largest_position: 0, top_3_holdings: 0, sector_concentration: 0 })
    ).toThrow(RangeError);
  });

  it("makes diversification the exact complement", () => {
    expect(diversificationScore(35)).toBe(65);
    expect(() => diversificationScore(-1)).toThrow(RangeError);
  });
});
