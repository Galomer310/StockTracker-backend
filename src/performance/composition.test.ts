import { describe, expect, it } from "vitest";
import { CASH, changeKind, compositionEvents } from "./composition";

const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);

describe("changeKind", () => {
  it("names the four kinds of change", () => {
    expect(changeKind("buy", 0, 10)).toBe("added");
    expect(changeKind("buy", 5, 10)).toBe("increased");
    expect(changeKind("sell", 10, 4)).toBe("reduced");
    expect(changeKind("sell", 4, 0)).toBe("removed");
  });
});

describe("compositionEvents", () => {
  const closes = {
    AAA: [{ date: "2026-09-01", close: 100 }, { date: "2026-09-10", close: 200 }],
    BBB: [{ date: "2026-09-01", close: 50 }],
  };
  const t = (id: number, at: string, symbol: string, action: "buy" | "sell", quantity: number, price: number) => ({
    id, at, date: at.slice(0, 10), symbol, action, quantity, price,
  });

  it("weights before and after each trade, cash included, totalling 100%", () => {
    const ev = compositionEvents({
      startingBalance: 10000,
      trades: [t(1, "2026-09-02T10:00:00Z", "AAA", "buy", 30, 100), t(2, "2026-09-03T10:00:00Z", "BBB", "buy", 40, 50)],
      flows: [],
      closes,
    });
    expect(ev[0].kind).toBe("added");
    expect(ev[0].before).toEqual({ [CASH]: 1 });
    expect(ev[0].after[CASH]).toBeCloseTo(0.7, 12);
    expect(ev[0].after.AAA).toBeCloseTo(0.3, 12);
    expect(ev[1].before.AAA).toBeCloseTo(0.3, 12);
    expect(ev[1].after).toMatchObject({ AAA: 0.3, BBB: 0.2 });
    expect(ev[1].after[CASH]).toBeCloseTo(0.5, 12);
    for (const e of ev) {
      expect(sum(e.before)).toBeCloseTo(1, 12);
      expect(sum(e.after)).toBeCloseTo(1, 12);
    }
  });

  it("values other holdings at their close on the event's date", () => {
    // AAA doubled by 10 Sep; buying BBB then sees AAA at 200.
    const ev = compositionEvents({
      startingBalance: 10000,
      trades: [t(1, "2026-09-02T10:00:00Z", "AAA", "buy", 30, 100), t(2, "2026-09-11T10:00:00Z", "BBB", "buy", 20, 50)],
      flows: [],
      closes,
    });
    // before: AAA 30 x 200 = 6000, cash 7000 -> total 13000
    expect(ev[1].before.AAA).toBeCloseTo(6000 / 13000, 12);
    expect(ev[1].after.BBB).toBeCloseTo(1000 / 13000, 12);
  });

  it("orders events by time and tells increase, reduce and remove apart", () => {
    const ev = compositionEvents({
      startingBalance: 10000,
      trades: [
        t(3, "2026-09-05T10:00:00Z", "AAA", "sell", 10, 100),
        t(1, "2026-09-02T10:00:00Z", "AAA", "buy", 10, 100),
        t(2, "2026-09-03T10:00:00Z", "AAA", "buy", 10, 100),
        t(4, "2026-09-06T10:00:00Z", "AAA", "sell", 10, 100),
      ],
      flows: [],
      closes,
    });
    expect(ev.map((e) => [e.trade_id, e.kind])).toEqual([
      [1, "added"], [2, "increased"], [3, "reduced"], [4, "removed"],
    ]);
    expect(ev[3].after).toEqual({ [CASH]: 1 });
  });

  it("adds capital rewards at the moment they were applied", () => {
    const ev = compositionEvents({
      startingBalance: 10000,
      trades: [t(1, "2026-09-02T10:00:00Z", "AAA", "buy", 50, 100), t(2, "2026-09-04T10:00:00Z", "AAA", "buy", 1, 100)],
      flows: [{ at: "2026-09-03T12:00:00Z", amount: 100 }],
      closes,
    });
    // before event 2: AAA 50 x 100 = 5000, cash 5000 + 100
    expect(ev[1].before[CASH]).toBeCloseTo(5100 / 10100, 12);
  });

  it("is empty with no trades", () => {
    expect(compositionEvents({ startingBalance: 10000, trades: [], flows: [], closes: {} })).toEqual([]);
  });
});
