import { describe, expect, it } from "vitest";
import { computeExposures, techOriented, TechRule } from "./exposures";

const rules: TechRule[] = [
  { kind: "sic", sic_from: 7370, sic_to: 7379, tech: true },
  { kind: "sic", sic_from: 3674, sic_to: 3674, tech: true },
  { kind: "symbol", symbol: "NFLX", tech: true },
  { kind: "symbol", symbol: "OLDCO", tech: false },
];
// n closes rising (or falling) steadily, with a constant volume.
const bars = (n: number, start: number, step: number, volume: number | null = 1e6) =>
  Array.from({ length: n }, (_, i) => ({ close: start + step * i, volume }));

describe("techOriented: the controlled mapping", () => {
  it("symbol rules win; then SIC ranges; unknown without a code", () => {
    expect(techOriented("MSFT", 7372, rules)).toBe(true);
    expect(techOriented("NVDA", 3674, rules)).toBe(true);
    expect(techOriented("NFLX", 7841, rules)).toBe(true); // video rental code, internet platform in fact
    expect(techOriented("OLDCO", 7372, rules)).toBe(false);
    expect(techOriented("KO", 2080, rules)).toBe(false);
    expect(techOriented("NEW", null, rules)).toBeNull();
  });
});

describe("computeExposures", () => {
  const base = { cash: 2000, rules };

  it("weights are shares of the whole portfolio, cash included; micro and small never overlap", () => {
    const e = computeExposures({
      ...base,
      holdings: [
        { symbol: "TINY", value: 2000, market_cap: 50e6, sic: 2080, bars: bars(30, 10, 0, 1000) },
        { symbol: "SMAL", value: 2000, market_cap: 100e6, sic: 7372, bars: bars(30, 10, 0) },
        { symbol: "BIGG", value: 4000, market_cap: 2e12, sic: 3674, bars: bars(30, 10, 0, 1e8) },
      ],
    });
    expect(e.micro_cap).toEqual({ value: 0.2, unclassified: 0 });
    expect(e.small_cap).toEqual({ value: 0.2, unclassified: 0 }); // exactly $100M is small, not micro
    expect(e.tech.value).toBeCloseTo(0.6);
    expect(e.cash).toBeCloseTo(0.2);
  });

  it("low volume: 20-day average price x 20-day average volume under $5M", () => {
    const e = computeExposures({
      ...base,
      holdings: [
        { symbol: "THIN", value: 4000, market_cap: 1e9, sic: 2080, bars: bars(25, 10, 0, 100000) }, // $1M a day
        { symbol: "DEEP", value: 4000, market_cap: 1e9, sic: 2080, bars: bars(25, 10, 0, 1000000) }, // $10M a day
        { symbol: "NEWL", value: 0, market_cap: 1e9, sic: 2080, bars: bars(5, 10, 0) },
      ],
    });
    expect(e.low_volume).toEqual({ value: 0.4, unclassified: 0 });
    expect(e.holdings.find((h) => h.symbol === "NEWL")?.low_liquidity).toBeNull(); // fewer than 20 sessions
  });

  it("momentum needs 200 closes; unknown data is reported apart, never as no", () => {
    const e = computeExposures({
      ...base,
      holdings: [
        { symbol: "UP", value: 4000, market_cap: null, sic: null, bars: bars(220, 50, 0.5) },
        { symbol: "DOWN", value: 2000, market_cap: null, sic: null, bars: bars(220, 200, -0.5) },
        { symbol: "YOUNG", value: 2000, market_cap: null, sic: null, bars: bars(120, 50, 0.5) },
      ],
    });
    expect(e.momentum).toEqual({ value: 0.4, unclassified: 0.2 });
    expect(e.micro_cap).toEqual({ value: 0, unclassified: 0.8 });
    expect(e.tech).toEqual({ value: 0, unclassified: 0.8 });
  });

  it("an all-cash portfolio exposes nothing", () => {
    const e = computeExposures({ ...base, holdings: [] });
    expect([e.micro_cap.value, e.low_volume.value, e.tech.value, e.momentum.value, e.cash]).toEqual([0, 0, 0, 0, 1]);
  });
});
