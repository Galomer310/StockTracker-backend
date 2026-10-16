import { describe, expect, it } from "vitest";
import { allocationSlices, exposureWeights, investedWeights, weightedAverageBuyPrice } from "./portfolio";

const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);

describe("exposureWeights", () => {
  it("includes cash in the total", () => {
    const w = exposureWeights([{ symbol: "AAPL", market_value: 7500 }], 2500)!;
    expect(w.holdings.AAPL).toBeCloseTo(0.75, 12);
    expect(w.cash).toBeCloseTo(0.25, 12);
  });

  it("combines lots of the same symbol", () => {
    const w = exposureWeights(
      [
        { symbol: "AAPL", market_value: 3000 },
        { symbol: "AAPL", market_value: 2000 },
        { symbol: "MSFT", market_value: 5000 },
      ],
      0
    )!;
    expect(w.holdings).toEqual({ AAPL: 0.5, MSFT: 0.5 });
  });

  it("is null for a portfolio worth nothing, and rejects negative values", () => {
    expect(exposureWeights([], 0)).toBeNull();
    expect(() => exposureWeights([{ symbol: "X", market_value: -1 }], 10)).toThrow(RangeError);
    expect(() => exposureWeights([], -1)).toThrow(RangeError);
  });
});

describe("investedWeights", () => {
  it("leaves cash out", () => {
    const w = investedWeights([
      { symbol: "AAPL", market_value: 3000 },
      { symbol: "MSFT", market_value: 1000 },
    ])!;
    expect(w).toEqual({ AAPL: 0.75, MSFT: 0.25 });
  });

  it("is null with nothing invested", () => {
    expect(investedWeights([])).toBeNull();
  });
});

describe("allocationSlices", () => {
  it("reproduces the spec's example and totals 100%", () => {
    const positions = [
      { symbol: "META", market_value: 3100 },
      { symbol: "NVDA", market_value: 2200 },
      { symbol: "AMZN", market_value: 1700 },
      { symbol: "SOFI", market_value: 1100 },
      { symbol: "PLTR", market_value: 700 },
      { symbol: "AMD", market_value: 300 },
      { symbol: "UBER", market_value: 200 },
    ];
    const slices = allocationSlices(positions, 700)!;
    expect(slices.map((s) => [s.label, Math.round(s.weight * 100)])).toEqual([
      ["META", 31],
      ["NVDA", 22],
      ["AMZN", 17],
      ["SOFI", 11],
      ["PLTR", 7],
      ["Other", 5],
      ["Cash", 7],
    ]);
    expect(sum(slices.map((s) => s.weight))).toBeCloseTo(1, 12);
  });

  it("omits Other when there are five holdings or fewer, but always shows Cash", () => {
    const slices = allocationSlices([{ symbol: "AAPL", market_value: 10000 }], 0)!;
    expect(slices.map((s) => s.label)).toEqual(["AAPL", "Cash"]);
    expect(slices[1].weight).toBe(0);
  });

  it("breaks ties alphabetically so the order is stable", () => {
    const positions = ["F", "E", "D", "C", "B", "A"].map((symbol) => ({ symbol, market_value: 100 }));
    const slices = allocationSlices(positions, 0)!;
    expect(slices.map((s) => s.label)).toEqual(["A", "B", "C", "D", "E", "Other", "Cash"]);
  });

  it("is all cash for a portfolio with no positions", () => {
    expect(allocationSlices([], 10000)).toEqual([{ kind: "cash", label: "Cash", weight: 1 }]);
  });
});

describe("weightedAverageBuyPrice", () => {
  it("weights each purchase by its quantity", () => {
    // 10 at $100 and 30 at $200: (1000 + 6000) / 40 = $175, not the $150 a plain average gives.
    expect(
      weightedAverageBuyPrice([
        { quantity: 10, price: 100 },
        { quantity: 30, price: 200 },
      ])
    ).toBeCloseTo(175, 12);
  });

  it("is null with no lots, and rejects non-positive lots", () => {
    expect(weightedAverageBuyPrice([])).toBeNull();
    expect(() => weightedAverageBuyPrice([{ quantity: 0, price: 10 }])).toThrow(RangeError);
  });
});
