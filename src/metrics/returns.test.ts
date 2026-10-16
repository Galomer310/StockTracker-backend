import { describe, expect, it } from "vitest";
import { chainReturns, dailyReturns, performanceIndex, totalReturn } from "./returns";

describe("dailyReturns", () => {
  it("is NAV(today) / NAV(previous) - 1 when there is no flow", () => {
    const r = dailyReturns([
      { date: "2026-08-03", nav: 10000 },
      { date: "2026-08-04", nav: 10200 },
      { date: "2026-08-05", nav: 9996 },
    ]);
    expect(r.map((x) => x.date)).toEqual(["2026-08-04", "2026-08-05"]);
    expect(r[0].value).toBeCloseTo(0.02, 12);
    expect(r[1].value).toBeCloseTo(-0.02, 12);
  });

  it("does not count game-earned capital as a return", () => {
    const r = dailyReturns([
      { date: "2026-08-03", nav: 11000 },
      { date: "2026-08-04", nav: 12000, external_flow: 1000 },
    ]);
    expect(r[0].value).toBeCloseTo(0, 12);
  });

  it("still counts the market move on the day a flow arrives", () => {
    // 11000 grows 1% to 11110, then a 1000 reward lands.
    const r = dailyReturns([
      { date: "2026-08-03", nav: 11000 },
      { date: "2026-08-04", nav: 12110, external_flow: 1000 },
    ]);
    expect(r[0].value).toBeCloseTo(0.01, 12);
  });

  it("rejects series out of date order and non-positive NAV", () => {
    expect(() =>
      dailyReturns([
        { date: "2026-08-04", nav: 1 },
        { date: "2026-08-03", nav: 1 },
      ])
    ).toThrow(RangeError);
    expect(() =>
      dailyReturns([
        { date: "2026-08-03", nav: 0 },
        { date: "2026-08-04", nav: 1 },
      ])
    ).toThrow(RangeError);
  });
});

describe("totalReturn", () => {
  it("keeps the spec's example at +10%, not +20%", () => {
    // Starting capital 10,000; +10% from investing; then a 1,000 reward.
    const series = [
      { date: "2026-08-15", nav: 10000 },
      { date: "2026-08-20", nav: 11000 },
      { date: "2026-08-21", nav: 12000, external_flow: 1000 },
    ];
    expect(totalReturn(series)).toBeCloseTo(0.1, 12);
  });

  it("lets earned capital earn a return once it is invested", () => {
    // After the reward the whole 12,000 rises 5%: 1.10 * 1.05 - 1 = 15.5%.
    const series = [
      { date: "2026-08-15", nav: 10000 },
      { date: "2026-08-20", nav: 11000 },
      { date: "2026-08-21", nav: 12000, external_flow: 1000 },
      { date: "2026-08-24", nav: 12600 },
    ];
    expect(totalReturn(series)).toBeCloseTo(0.155, 12);
  });

  it("is null without at least two points", () => {
    expect(totalReturn([])).toBeNull();
    expect(totalReturn([{ date: "2026-08-15", nav: 10000 }])).toBeNull();
  });
});

describe("chainReturns", () => {
  it("compounds rather than adds", () => {
    expect(chainReturns([0.1, -0.1])).toBeCloseTo(-0.01, 12);
    expect(chainReturns([])).toBe(0);
  });
});

describe("performanceIndex", () => {
  it("starts at the base and ignores flows", () => {
    const idx = performanceIndex([
      { date: "2026-08-15", nav: 10000 },
      { date: "2026-08-20", nav: 11000 },
      { date: "2026-08-21", nav: 12000, external_flow: 1000 },
    ]);
    expect(idx.map((p) => p.value)).toEqual([100, expect.closeTo(110, 9), expect.closeTo(110, 9)]);
  });
});
