import { describe, expect, it } from "vitest";
import {
  averageDailyDollarVolume,
  capBucket,
  exposureOf,
  isLowLiquidity,
  positiveMomentum,
  simpleMovingAverage,
} from "./exposure";

describe("capBucket", () => {
  it("separates micro and small caps at $100M, with no overlap", () => {
    expect(capBucket(99_999_999)).toBe("micro");
    expect(capBucket(100_000_000)).toBe("small");
  });

  it("ends small cap just below $1B", () => {
    expect(capBucket(999_999_999)).toBe("small");
    expect(capBucket(1_000_000_000)).toBeNull();
  });

  it("rejects a negative market cap", () => {
    expect(() => capBucket(-1)).toThrow(RangeError);
  });
});

describe("exposureOf", () => {
  it("sums the weights that meet the test and keeps unknowns separate", () => {
    const e = exposureOf([
      { weight: 0.3, flag: true },
      { weight: 0.2, flag: false },
      { weight: 0.1, flag: true },
      { weight: 0.15, flag: null },
    ]);
    expect(e.value).toBeCloseTo(0.4, 12);
    expect(e.unclassified).toBeCloseTo(0.15, 12);
  });

  it("gives micro and small cap exposures that add up without double counting", () => {
    const holdings = [
      { weight: 0.2, cap: 50e6 },
      { weight: 0.3, cap: 100e6 },
      { weight: 0.4, cap: 5e9 },
    ];
    const micro = exposureOf(holdings.map((h) => ({ weight: h.weight, flag: capBucket(h.cap) === "micro" })));
    const small = exposureOf(holdings.map((h) => ({ weight: h.weight, flag: capBucket(h.cap) === "small" })));
    expect(micro.value).toBeCloseTo(0.2, 12);
    expect(small.value).toBeCloseTo(0.3, 12);
  });
});

describe("averageDailyDollarVolume", () => {
  it("multiplies the average price by the average volume over the last 20 days", () => {
    const bars = [
      ...Array.from({ length: 5 }, () => ({ close: 1000, volume: 1 })), // outside the window
      ...Array.from({ length: 10 }, () => ({ close: 10, volume: 100_000 })),
      ...Array.from({ length: 10 }, () => ({ close: 20, volume: 300_000 })),
    ];
    // avg price 15 × avg volume 200,000 = 3,000,000
    expect(averageDailyDollarVolume(bars)).toBeCloseTo(3_000_000, 6);
  });

  it("is the product of averages, not the average of products", () => {
    const bars = [
      ...Array.from({ length: 10 }, () => ({ close: 10, volume: 100_000 })),
      ...Array.from({ length: 10 }, () => ({ close: 20, volume: 300_000 })),
    ];
    const averageOfProducts = (10 * 100_000 + 20 * 300_000) / 2; // 3,500,000
    expect(averageDailyDollarVolume(bars)).not.toBeCloseTo(averageOfProducts, 0);
  });

  it("is null with fewer than 20 bars", () => {
    expect(averageDailyDollarVolume(Array.from({ length: 19 }, () => ({ close: 1, volume: 1 })))).toBeNull();
  });
});

describe("isLowLiquidity", () => {
  it("flags dollar volume below $5M by default", () => {
    expect(isLowLiquidity(4_999_999)).toBe(true);
    expect(isLowLiquidity(5_000_000)).toBe(false);
  });

  it("takes the threshold as a parameter", () => {
    expect(isLowLiquidity(4_000_000, 1_000_000)).toBe(false);
  });
});

describe("momentum", () => {
  const rising = Array.from({ length: 200 }, (_, i) => 100 + i); // 100 .. 299

  it("averages the last n closes", () => {
    expect(simpleMovingAverage([1, 2, 3, 4], 2)).toBe(3.5);
    expect(simpleMovingAverage([1], 2)).toBeNull();
  });

  it("is positive in a steady uptrend", () => {
    // MA50 = 274.5, MA200 = 199.5, price 300.
    expect(positiveMomentum(300, rising)).toBe(true);
  });

  it("needs all three conditions", () => {
    // Price below the 50-day average.
    expect(positiveMomentum(250, rising)).toBe(false);
    // Price above both averages, but the 50-day sits below the 200-day.
    const falling = [...rising].reverse(); // MA50 = 124.5, MA200 = 199.5
    expect(positiveMomentum(210, falling)).toBe(false);
  });

  it("is null with fewer than 200 closes", () => {
    expect(positiveMomentum(300, rising.slice(1))).toBeNull();
  });
});
