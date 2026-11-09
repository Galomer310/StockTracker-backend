import { describe, expect, it } from "vitest";
import { addDays } from "../performance/history";
import { DayIndex, evaluatePortfolio, monthEnd, returnWindows } from "./engine";
import { autoOrder, computeMedals, tierFor } from "./medals";

// ---- Fixtures --------------------------------------------------------------

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
// A value that steps on the first of each month and holds through it.
const byMonth = (values: Record<string, number>, fallback = 1) => (d: string) => {
  const keys = Object.keys(values).filter((k) => k <= d.slice(0, 7)).sort();
  return keys.length ? values[keys[keys.length - 1]] : fallback;
};
// Compounds monthly returns into month-end levels starting from `start`.
const levels = (startMonth: string, rets: number[], base = 1) => {
  const out: Record<string, number> = { [startMonth]: base };
  let [y, m] = startMonth.split("-").map(Number);
  let v = base;
  for (const r of rets) {
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    v *= 1 + r;
    out[`${y}-${String(m).padStart(2, "0")}`] = v;
  }
  return out;
};

const run = (opts: { openedOn: string; to: string; idx: (d: string) => number | null; bench: (d: string) => number; finalThrough?: string }) =>
  evaluatePortfolio({
    openedOn: opts.openedOn,
    days: calendar(opts.openedOn, opts.to, opts.idx),
    benchmark: closes(addDays(opts.openedOn, -40), opts.to, opts.bench),
    finalThrough: opts.finalThrough ?? opts.to,
  });

const ids = (e: ReturnType<typeof evaluatePortfolio>, id: string) => e.records.filter((r) => r.achievement_id === id).map((r) => r.period_id);

// ---- Beat the Market ---------------------------------------------------------

describe("monthly Beat the Market", () => {
  it("wins a month by beating the benchmark over the same dates; a tie does not win", () => {
    // Opened 31 Dec. Jan +5% vs +2%; Feb -1% vs -3% (wins while losing); Mar +2% vs +2% (tie).
    const e = run({
      openedOn: "2025-12-31",
      to: "2026-03-31",
      idx: byMonth(levels("2025-12", [0.05, -0.01, 0.02])),
      bench: byMonth(levels("2025-12", [0.02, -0.03, 0.02], 100)),
    });
    expect(ids(e, "btm_month")).toEqual(["2026-01", "2026-02"]);
    const jan = e.records.find((r) => r.period_id === "2026-01")!;
    expect(jan.outperformance).toBeCloseTo(0.03);
    expect(jan.earned_on).toBe("2026-01-31");
    expect(ids(e, "green_month")).toEqual(["2026-01", "2026-03"]); // positive is a different condition
  });

  it("partial opening month: from the opening date, for both", () => {
    // Opened 15 Jan at index 1; the benchmark rose before that (ignored) and fell after.
    const e = run({
      openedOn: "2026-01-15",
      to: "2026-01-31",
      idx: (d) => (d >= "2026-01-20" ? 1.01 : 1),
      bench: (d) => (d < "2026-01-10" ? 90 : d < "2026-01-20" ? 100 : 99),
    });
    const r = e.months[0];
    expect(r).toMatchObject({ from: "2026-01-15", partial: true, win: true });
    expect(r.benchmark_return).toBeCloseTo(-0.01);
    expect(ids(e, "btm_month")).toEqual(["2026-01"]);
  });

  it("only finished, final months are evaluated", () => {
    const e = run({ openedOn: "2025-12-31", to: "2026-02-20", idx: byMonth(levels("2025-12", [0.05, 0.05])), bench: () => 100, finalThrough: "2026-02-20" });
    expect(e.months.map((m) => m.period)).toEqual(["2025-12", "2026-01"]);
    // Nothing final yet: nothing evaluated.
    const none = evaluatePortfolio({ openedOn: "2026-01-05", days: calendar("2026-01-05", "2026-03-01", () => 1.1), benchmark: closes("2026-01-01", "2026-03-01", () => 100), finalThrough: null });
    expect(none.months).toEqual([]);
    expect(none.records).toEqual([]);
  });

  it("streak milestones every 3 months, once per portfolio; current and highest kept", () => {
    // Wins 7 months, loses 1, wins 3: milestones 3 and 6 once (the later 3 does not repeat).
    const p = [...Array(7).fill(0.02), -0.05, 0.02, 0.02, 0.02];
    const e = run({ openedOn: "2025-12-31", to: monthEnd("2026-11"), idx: byMonth(levels("2025-12", p)), bench: () => 100 });
    expect(ids(e, "btm_month_streak")).toEqual(["3", "6"]);
    expect(e.streaks.btm_month).toMatchObject({ highest: 7, current: 3, highest_end: "2026-07-31" });
  });
});

describe("quarterly Beat the Market", () => {
  const q2 = (openedOn: string) =>
    run({ openedOn, to: "2026-06-30", idx: (d) => (d >= "2026-06-25" ? 1.1 : 1), bench: () => 100 });

  it("opened before the quarter: achievement and medal-eligible", () => {
    const e = q2("2026-03-20");
    expect(e.quarters.find((q) => q.period === "2026-Q2")).toMatchObject({ win: true, medal_eligible: true, partial: false });
  });
  it("opened in the first or second month: achievement only", () => {
    for (const d of ["2026-04-15", "2026-05-20"]) {
      const e = q2(d);
      expect(e.quarters[0]).toMatchObject({ period: "2026-Q2", win: true, medal_eligible: false, partial: true, from: d });
      expect(ids(e, "btm_quarter")).toEqual(["2026-Q2"]);
    }
  });
  it("opened in the third month: no quarterly result", () => {
    const e = q2("2026-06-10");
    expect(e.quarters).toEqual([]);
    expect(ids(e, "btm_quarter")).toEqual([]);
  });

  const quarterly = (wins: boolean[], openedOn = "2025-12-31") => {
    // One step per quarter-end month: +5% when winning, -5% otherwise; benchmark flat.
    const rets: number[] = [];
    wins.forEach((w) => rets.push(0, 0, w ? 0.05 : -0.05));
    const to = monthEnd(`${2026 + Math.floor((wins.length * 3 - 1) / 12)}-${String(((wins.length * 3 - 1) % 12) + 1).padStart(2, "0")}`);
    return run({ openedOn, to, idx: byMonth(levels("2025-12", rets)), bench: () => 100 });
  };

  it("combo II-V within one portfolio, crossing years; Unbroken Four for one calendar year", () => {
    const e = quarterly([true, true, true, true, true, false, true]);
    expect(ids(e, "btm_quarter")).toEqual(["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4", "2027-Q1", "2027-Q3"]);
    expect(ids(e, "btm_quarter_combo")).toEqual(["2", "3", "4", "5"]);
    expect(ids(e, "btm_unbroken_four")).toEqual(["2026"]);
  });

  it("medal: distinct quarters, not consecutive; counted once across portfolios; strongest figure", () => {
    const a = quarterly([true, false, true, false, false, true]); // 2026-Q1, 2026-Q3, 2027-Q2
    const m = computeMedals([{ id: 1, evaluation: a }]).find((x) => x.medal_id === "btm_quarterly")!;
    expect(m).toMatchObject({ tier: 3, relevant_period: "2027-Q2", current_streak: 1, subtitle: null });

    // Two portfolios win the same two quarters: still 2 quarters, one medal, best outperformance.
    const strong = run({ openedOn: "2025-12-31", to: "2026-06-30", idx: byMonth(levels("2025-12", [0, 0, 0.2, 0, 0, 0.2])), bench: () => 100 });
    const weak = quarterly([true, true]);
    const both = computeMedals([{ id: 1, evaluation: weak }, { id: 2, evaluation: strong }]).find((x) => x.medal_id === "btm_quarterly")!;
    expect(both).toMatchObject({ tier: 2, portfolio_id: 2, current_streak: 2, subtitle: "combo" });
    expect(both.qualifying_value).toBeCloseTo(0.2);
  });

  it("no streak across portfolios", () => {
    const a = quarterly([true, false]);
    const b = quarterly([false, true]);
    expect([...ids(a, "btm_quarter_combo"), ...ids(b, "btm_quarter_combo")]).toEqual([]);
    const combo = computeMedals([{ id: 1, evaluation: a }, { id: 2, evaluation: b }]).find((x) => x.medal_id === "btm_monthly_combo");
    expect(combo?.highest_streak ?? 0).toBeLessThanOrEqual(1);
  });

  it("partial quarters give the achievement but never the medal", () => {
    const e = quarterly([true], "2026-02-10");
    expect(ids(e, "btm_quarter")).toEqual(["2026-Q1"]);
    expect(computeMedals([{ id: 1, evaluation: e }]).find((x) => x.medal_id === "btm_quarterly")).toBeUndefined();
  });
});

describe("annual Beat the Market", () => {
  const year = (rets: number[], openedOn = "2025-12-31") =>
    run({ openedOn, to: "2026-12-31", idx: byMonth(levels("2025-12", rets)), bench: byMonth(levels("2025-12", Array(12).fill(0.005), 100)) });

  it("full calendar years only", () => {
    expect(year(Array(12).fill(0.02), "2026-01-01").years).toEqual([]);
    expect(ids(year(Array(12).fill(0.02)), "btm_year")).toEqual(["2026"]);
  });

  it("Gold, Platinum at 15 points, Sovereign when every quarter was won too", () => {
    const tierOf = (rets: number[]) => computeMedals([{ id: 1, evaluation: year(rets) }]).find((m) => m.medal_id === "btm_annual")!;
    // Loses Q1 badly, wins the year modestly: Gold.
    expect(tierOf([-0.05, 0, 0, 0.04, 0.04, 0.04, 0, 0, 0, 0, 0, 0])).toMatchObject({ tier: 3, subtitle: "annual_champion", period_key: "2026" });
    // Loses Q1, beats the year by > 15 points: Platinum.
    expect(tierOf([-0.05, 0, 0, 0.1, 0.1, 0.1, 0, 0, 0, 0, 0, 0]).tier).toBe(4);
    // Wins every quarter and the year: Sovereign, Calendar Sweep.
    expect(tierOf(Array(12).fill(0.01))).toMatchObject({ tier: 5, subtitle: "calendar_sweep" });
  });

  it("several portfolios winning one year make one medal for that year", () => {
    const medals = computeMedals([
      { id: 1, evaluation: year(Array(12).fill(0.01)) },
      { id: 2, evaluation: year(Array(12).fill(0.02)) },
    ]).filter((m) => m.medal_id === "btm_annual");
    expect(medals).toHaveLength(1);
    expect(medals[0].portfolio_id).toBe(2);
  });
});

// ---- Portfolio Return: the 30-day qualification ---------------------------------

describe("portfolio return qualification", () => {
  // Returns by day number (1-based from `start`), as index = 1 + r.
  const path = (start: string, rets: number[]) => rets.map((r, i) => ({ date: addDays(start, i), index: 1 + r }));

  it("the spec's example: Day 30 below, back to the threshold on Day 34", () => {
    const r: number[] = [];
    for (let day = 1; day <= 40; day++) {
      r.push(day === 1 ? 0.2 : day <= 8 ? 0.22 : day < 15 ? 0.21 : day < 22 ? 0.18 : day < 30 ? 0.21 : day < 34 ? 0.19 : 0.205);
    }
    const w = returnWindows([{ date: "2026-02-28", index: 1.05 }, ...path("2026-03-01", r)]);
    const q = w.qualified.find((x) => x.threshold === 0.2)!;
    expect(q).toMatchObject({ on: addDays("2026-03-01", 33), via_grace: true, start: "2026-03-01" });
    expect(w.windows.find((x) => x.threshold === 0.2)).toMatchObject({ day30_result: "below", seven_met: true, status: "qualified" });
    expect(w.qualified.find((x) => x.threshold === 0.1)).toMatchObject({ on: addDays("2026-03-01", 29), via_grace: false });
  });

  it("no seven consecutive days in the window: fails at Day 30, then a new attempt", () => {
    // Alternates above/below for 30 days, then holds above.
    const r = [...Array.from({ length: 30 }, (_, i) => (i % 2 ? 0.05 : 0.12)), ...Array(40).fill(0.12)];
    const w = returnWindows(path("2026-01-01", r));
    const tens = w.windows.filter((x) => x.threshold === 0.1);
    expect(tens[0]).toMatchObject({ status: "failed", seven_met: false, closed_on: "2026-01-30" });
    expect(tens[1]).toMatchObject({ start: "2026-01-31", status: "qualified" });
    expect(w.qualified.filter((x) => x.threshold === 0.1)).toHaveLength(1);
  });

  it("grace period fails when the threshold is not regained", () => {
    const r = [...Array(10).fill(0.25), ...Array(30).fill(0.15)];
    const w = returnWindows(path("2026-01-01", r));
    expect(w.windows.find((x) => x.threshold === 0.2)).toMatchObject({ status: "failed", day30_result: "below", closed_on: addDays("2026-01-01", 36) });
    expect(w.qualified.map((x) => x.threshold)).toEqual([0.1]);
  });

  it("every threshold, in parallel windows, through to Sovereign III", () => {
    const w = returnWindows(path("2026-01-01", Array(31).fill(3.1)));
    expect(w.qualified.map((x) => x.threshold)).toEqual([0.1, 0.2, 0.5, 0.75, 1, 2, 3]);
    const e = run({ openedOn: "2026-01-01", to: "2026-02-15", idx: (d) => (d === "2026-01-01" ? 1 : 4.1), bench: () => 100 });
    expect(ids(e, "portfolio_return")).toEqual(["10", "20", "50", "75", "100", "200", "300"]);
    const m = computeMedals([{ id: 1, evaluation: e }]).find((x) => x.medal_id === "portfolio_performance")!;
    expect(m).toMatchObject({ tier: 5, decoration: 3 });
  });

  it("a window still open is in progress, and nothing is awarded yet", () => {
    const w = returnWindows(path("2026-01-01", Array(12).fill(0.11)));
    expect(w.windows[0]).toMatchObject({ status: "in_progress", seven_met: true, day30: "2026-01-30" });
    expect(w.qualified).toEqual([]);
  });

  it("medal: the highest milestone across portfolios, not duplicated", () => {
    const e20 = run({ openedOn: "2026-01-01", to: "2026-02-15", idx: (d) => (d === "2026-01-01" ? 1 : 1.25), bench: () => 100 });
    const e50 = run({ openedOn: "2026-01-01", to: "2026-02-15", idx: (d) => (d === "2026-01-01" ? 1 : 1.55), bench: () => 100 });
    const medals = computeMedals([{ id: 1, evaluation: e20 }, { id: 2, evaluation: e50 }]).filter((m) => m.medal_id === "portfolio_performance");
    expect(medals).toHaveLength(1);
    expect(medals[0]).toMatchObject({ tier: 3, portfolio_id: 2, decoration: 0 });
  });
});

// ---- Green Months ---------------------------------------------------------------

describe("Green Months", () => {
  it("milestones at every multiple of three, no maximum; broken streaks keep the record", () => {
    const rets = [...Array(15).fill(0.01), -0.01, ...Array(26).fill(0.01)];
    const e = run({ openedOn: "2025-12-31", to: monthEnd("2029-06"), idx: byMonth(levels("2025-12", rets)), bench: () => 100 });
    expect(ids(e, "green_streak")).toEqual(["3", "6", "9", "12", "15", "18", "21", "24"]);
    expect(e.streaks.green).toMatchObject({ highest: 26, current: 26 });
    const m = computeMedals([{ id: 1, evaluation: e }]).find((x) => x.medal_id === "green_months")!;
    expect(m).toMatchObject({ tier: 5, decoration: 2, highest_streak: 26, current_streak: 26 });
  });

  it("the partial opening month counts, and zero breaks a streak", () => {
    const e = run({
      openedOn: "2026-01-20",
      to: "2026-04-30",
      idx: (d) => (d < "2026-01-25" ? 1 : d < "2026-02-10" ? 1.01 : d < "2026-03-10" ? 1.02 : 1.02),
      bench: () => 100,
    });
    expect(ids(e, "green_month")).toEqual(["2026-01", "2026-02"]);
    expect(e.streaks.green).toMatchObject({ highest: 2, current: 0 });
    expect(computeMedals([{ id: 1, evaluation: e }]).find((x) => x.medal_id === "green_months")).toMatchObject({ tier: 1, highest_streak: 2, current_streak: 0 });
  });

  it("medal tiers 1 / 3 / 6 / 9 / 12", () => {
    expect([0, 1, 2, 3, 5, 6, 9, 11, 12, 40].map((n) => tierFor(n, [1, 3, 6, 9, 12]))).toEqual([0, 1, 1, 2, 2, 3, 4, 4, 5, 5]);
  });
});

describe("integrity and display", () => {
  it("stops where the index stops", () => {
    const e = run({ openedOn: "2025-12-31", to: "2026-03-31", idx: (d) => (d >= "2026-02-10" ? null : 1.01), bench: () => 100 });
    expect(e.months.map((m) => m.period)).toEqual(["2025-12", "2026-01"]);
  });

  it("automatic medal order: tier, then importance, then recency", () => {
    const m = (medal_id: string, tier: number, as_of: string) => ({ medal_id, tier, decoration: 0, as_of });
    expect(
      autoOrder([m("green_months", 3, "2026-05-31"), m("btm_annual", 3, "2025-12-31"), m("btm_quarterly", 4, "2026-03-31"), m("green_months", 3, "2026-06-30")]).map((x) => `${x.medal_id}:${x.as_of}`)
    ).toEqual(["btm_quarterly:2026-03-31", "btm_annual:2025-12-31", "green_months:2026-06-30", "green_months:2026-05-31"]);
  });
});
