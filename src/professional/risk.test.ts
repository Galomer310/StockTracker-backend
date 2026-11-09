import { describe, expect, it } from "vitest";
import { addDays } from "../performance/history";
import { DayIndex, evaluatePortfolio } from "./engine";
import { computeMedals } from "./medals";
import { evaluateRisk } from "./risk";

const calendar = (from: string, to: string, f: (d: string) => number | null): DayIndex[] => {
  const out: DayIndex[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, index: f(d) });
  return out;
};
const closes = (from: string, to: string, f: (d: string) => number) => {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, close: f(d) });
  return out;
};
const risk = (openedOn: string, to: string, idx: (d: string) => number | null, bench: (d: string) => number) =>
  evaluateRisk({ openedOn, days: calendar(openedOn, to, idx), benchmark: closes(addDays(openedOn, -10), to, bench) });
const ids = (r: { records: { achievement_id: string; period_id: string }[] }, id: string) =>
  r.records.filter((x) => x.achievement_id === id).map((x) => x.period_id);

// A path through dated levels, linear between them.
const path = (points: [string, number][]) => (d: string) => {
  if (d <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [d1, v1] = points[i];
    const [d0, v0] = points[i - 1];
    if (d <= d1) {
      const span = (Date.parse(d1) - Date.parse(d0)) / 864e5;
      return v0 + ((v1 - v0) * (Date.parse(d) - Date.parse(d0))) / 864e5 / span;
    }
  }
  return points[points.length - 1][1];
};

describe("Steady Hands and Protected Upside (opening-baseline downside)", () => {
  // The portfolio climbs 30%, then gives half of it back: a peak-to-trough fall
  // of 11.5%, but it never goes below where the year began.
  const climbThenGiveBack = path([["2025-12-31", 1], ["2026-06-30", 1.3], ["2026-12-31", 1.15]]);
  // The benchmark dips 10% below its opening, then ends up 5%.
  const benchDip = path([["2025-12-31", 100], ["2026-03-31", 90], ["2026-12-31", 105]]);

  it("uses the lowest value against the year's opening, not peak-to-trough", () => {
    const r = risk("2025-12-30", "2026-12-31", climbThenGiveBack, benchDip);
    const y = r.years.find((x) => x.period === "2026")!;
    expect(y.portfolio_downside).toBe(0);
    expect(y.benchmark_downside).toBeCloseTo(-0.1);
    expect(ids(r, "steady_hands")).toEqual(["2026"]);
    expect(ids(r, "protected_upside")).toEqual(["2026"]); // +15% vs +5%, less downside
  });

  it("needs a positive year: less downside alone is not enough", () => {
    const r = risk("2025-12-30", "2026-12-31", path([["2025-12-31", 1], ["2026-12-31", 0.98]]), benchDip);
    expect(ids(r, "steady_hands")).toEqual([]);
  });

  it("Protected Upside needs both the outperformance and the protection", () => {
    // Beats the benchmark but fell further below its opening.
    const r = risk("2025-12-30", "2026-12-31", path([["2025-12-31", 1], ["2026-03-31", 0.85], ["2026-12-31", 1.2]]), benchDip);
    expect(ids(r, "protected_upside")).toEqual([]);
    expect(ids(r, "steady_hands")).toEqual([]);
  });
});

describe("quarterly: Calm Under Fire, Capital Protector, Market Resilience", () => {
  it("Calm Under Fire: negative quarter-to-date at some point, positive at the end", () => {
    const r = risk("2025-12-31", "2026-03-31", path([["2025-12-31", 1], ["2026-02-01", 0.97], ["2026-03-31", 1.02]]), () => 100);
    expect(ids(r, "calm_under_fire")).toEqual(["2026-Q1"]);
    // Never below the quarter's opening: nothing to be calm about.
    expect(ids(risk("2025-12-31", "2026-03-31", path([["2025-12-31", 1], ["2026-03-31", 1.02]]), () => 100), "calm_under_fire")).toEqual([]);
  });

  it("Capital Protector: positive quarter with less downside than the benchmark", () => {
    const r = risk("2025-12-31", "2026-06-30", path([["2025-12-31", 1], ["2026-02-01", 0.98], ["2026-03-31", 1.03], ["2026-06-30", 1.05]]),
      path([["2025-12-31", 100], ["2026-02-01", 92], ["2026-03-31", 101], ["2026-05-01", 100], ["2026-06-30", 103]]));
    // Q2 too: the benchmark slipped from 101 to 100 under its opening while the portfolio never did.
    expect(ids(r, "capital_protector")).toEqual(["2026-Q1", "2026-Q2"]);
    expect(r.quarters[0]).toMatchObject({ protector: true, medal_eligible: true });
  });

  it("Market Resilience: a falling-market quarter, active throughout, better than the benchmark", () => {
    const bench = path([["2025-12-31", 100], ["2026-03-31", 90]]);
    expect(ids(risk("2025-12-31", "2026-03-31", path([["2025-12-31", 1], ["2026-03-31", 0.95]]), bench), "market_resilience")).toEqual(["2026-Q1"]);
    // Opened inside the quarter: not active throughout.
    expect(ids(risk("2026-01-10", "2026-03-31", path([["2026-01-10", 1], ["2026-03-31", 0.95]]), bench), "market_resilience")).toEqual([]);
    // Worse than the benchmark: no.
    expect(ids(risk("2025-12-31", "2026-03-31", path([["2025-12-31", 1], ["2026-03-31", 0.85]]), bench), "market_resilience")).toEqual([]);
  });

  it("medal: distinct full quarters, counted once across portfolios; 1 / 3 / 6 / 9 / 12", () => {
    const steady = path([["2025-12-31", 1], ...Array.from({ length: 12 }, (_, i) => [`2026-${String(i + 1).padStart(2, "0")}-15`, 1 + 0.01 * (i + 1)] as [string, number])]);
    // The benchmark dips 5% in the middle month of every quarter.
    const choppy = (d: string) => (Number(d.slice(5, 7)) % 3 === 2 ? 95 : 100);
    const ev = (idx: (d: string) => number) =>
      evaluatePortfolio({ openedOn: "2025-12-31", days: calendar("2025-12-31", "2026-12-31", idx), benchmark: closes("2025-12-01", "2026-12-31", choppy), finalThrough: "2026-12-31" });
    const a = ev(steady);
    const protectedQs = a.records.filter((r) => r.achievement_id === "capital_protector").map((r) => r.period_id);
    expect(protectedQs).toEqual(["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"]);
    const medal = computeMedals([{ id: 1, evaluation: a }, { id: 2, evaluation: ev(steady) }]).find((m) => m.medal_id === "capital_protector")!;
    expect(medal).toMatchObject({ tier: 2, highest_streak: 4 }); // 4 distinct quarters: Silver (3+)
  });
});

describe("recoveries: Back from the Edge and Phoenix Rise", () => {
  it("the fall alone earns nothing; the recovery does, once per event", () => {
    const fallOnly = risk("2026-01-01", "2026-06-30", path([["2026-01-01", 1], ["2026-02-01", 0.7], ["2026-06-30", 0.75]]), () => 100);
    expect(fallOnly.records.filter((r) => ["back_from_edge", "phoenix_rise"].includes(r.achievement_id))).toEqual([]);

    const twice = risk("2026-01-01", "2026-12-31",
      path([["2026-01-01", 1], ["2026-02-01", 0.85], ["2026-03-01", 1.0], ["2026-04-01", 1.02], ["2026-06-01", 0.75], ["2026-09-01", 1.05], ["2026-12-31", 1.06]]), () => 100);
    expect(ids(twice, "back_from_edge")).toEqual(["2026-03-01", "2026-08-17"]);
    expect(ids(twice, "phoenix_rise")).toHaveLength(1); // only the second fall went below -20%
    // Re-evaluating the same history gives the same events, not new ones.
    expect(ids(twice, "back_from_edge")).toEqual(ids(risk("2026-01-01", "2026-12-31",
      path([["2026-01-01", 1], ["2026-02-01", 0.85], ["2026-03-01", 1.0], ["2026-04-01", 1.02], ["2026-06-01", 0.75], ["2026-09-01", 1.05], ["2026-12-31", 1.06]]), () => 100), "back_from_edge"));
  });

  it("Phoenix Rise needs a positive return, not break-even", () => {
    const r = risk("2026-01-01", "2026-06-30", path([["2026-01-01", 1], ["2026-02-01", 0.75], ["2026-04-01", 1.0], ["2026-06-30", 1.0]]), () => 100);
    expect(ids(r, "phoenix_rise")).toEqual([]);
    expect(ids(r, "back_from_edge")).toEqual(["2026-04-01"]);
  });
});

describe("Phoenix Recovery medal: sequential tiers along one path", () => {
  // Falls to -20% in Feb 2025, back to 0 on 1 Apr 2025, then climbs steadily.
  const recovery = path([["2025-01-01", 1], ["2025-02-15", 0.8], ["2025-04-01", 1.0], ["2026-12-31", 1.6]]);
  // Flat, except a 5% dip in March 2026: Sovereign needs less downside than
  // the benchmark, strictly, so a benchmark that never dips cannot be beaten.
  const flatBench = (d: string) => (d.startsWith("2026-03") ? 95 : 100);

  it("Bronze at the recovery, Silver after 30 days at or above 0, Gold and Platinum on positive full quarters, Sovereign on a protected winning year", () => {
    const r = risk("2025-01-01", "2026-12-31", recovery, flatBench);
    expect(r.phoenix).toHaveLength(1);
    expect(r.phoenix[0].tiers).toEqual(["2025-04-01", "2025-04-30", "2025-09-30", "2025-12-31", "2026-12-31"]);
    const medal = computeMedals([{ id: 7, evaluation: { ...evaluatePortfolio({ openedOn: "2025-01-01", days: [], benchmark: [], finalThrough: null }), risk: { quarters: [], years: [], phoenix: r.phoenix } } }]).find((m) => m.medal_id === "phoenix_recovery");
    expect(medal).toMatchObject({ tier: 5, portfolio_id: 7, relevant_period: "2025-04", qualifying_value: null });
  });

  it("stops where the next tier is not met; tiers never skip", () => {
    // Recovers, but slips below 0 every few days: Bronze only.
    const shaky = (d: string) => (d < "2025-04-01" ? recovery(d) : Number(d.slice(8, 10)) % 5 === 0 ? 0.995 : 1.01);
    expect(risk("2025-01-01", "2025-12-31", shaky, flatBench).phoenix[0].tiers).toEqual(["2025-04-01"]);
  });

  it("a deeper fall earns no more than a shallow one", () => {
    const deep = path([["2025-01-01", 1], ["2025-02-15", 0.4], ["2025-04-01", 1.0], ["2025-06-30", 1.0]]);
    const shallow = path([["2025-01-01", 1], ["2025-02-15", 0.84], ["2025-04-01", 1.0], ["2025-06-30", 1.0]]);
    expect(risk("2025-01-01", "2025-06-30", deep, flatBench).phoenix[0].tiers).toEqual(risk("2025-01-01", "2025-06-30", shallow, flatBench).phoenix[0].tiers);
    // Never recovered: no medal at all, however deep.
    expect(risk("2025-01-01", "2025-06-30", path([["2025-01-01", 1], ["2025-03-01", 0.3]]), flatBench).phoenix).toEqual([]);
  });

  it("a new fall ends the path; its earned tiers stay", () => {
    const again = path([["2025-01-01", 1], ["2025-02-15", 0.8], ["2025-04-01", 1.0], ["2025-05-15", 1.02], ["2025-06-15", 0.8], ["2025-12-31", 0.9]]);
    const r = risk("2025-01-01", "2025-12-31", again, flatBench);
    expect(r.phoenix.map((p) => p.tiers.length)).toEqual([2]); // Bronze + Silver, then the second fall never recovered
  });
});
