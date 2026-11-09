import { describe, expect, it } from "vitest";
import { addDays } from "./history";
import { computeInsights, IndexDay, lastWeekdayOf } from "./insights";

// Every calendar date from `from` to `to`, carrying the index forward over
// dates `values` does not name (weekends, as the stored history does).
const calendar = (from: string, to: string, values: Record<string, number>): IndexDay[] => {
  const out: IndexDay[] = [];
  let current = 1;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (values[d] !== undefined) current = values[d];
    out.push({ date: d, perf_index: current, estimated: false });
  }
  return out;
};

const weekdays = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d);
  }
  return out;
};

const flat = (from: string, to: string, close = 100) => weekdays(from, to).map((date) => ({ date, close }));

describe("lastWeekdayOf", () => {
  it("steps back from a weekend month end", () => {
    expect(lastWeekdayOf("2026-10")).toBe("2026-10-30"); // 31 Oct 2026 is a Saturday
    expect(lastWeekdayOf("2026-09")).toBe("2026-09-30");
    expect(lastWeekdayOf("2026-02")).toBe("2026-02-27");
  });
});

describe("computeInsights", () => {
  it("needs the opening day and at least one session after it", () => {
    expect(computeInsights({ openedOn: "2026-11-07", today: "2026-11-08", days: [], benchmarks: [] })).toEqual({
      ok: false,
      reason: "no_history",
      age_days: 1,
    });
    const days = calendar("2026-11-07", "2026-11-08", {}); // a weekend
    const spy = { key: "sp500", symbol: "SPY", name: "S&P 500", closes: flat("2026-11-02", "2026-11-06") };
    expect(computeInsights({ openedOn: "2026-11-07", today: "2026-11-08", days, benchmarks: [spy] })).toMatchObject({
      ok: false,
      reason: "too_new",
    });
  });

  // Opened Monday 28 Sep; viewed Monday 9 Nov.
  const values = {
    "2026-09-29": 1.02,
    "2026-09-30": 1.0, // Sep: 0%
    "2026-10-01": 1.1, // best day +10%
    "2026-10-02": 1.1,
    "2026-10-05": 1.012, // worst day -8%
    "2026-10-06": 1.04,
    "2026-10-29": 1.08,
    "2026-10-30": 1.1, // Oct: +10%
    "2026-11-05": 1.12,
    "2026-11-06": 1.155,
  };
  const days = calendar("2026-09-28", "2026-11-09", values);
  const spyCloses = flat("2026-09-25", "2026-11-06", 100).map((c) => (c.date >= "2026-10-01" ? { ...c, close: 110 } : c));
  const qqqCloses = flat("2026-09-25", "2026-11-05", 200).map((c) => (c.date >= "2026-10-01" ? { ...c, close: 180 } : c));
  const run = (benchmarks = [
    { key: "sp500", symbol: "SPY", name: "S&P 500", closes: spyCloses },
    { key: "nasdaq100", symbol: "QQQ", name: "NASDAQ-100", closes: qqqCloses },
  ]) => {
    const out = computeInsights({ openedOn: "2026-09-28", today: "2026-11-09", days, benchmarks });
    if (!out.ok) throw new Error(out.reason);
    return out.insights;
  };

  it("ends on the last session every benchmark has, and starts on the opening date", () => {
    const i = run();
    expect(i.start).toBe("2026-09-28");
    expect(i.end).toBe("2026-11-05"); // QQQ has nothing for 6 Nov
    expect(i.total_return).toBeCloseTo(0.12);
    expect(i.age_days).toBe(42);
  });

  it("measures daily returns session to session, so weekends are not zero days", () => {
    const i = run();
    expect(i.max_daily_gain).toEqual({ date: "2026-10-01", value: expect.closeTo(0.1, 10) });
    expect(i.max_daily_loss).toEqual({ date: "2026-10-05", value: expect.closeTo(-0.08, 10) });
    expect(i.chart.map((r) => r.date)).not.toContain("2026-10-03");
  });

  it("counts finished months only; the opening month is partial", () => {
    const i = run();
    expect(i.months.map((m) => [m.month, m.partial, m.in_progress])).toEqual([
      ["2026-09", true, false],
      ["2026-10", false, false],
      ["2026-11", false, true],
    ]);
    expect(i.months[0].value).toBeCloseTo(0);
    expect(i.months[1].value).toBeCloseTo(0.1);
    expect(i.best_month?.month).toBe("2026-10");
    expect(i.worst_month?.month).toBe("2026-09");
    expect(i.positive_months).toEqual({ positive: 1, counted: 2 });
    expect(i.average_monthly_return).toBeCloseTo(0.05);
  });

  it("drawdown is from the peak, on the index", () => {
    const i = run();
    expect(i.max_drawdown.peak_date).toBe("2026-10-01");
    expect(i.max_drawdown.trough_date).toBe("2026-10-05");
    expect(i.max_drawdown.value).toBeCloseTo(-0.08);
  });

  it("compares each benchmark over exactly the same dates, rebased to 100", () => {
    const i = run();
    const [spy, qqq] = i.benchmarks;
    expect(spy.return).toBeCloseTo(0.1);
    expect(spy.excess_return).toBeCloseTo(0.02);
    expect(qqq.return).toBeCloseTo(-0.1);
    expect(qqq.excess_return).toBeCloseTo(0.22);
    expect(i.chart[0]).toEqual({ date: "2026-09-28", portfolio: 100, sp500: 100, nasdaq100: 100 });
    expect(i.chart[i.chart.length - 1].sp500).toBeCloseTo(110);
  });

  it("a month ending on a weekend is over once its last weekday is in", () => {
    const out = computeInsights({
      openedOn: "2026-09-28",
      today: "2026-11-01", // Sunday
      days: calendar("2026-09-28", "2026-11-01", values),
      benchmarks: [{ key: "sp500", symbol: "SPY", name: "S&P 500", closes: flat("2026-09-25", "2026-10-30") }],
    });
    if (!out.ok) throw new Error(out.reason);
    expect(out.insights.end).toBe("2026-10-30");
    expect(out.insights.months.find((m) => m.month === "2026-10")?.in_progress).toBe(false);
  });

  it("opened on a weekend: the benchmark starts from the Friday close", () => {
    const out = computeInsights({
      openedOn: "2026-10-03", // Saturday
      today: "2026-10-07",
      days: calendar("2026-10-03", "2026-10-07", { "2026-10-06": 1.1 }),
      benchmarks: [
        {
          key: "sp500",
          symbol: "SPY",
          name: "S&P 500",
          closes: [
            { date: "2026-10-02", close: 100 },
            { date: "2026-10-05", close: 105 },
            { date: "2026-10-06", close: 120 },
          ],
        },
      ],
    });
    if (!out.ok) throw new Error(out.reason);
    expect(out.insights.start).toBe("2026-10-03");
    expect(out.insights.benchmarks[0].return).toBeCloseTo(0.2);
  });

  it("a benchmark without data is shown as unavailable and does not hold the others back", () => {
    const i = run([
      { key: "sp500", symbol: "SPY", name: "S&P 500", closes: spyCloses },
      { key: "nasdaq100", symbol: "QQQ", name: "NASDAQ-100", closes: [] },
    ]);
    expect(i.end).toBe("2026-11-06");
    expect(i.benchmarks[1]).toMatchObject({ return: null, excess_return: null });
    expect(i.chart[0]).not.toHaveProperty("nasdaq100");
  });

  it("stops where the index stops and flags estimated days", () => {
    const d = calendar("2026-09-28", "2026-10-09", values).map((x) =>
      x.date >= "2026-10-07" ? { ...x, perf_index: null } : x.date === "2026-10-02" ? { ...x, estimated: true } : x
    );
    const out = computeInsights({
      openedOn: "2026-09-28",
      today: "2026-10-09",
      days: d,
      benchmarks: [{ key: "sp500", symbol: "SPY", name: "S&P 500", closes: spyCloses }],
    });
    if (!out.ok) throw new Error(out.reason);
    expect(out.insights.end).toBe("2026-10-06");
    expect(out.insights.estimated).toBe(true);
  });
});
