import { describe, expect, it } from "vitest";
import { checkAgainstLive, closeOn, finalThrough, lastFinalSession, performanceIndexOf, reconstructDailyValues } from "./history";

const closes = {
  AAA: [
    { date: "2026-03-02", close: 100 }, // Monday
    { date: "2026-03-03", close: 110 },
    { date: "2026-03-06", close: 121 }, // Friday
    { date: "2026-03-09", close: 99 },
  ],
};

describe("closeOn", () => {
  it("takes the last close on or before the date (weekends keep Friday's)", () => {
    expect(closeOn(closes.AAA, "2026-03-01")).toBeNull();
    expect(closeOn(closes.AAA, "2026-03-02")).toBe(100);
    expect(closeOn(closes.AAA, "2026-03-07")).toBe(121);
    expect(closeOn(closes.AAA, "2026-03-08")).toBe(121);
    expect(closeOn(closes.AAA, "2026-04-01")).toBe(99);
  });
});

describe("reconstructDailyValues", () => {
  const base = {
    startingBalance: 10000,
    openedOn: "2026-03-02",
    through: "2026-03-09",
    flows: [],
    closes,
  };

  it("one value per calendar day, cash only before any trade", () => {
    const days = reconstructDailyValues({ ...base, trades: [] });
    expect(days.map((d) => d.date)).toEqual([
      "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09",
    ]);
    expect(days.every((d) => d.nav === 10000 && d.cash === 10000)).toBe(true);
  });

  it("values shares at each day's close and moves cash to the cent", () => {
    const days = reconstructDailyValues({
      ...base,
      trades: [{ date: "2026-03-02", symbol: "AAA", action: "buy", quantity: 10, price: 99.995 }],
    });
    // 10 x 99.995 = 999.95, rounded to the cent like the trade code.
    expect(days[0].cash).toBe(9000.05);
    expect(days[0].nav).toBeCloseTo(9000.05 + 1000, 6);
    expect(days[1].nav).toBeCloseTo(9000.05 + 1100, 6);
    expect(days[5].nav).toBeCloseTo(9000.05 + 1210, 6); // Saturday: Friday's close
    expect(days[7].nav).toBeCloseTo(9000.05 + 990, 6);
  });

  it("applies sells and keeps the holdings", () => {
    const days = reconstructDailyValues({
      ...base,
      trades: [
        { date: "2026-03-02", symbol: "AAA", action: "buy", quantity: 10, price: 100 },
        { date: "2026-03-06", symbol: "AAA", action: "sell", quantity: 4, price: 110 },
      ],
    });
    const fri = days[4];
    expect(fri.holdings).toEqual({ AAA: 6 });
    expect(fri.cash).toBe(10000 - 1000 + 440);
    expect(fri.nav).toBeCloseTo(9440 + 6 * 121, 6);
  });

  it("drops a symbol once it is fully sold", () => {
    const days = reconstructDailyValues({
      ...base,
      trades: [
        { date: "2026-03-02", symbol: "AAA", action: "buy", quantity: 5, price: 100 },
        { date: "2026-03-03", symbol: "AAA", action: "sell", quantity: 5, price: 110 },
      ],
    });
    expect(days[1].holdings).toEqual({});
    expect(days[1].nav).toBe(10050);
  });

  it("values a symbol with no close yet at its trade price, and says so", () => {
    const days = reconstructDailyValues({
      ...base,
      trades: [{ date: "2026-03-02", symbol: "NEW", action: "buy", quantity: 2, price: 50 }],
    });
    expect(days[0].estimated_symbols).toEqual(["NEW"]);
    expect(days[0].nav).toBe(10000);
  });

  it("counts a trade dated before the opening on the opening day", () => {
    const days = reconstructDailyValues({
      ...base,
      trades: [{ date: "2026-02-20", symbol: "AAA", action: "buy", quantity: 1, price: 100 }],
    });
    expect(days[0].holdings).toEqual({ AAA: 1 });
  });

  it("is empty when the end is before the opening", () => {
    expect(reconstructDailyValues({ ...base, through: "2026-03-01", trades: [] })).toEqual([]);
  });
});

describe("performanceIndexOf: capital growth never counts as return", () => {
  it("matches the spec's capital growth example: +10% stays +10%", () => {
    // 10,000 opens; the stock gains 10% -> 11,000; a 1% boost adds 110 cash.
    const days = reconstructDailyValues({
      startingBalance: 10000,
      openedOn: "2026-03-02",
      through: "2026-03-04",
      trades: [{ date: "2026-03-02", symbol: "AAA", action: "buy", quantity: 100, price: 100 }],
      flows: [{ date: "2026-03-04", amount: 110 }],
      closes: { AAA: [{ date: "2026-03-02", close: 100 }, { date: "2026-03-03", close: 110 }] },
    });
    expect(days[2].nav).toBe(11110);
    const index = performanceIndexOf(days);
    expect(index[1]).toBeCloseTo(1.1, 12);
    expect(index[2]).toBeCloseTo(1.1, 12); // the boost day adds nothing
  });

  it("starts at 1 and follows market moves only", () => {
    const days = reconstructDailyValues({
      startingBalance: 10000,
      openedOn: "2026-03-02",
      through: "2026-03-09",
      trades: [{ date: "2026-03-02", symbol: "AAA", action: "buy", quantity: 100, price: 100 }],
      flows: [],
      closes,
    });
    const index = performanceIndexOf(days);
    expect(index[0]).toBe(1);
    expect(index[7]).toBeCloseTo(days[7].nav / 10000, 12);
  });

  it("stops at a non-positive value instead of dividing by it", () => {
    const fake = [
      { date: "a", cash: 10, positions_value: 0, nav: 10, external_flow: 0, holdings: {}, estimated_symbols: [] },
      { date: "b", cash: 0, positions_value: 0, nav: 0, external_flow: 0, holdings: {}, estimated_symbols: [] },
      { date: "c", cash: 5, positions_value: 0, nav: 5, external_flow: 0, holdings: {}, estimated_symbols: [] },
    ];
    expect(performanceIndexOf(fake)).toEqual([1, null, null]);
  });
});

describe("checkAgainstLive", () => {
  const last = { date: "x", cash: 9000, positions_value: 1000, nav: 10000, external_flow: 0, holdings: { AAA: 10 }, estimated_symbols: [] };
  it("passes when cash and shares match", () => {
    expect(checkAgainstLive(last, { cash: 9000.004, holdings: { AAA: 10 } })).toEqual({ ok: true });
  });
  it("fails on a cash or share difference, naming it", () => {
    expect(checkAgainstLive(last, { cash: 8000, holdings: { AAA: 10 } })).toMatchObject({ ok: false });
    expect(checkAgainstLive(last, { cash: 9000, holdings: { AAA: 9 } })).toMatchObject({ ok: false, reason: "AAA: 10 shares rebuilt vs 9 live" });
    expect(checkAgainstLive(last, { cash: 9000, holdings: { AAA: 10, BBB: 1 } }).ok).toBe(false);
    expect(checkAgainstLive(undefined, { cash: 0, holdings: {} }).ok).toBe(false);
  });
});

describe("lastFinalSession", () => {
  it("is today's New York date only from 20:00 New York time", () => {
    // 9 Nov 2026 is winter time in New York (UTC-5).
    expect(lastFinalSession(new Date("2026-11-09T21:00:00Z"))).toBe("2026-11-08"); // 16:00 NY, just closed
    expect(lastFinalSession(new Date("2026-11-10T01:00:00Z"))).toBe("2026-11-09"); // 20:00 NY
    expect(lastFinalSession(new Date("2026-11-10T04:59:00Z"))).toBe("2026-11-09"); // 23:59 NY
  });
  it("follows New York summer time (UTC-4)", () => {
    expect(lastFinalSession(new Date("2026-07-01T23:59:00Z"))).toBe("2026-06-30"); // 19:59 NY
    expect(lastFinalSession(new Date("2026-07-02T00:00:00Z"))).toBe("2026-07-01"); // 20:00 NY
  });
});

describe("finalThrough", () => {
  const day = (date: string, holdings: Record<string, number>, estimated: string[] = []) => ({
    date, cash: 0, positions_value: 0, nav: 1, external_flow: 0, holdings, estimated_symbols: estimated,
  });
  it("runs until a held symbol's closes stop being complete", () => {
    const days = [day("2026-09-01", {}), day("2026-09-02", { A: 1 }), day("2026-09-03", { A: 1 })];
    expect(finalThrough(days, { A: "2026-09-02" }, "2026-09-10")).toBe("2026-09-02");
    expect(finalThrough(days, { A: "2026-09-05" }, "2026-09-10")).toBe("2026-09-03");
  });
  it("does not let a stock bought later hold back earlier days", () => {
    const days = [day("2026-09-01", { A: 1 }), day("2026-09-02", { A: 1, NEW: 2 }, ["NEW"])];
    expect(finalThrough(days, { A: "2026-09-05" }, "2026-09-10")).toBe("2026-09-01");
  });
  it("never includes today, and is null when nothing is final", () => {
    expect(finalThrough([day("2026-09-01", {}), day("2026-09-02", {})], {}, "2026-09-01")).toBe("2026-09-01");
    expect(finalThrough([day("2026-09-01", { A: 1 })], {}, "2026-09-10")).toBeNull();
  });
});
