import { describe, expect, it } from "vitest";
import { addDays } from "./history";
import {
  bandOf,
  computeProfile,
  DEFAULT_SCALES,
  effectiveHoldingsScore,
  holdingPeriods,
  investedOnly,
  linearScore,
  ProfileInput,
  weightedMedian,
} from "./profile";

const base = (over: Partial<ProfileInput> = {}): ProfileInput => ({
  today: "2026-11-09",
  points: null,
  holdings: [],
  cash: 10000,
  dollarVolume: {},
  events: [],
  trades: [],
  ...over,
});

// n sessions after an opening point, alternating +a / -a.
const zigzag = (n: number, a: number) => {
  const pts = [{ date: "2026-01-01", index: 1, estimated: false }];
  for (let i = 1; i <= n; i++) {
    const prev = pts[pts.length - 1].index;
    pts.push({ date: addDays("2026-01-01", i), index: prev * (i % 2 ? 1 + a : 1 - a), estimated: false });
  }
  return pts;
};

describe("scales (approved 2026-11-09)", () => {
  it("linear and clamped", () => {
    expect(linearScore(0.05, DEFAULT_SCALES.volatility)).toBe(0);
    expect(linearScore(0.3, DEFAULT_SCALES.volatility)).toBeCloseTo(50);
    expect(linearScore(0.9, DEFAULT_SCALES.volatility)).toBe(100);
    expect(linearScore(0.01, DEFAULT_SCALES.volatility)).toBe(0);
    expect(linearScore(1, DEFAULT_SCALES.turnover)).toBeCloseTo(50);
  });
  it("effective holdings on a log scale: 1 -> 100, 20+ -> 0", () => {
    expect(effectiveHoldingsScore(1, 20)).toBe(100);
    expect(effectiveHoldingsScore(20, 20)).toBe(0);
    expect(effectiveHoldingsScore(30, 20)).toBe(0);
    expect(effectiveHoldingsScore(Math.sqrt(20), 20)).toBeCloseTo(50);
  });
  it("bands as the spec states them", () => {
    expect([0, 20, 20.5, 40, 60, 80, 100].map(bandOf)).toEqual(["Very Low", "Very Low", "Low", "Low", "Medium", "High", "Very High"]);
  });
});

describe("helpers", () => {
  it("investedOnly drops cash and rescales", () => {
    expect(investedOnly({ A: 0.25, B: 0.25, CASH: 0.5 })).toEqual({ A: 0.5, B: 0.5 });
    expect(investedOnly({ CASH: 1 })).toEqual({});
  });
  it("holding periods: FIFO, open lots to today", () => {
    const p = holdingPeriods(
      [
        { date: "2026-01-01", symbol: "A", action: "buy", quantity: 10, price: 10 },
        { date: "2026-01-11", symbol: "A", action: "buy", quantity: 10, price: 20 },
        { date: "2026-01-21", symbol: "A", action: "sell", quantity: 15, price: 30 },
      ],
      "2026-01-31"
    );
    expect(p).toEqual([
      { days: 20, amount: 100, open: false },
      { days: 10, amount: 100, open: false },
      { days: 20, amount: 100, open: true },
    ]);
  });
  it("weighted median", () => {
    expect(weightedMedian([{ value: 5, weight: 1 }, { value: 100, weight: 3 }])).toBe(100);
    expect(weightedMedian([{ value: 5, weight: 3 }, { value: 100, weight: 1 }])).toBe(5);
    expect(weightedMedian([])).toBeNull();
  });
});

describe("computeProfile", () => {
  it("all cash, no history: nothing to measure yet", () => {
    const p = computeProfile(base());
    expect(p.risk).toEqual({ available: false, reason: "too_short" });
    expect(p.volatility).toMatchObject({ available: false, reason: "too_short", sessions: 0 });
    expect(p.diversification).toEqual({ available: false, reason: "no_holdings" });
    expect(p.horizon).toEqual({ available: false, reason: "no_holdings" });
    expect(p.turnover.value).toBe(0);
  });

  it("volatility annualized over the window once there are 20 sessions", () => {
    expect(computeProfile(base({ points: zigzag(19, 0.01) })).volatility.available).toBe(false);
    const v = computeProfile(base({ points: zigzag(30, 0.01) })).volatility;
    if (!v.available) throw new Error("expected volatility");
    expect(v.sessions).toBe(30);
    expect(v.full_window).toBe(false);
    expect(v.annualized).toBeCloseTo(0.01 * Math.sqrt(30 / 29) * Math.sqrt(252), 6);
    expect(v.average_positive_day).toBeCloseTo(0.01);
    expect(v.average_negative_day).toBeCloseTo(-0.01);
    const full = computeProfile(base({ points: zigzag(120, 0.01) })).volatility;
    expect(full.available && full.sessions).toBe(90);
  });

  it("twenty stocks in one sector are still concentrated", () => {
    const holdings = Array.from({ length: 20 }, (_, i) => ({ symbol: `S${i}`, value: 500, sector: "Technology" }));
    const d = computeProfile(base({ holdings, cash: 0 })).diversification;
    if (!d.available) throw new Error("expected diversification");
    const parts = d.parts as any;
    expect(parts.effective_holdings.score).toBeCloseTo(0);
    expect(parts.largest_position.score).toBe(0);
    expect(parts.sector.score).toBe(100);
    expect(d.concentration).toBeCloseTo(0.2 * 100);
    // Same twenty across twenty sectors: fully diversified.
    const spread = computeProfile(base({ holdings: holdings.map((h, i) => ({ ...h, sector: `X${i}` })), cash: 0 })).diversification;
    expect(spread.available && spread.score).toBeCloseTo(100);
  });

  it("one holding, unclassified: maximally concentrated, cash ignored", () => {
    const d = computeProfile(base({ holdings: [{ symbol: "A", value: 100, sector: null }], cash: 9900 })).diversification;
    if (!d.available) throw new Error("expected diversification");
    expect(d.concentration).toBeCloseTo(100);
    expect(d.band).toBe("Very Low");
    expect((d.parts as any).sector).toMatchObject({ largest: null, unclassified: ["A"] });
  });

  it("liquidity: portfolio weight below $5M a day; no data at all blocks Risk", () => {
    const holdings = [
      { symbol: "BIG", value: 5000, sector: "A" },
      { symbol: "TINY", value: 2500, sector: "B" },
    ];
    const p = computeProfile(base({ holdings, cash: 2500, dollarVolume: { BIG: 1e9, TINY: 1e6 }, points: zigzag(30, 0.01) }));
    expect(p.liquidity).toMatchObject({ low_liquidity_weight: 0.25, unknown: [] });
    expect(p.liquidity!.score).toBeCloseTo(50);
    const none = computeProfile(base({ holdings, cash: 2500, points: zigzag(30, 0.01) }));
    expect(none.liquidity).toBeNull();
    expect(none.risk).toEqual({ available: false, reason: "missing_data" });
  });

  it("turnover: invested weights, last 90 days, buying from cash replaces nothing", () => {
    const events = [
      { date: "2026-10-01", before: { CASH: 1 }, after: { A: 0.5, CASH: 0.5 } }, // first buy: 0
      { date: "2026-10-02", before: { A: 0.5, CASH: 0.5 }, after: { A: 0.5, B: 0.25, CASH: 0.25 } }, // A 1 -> 2/3
      { date: "2026-10-03", before: { A: 0.5, B: 0.25, CASH: 0.25 }, after: { B: 0.25, CASH: 0.75 } }, // sell all A
      { date: "2026-07-01", before: { A: 0.5, CASH: 0.5 }, after: { B: 0.5, CASH: 0.5 } }, // too old
    ];
    const t = computeProfile(base({ events })).turnover;
    expect(t.events).toBe(3);
    expect(t.value).toBeCloseTo(1 / 3 + 2 / 3);
    expect(t.score).toBeCloseTo(50);
  });

  it("horizon: weighted median days and category", () => {
    const trades = [
      { date: "2026-11-01", symbol: "A", action: "buy" as const, quantity: 1, price: 100 }, // 8 days, small
      { date: "2026-06-01", symbol: "B", action: "buy" as const, quantity: 10, price: 100 }, // 161 days, large
    ];
    const h = computeProfile(base({ trades })).horizon;
    expect(h).toMatchObject({ available: true, median_days: 161, category: "Long", meter: 75, open_lots: 2 });
    const short = computeProfile(base({ trades: [{ ...trades[0], date: "2026-11-05" }] })).horizon;
    expect(short).toMatchObject({ median_days: 4, category: "Very Short", meter: 0 });
  });

  it("risk: the spec's weighted sum of the five sub-scores", () => {
    const holdings = [{ symbol: "A", value: 10000, sector: "Tech" }];
    const p = computeProfile(base({ holdings, cash: 0, dollarVolume: { A: 1e9 }, points: zigzag(40, 0.02) }));
    if (!p.risk.available || !p.volatility.available) throw new Error("expected risk");
    const c = p.risk.components;
    expect(c.concentration).toBeCloseTo(100);
    expect(c.liquidity).toBe(0);
    expect(p.risk.score).toBeCloseTo(0.3 * c.volatility + 0.25 * c.max_drawdown + 0.2 * 100 + 0.15 * 0 + 0.1 * c.turnover);
    expect(p.risk.band).toBe(bandOf(p.risk.score));
  });

  it("all cash with history: risk is low, not missing", () => {
    const flat = Array.from({ length: 30 }, (_, i) => ({ date: addDays("2026-01-01", i), index: 1, estimated: false }));
    const p = computeProfile(base({ points: flat }));
    expect(p.risk).toMatchObject({ available: true, score: 0, band: "Very Low" });
  });
});
