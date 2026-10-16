import { describe, expect, it } from "vitest";
import { annualizeVolatility, dailyMoveStats, dailyVolatility, sampleStdDev } from "./volatility";
import { DatedValue } from "./types";

const series = (values: number[]): DatedValue[] =>
  values.map((value, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, value }));

describe("sampleStdDev", () => {
  it("divides by n - 1", () => {
    // mean 5, squared deviations sum to 32, 32 / 7.
    expect(sampleStdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 12);
  });

  it("is null for fewer than two values", () => {
    expect(sampleStdDev([])).toBeNull();
    expect(sampleStdDev([0.01])).toBeNull();
  });
});

describe("dailyVolatility", () => {
  it("uses only the most recent window", () => {
    // An early outlier outside the window must not count.
    const r = series([0.5, 0.01, -0.01, 0.01, -0.01]);
    expect(dailyVolatility(r, 4)).toBeCloseTo(sampleStdDev([0.01, -0.01, 0.01, -0.01])!, 12);
  });

  it("counts up days and down days alike", () => {
    expect(dailyVolatility(series([0.02, -0.02]), 2)).toBeCloseTo(dailyVolatility(series([-0.02, 0.02]), 2)!, 12);
    expect(dailyVolatility(series([0.02, -0.02]), 2)).toBeGreaterThan(0);
  });

  it("is null when there is less history than the window", () => {
    expect(dailyVolatility(series(new Array(89).fill(0.01)))).toBeNull();
    expect(dailyVolatility(series(new Array(90).fill(0.01)))).toBeCloseTo(0, 12);
  });
});

describe("annualizeVolatility", () => {
  it("multiplies by the square root of 252", () => {
    expect(annualizeVolatility(0.01)).toBeCloseTo(0.01 * Math.sqrt(252), 12);
  });
});

describe("dailyMoveStats", () => {
  it("averages up and down days separately and finds the extremes with dates", () => {
    const s = dailyMoveStats(series([0.01, -0.02, 0.03, 0, -0.04]));
    expect(s.average_positive_day).toBeCloseTo(0.02, 12);
    expect(s.average_negative_day).toBeCloseTo(-0.03, 12);
    expect(s.max_daily_gain).toEqual({ date: "2026-01-03", value: 0.03 });
    expect(s.max_daily_loss).toEqual({ date: "2026-01-05", value: -0.04 });
  });

  it("returns nulls where there is nothing to measure", () => {
    const s = dailyMoveStats(series([0, 0]));
    expect(s.average_positive_day).toBeNull();
    expect(s.average_negative_day).toBeNull();
    expect(dailyMoveStats([]).max_daily_gain).toBeNull();
  });

  it("reports the earliest date when two days tie", () => {
    expect(dailyMoveStats(series([0.05, 0.05])).max_daily_gain?.date).toBe("2026-01-01");
  });
});
