import { describe, expect, it } from "vitest";
import { compareToBenchmark, excessReturn, normalizeTo100, periodReturn } from "./benchmark";
import { performanceIndex } from "./returns";

describe("normalizeTo100", () => {
  it("starts every series at 100", () => {
    const s = normalizeTo100([
      { date: "2026-08-15", value: 5400 },
      { date: "2026-08-16", value: 5508 },
    ]);
    expect(s[0].value).toBe(100);
    expect(s[1].value).toBeCloseTo(102, 9);
  });

  it("rejects a series starting at zero", () => {
    expect(() => normalizeTo100([{ date: "2026-08-15", value: 0 }])).toThrow(RangeError);
  });
});

describe("periodReturn and excessReturn", () => {
  it("measures end over start", () => {
    expect(periodReturn([{ date: "a", value: 200 }, { date: "b", value: 250 }])).toBeCloseTo(0.25, 12);
    expect(periodReturn([{ date: "a", value: 200 }])).toBeNull();
  });

  it("subtracts the benchmark from the portfolio", () => {
    expect(excessReturn(0.12, 0.08)).toBeCloseTo(0.04, 12);
    expect(excessReturn(0.02, 0.05)).toBeCloseTo(-0.03, 12);
  });
});

describe("compareToBenchmark", () => {
  const portfolio = performanceIndex([
    { date: "2026-08-15", nav: 10000 },
    { date: "2026-09-15", nav: 11000 },
    { date: "2026-10-15", nav: 12500, external_flow: 1000 },
  ]);

  it("compares over identical start and end dates, with game capital excluded", () => {
    const spx = [
      { date: "2026-08-15", value: 6000 },
      { date: "2026-09-01", value: 6100 },
      { date: "2026-10-15", value: 6300 },
    ];
    const c = compareToBenchmark(portfolio, spx);
    // Portfolio: 1.10 × (11500 / 11000) - 1 = 15%. Benchmark: 5%.
    expect(c.portfolio_return).toBeCloseTo(0.15, 12);
    expect(c.benchmark_return).toBeCloseTo(0.05, 12);
    expect(c.excess_return).toBeCloseTo(0.1, 12);
    expect([c.start, c.end]).toEqual(["2026-08-15", "2026-10-15"]);
  });

  it("refuses a benchmark that starts on a different date", () => {
    const late = [
      { date: "2026-08-16", value: 6000 },
      { date: "2026-10-15", value: 6300 },
    ];
    expect(() => compareToBenchmark(portfolio, late)).toThrow(/2026-08-15 to 2026-10-15/);
  });

  it("refuses a benchmark that ends on a different date", () => {
    const early = [
      { date: "2026-08-15", value: 6000 },
      { date: "2026-10-14", value: 6300 },
    ];
    expect(() => compareToBenchmark(portfolio, early)).toThrow(RangeError);
  });
});
