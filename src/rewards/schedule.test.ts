import { describe, expect, it } from "vitest";
import {
  addDays,
  applyBoost,
  capitalForDay,
  chooseMessage,
  daysBetween,
  DEFAULT_CAPITAL_SCHEDULE as CAP,
  DEFAULT_XP_SCHEDULE as XP,
  liveStreak,
  localDate,
  nextCapitalMilestone,
  nextXpMilestone,
  streakAfterLogin,
  xpForDay,
} from "./schedule";

describe("daily XP (spec section 3)", () => {
  // The spec's own example table, plus its overlap examples (210, 1050).
  it.each([
    [1, 50], [2, 50], [6, 50], [7, 75], [14, 75], [21, 75], [30, 150], [60, 150], [90, 150],
    [150, 250], [210, 150], [300, 250], [1050, 250],
  ])("day %i pays %i XP", (day, xp) => {
    expect(xpForDay(day, XP)).toBe(xp);
  });

  it("replaces the base rather than adding to it", () => {
    expect(xpForDay(210, XP)).toBe(150); // weekly and monthly: the higher only
  });

  it("points at the next milestone day", () => {
    expect(nextXpMilestone(12, XP)).toEqual({ day: 14, xp: 75 });
    expect(nextXpMilestone(29, XP)).toEqual({ day: 30, xp: 150 });
    expect(nextXpMilestone(0, XP)).toEqual({ day: 7, xp: 75 });
  });
});

describe("capital growth (spec section 4)", () => {
  it.each([
    [7, 1], [14, 1], [21, 1], [28, 1], [30, 3], [35, 1], [42, 1], [60, 3], [90, 5], [120, 3],
    [150, 3], [180, 5], [210, 3], [270, 5], [450, 5], [630, 5],
  ])("day %i earns %i%%", (day, pct) => {
    expect(capitalForDay(day, CAP)?.pct).toBe(pct);
  });

  it("earns nothing on other days", () => {
    for (const day of [1, 2, 6, 8, 13, 29, 31, 89]) expect(capitalForDay(day, CAP)).toBeNull();
  });

  it("names the tier of the highest milestone", () => {
    expect(capitalForDay(90, CAP)?.tier).toBe("quarterly");
    expect(capitalForDay(210, CAP)?.tier).toBe("monthly");
    expect(capitalForDay(14, CAP)?.tier).toBe("weekly");
  });

  it("points at the next capital day", () => {
    expect(nextCapitalMilestone(12, CAP)).toEqual({ day: 14, pct: 1, tier: "weekly", from_day: 7 });
    expect(nextCapitalMilestone(28, CAP)).toEqual({ day: 30, pct: 3, tier: "monthly", from_day: 28 });
    expect(nextCapitalMilestone(84, CAP)).toEqual({ day: 90, pct: 5, tier: "quarterly", from_day: 84 });
    expect(nextCapitalMilestone(0, CAP)).toEqual({ day: 7, pct: 1, tier: "weekly", from_day: 0 });
    expect(nextCapitalMilestone(31, CAP)).toEqual({ day: 35, pct: 1, tier: "weekly", from_day: 30 });
  });
});

describe("streak (spec section 5)", () => {
  it("starts at 1, grows by consecutive dates, restarts after a gap", () => {
    expect(streakAfterLogin(null, 0, "2026-11-09")).toEqual({ kind: "counted", streak: 1 });
    expect(streakAfterLogin("2026-11-08", 6, "2026-11-09")).toEqual({ kind: "counted", streak: 7 });
    expect(streakAfterLogin("2026-11-07", 6, "2026-11-09")).toEqual({ kind: "counted", streak: 1 });
  });

  it("counts a second login on the same date once", () => {
    expect(streakAfterLogin("2026-11-09", 7, "2026-11-09")).toEqual({ kind: "repeat" });
  });

  it("never rewards a date earlier than the last one", () => {
    expect(streakAfterLogin("2026-11-10", 7, "2026-11-09")).toEqual({ kind: "repeat" });
  });

  it("crosses month and year ends", () => {
    expect(streakAfterLogin("2026-12-31", 30, "2027-01-01")).toEqual({ kind: "counted", streak: 31 });
    expect(streakAfterLogin("2028-02-28", 3, "2028-02-29")).toEqual({ kind: "counted", streak: 4 });
  });

  it("reads 0 once a day has been missed", () => {
    expect(liveStreak("2026-11-08", 12, "2026-11-09")).toBe(12);
    expect(liveStreak("2026-11-09", 12, "2026-11-09")).toBe(12);
    expect(liveStreak("2026-11-07", 12, "2026-11-09")).toBe(0);
  });
});

describe("calendar dates in the configured zone", () => {
  it("uses Israel's date, not UTC's", () => {
    // 23:30 UTC on 9 Nov is 01:30 on 10 Nov in Israel (UTC+2 in winter).
    expect(localDate(new Date("2026-11-09T23:30:00Z"), "Asia/Jerusalem")).toBe("2026-11-10");
    expect(localDate(new Date("2026-11-09T21:59:00Z"), "Asia/Jerusalem")).toBe("2026-11-09");
  });

  it("handles the summer clock (UTC+3)", () => {
    expect(localDate(new Date("2026-07-01T21:30:00Z"), "Asia/Jerusalem")).toBe("2026-07-02");
  });

  it("treats the 23-hour and 25-hour DST days as one day each", () => {
    // Israel moves to summer time on Fri 27 Mar 2026 and back on Sun 25 Oct 2026.
    expect(daysBetween("2026-03-26", "2026-03-27")).toBe(1);
    expect(daysBetween("2026-03-27", "2026-03-28")).toBe(1);
    expect(daysBetween("2026-10-24", "2026-10-25")).toBe(1);
    expect(daysBetween("2026-10-25", "2026-10-26")).toBe(1);
    // Logins at local midnight+5min either side of the change still chain.
    const before = localDate(new Date("2026-10-24T21:05:00Z"), "Asia/Jerusalem"); // 00:05 on the 25th, summer time
    const after = localDate(new Date("2026-10-25T22:05:00Z"), "Asia/Jerusalem"); // 00:05 on the 26th, winter time
    expect([before, after]).toEqual(["2026-10-25", "2026-10-26"]);
    expect(streakAfterLogin(before, 5, after)).toEqual({ kind: "counted", streak: 6 });
  });

  it("adds days", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("motivational messages (spec section 13)", () => {
  const ids = ["01", "02", "03", "04"];
  const seq = (values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
  };

  it("uses every message once per cycle, then starts a new cycle", () => {
    const history: { message_id: string; message_cycle: number }[] = [];
    const rand = seq([0.1, 0.7, 0.4, 0.9, 0.2, 0.5, 0.3, 0.8]);
    for (let i = 0; i < 12; i++) {
      const pick = chooseMessage(ids, history, rand)!;
      history.push({ message_id: pick.id, message_cycle: pick.cycle });
    }
    for (const cycle of [1, 2, 3]) {
      const inCycle = history.filter((h) => h.message_cycle === cycle).map((h) => h.message_id);
      expect(inCycle.sort()).toEqual(ids);
    }
  });

  it("never repeats a message back to back, across cycles too", () => {
    const history: { message_id: string; message_cycle: number }[] = [];
    for (let i = 0; i < 200; i++) {
      const pick = chooseMessage(ids, history)!;
      if (history.length) expect(pick.id).not.toBe(history[history.length - 1].message_id);
      history.push({ message_id: pick.id, message_cycle: pick.cycle });
    }
  });

  it("copes with no messages and with a single message", () => {
    expect(chooseMessage([], [])).toBeNull();
    expect(chooseMessage(["01"], [{ message_id: "01", message_cycle: 1 }])).toEqual({ id: "01", cycle: 2 });
  });

  it("ignores a disabled message when deciding the cycle is used up", () => {
    const history = [
      { message_id: "01", message_cycle: 1 },
      { message_id: "99", message_cycle: 1 }, // since disabled
    ];
    expect(chooseMessage(["01", "02"], history, () => 0)).toEqual({ id: "02", cycle: 1 });
  });
});

describe("applying capital growth keeps the return (spec section 8)", () => {
  it("example A: break-even", () => {
    const r = applyBoost({ cash: 10000, positionsValue: 0, capitalBase: 10000 }, 1);
    expect(r).toMatchObject({ ok: true, value_after: 10100, base_after: 10100, capital_added: 100 });
    if (r.ok) expect(r.return_after_pct).toBeCloseTo(0, 10);
  });

  it("example B: a 10% loss stays a 10% loss", () => {
    const r = applyBoost({ cash: 2000, positionsValue: 7000, capitalBase: 10000 }, 1);
    expect(r).toMatchObject({ ok: true, value_after: 9090, base_after: 10100, capital_added: 90, cash_after: 2090 });
    if (r.ok) {
      expect(r.return_before_pct).toBeCloseTo(-10, 10);
      expect(r.return_after_pct).toBeCloseTo(-10, 10);
    }
  });

  it("example C: a 10% gain stays a 10% gain", () => {
    const r = applyBoost({ cash: 1000, positionsValue: 10000, capitalBase: 10000 }, 1);
    expect(r).toMatchObject({ ok: true, value_after: 11110, base_after: 10100, capital_added: 110 });
    if (r.ok) expect(r.return_after_pct).toBeCloseTo(10, 10);
  });

  it("compounds when applied again, each on the updated value", () => {
    const first = applyBoost({ cash: 0, positionsValue: 11000, capitalBase: 10000 }, 1);
    if (!first.ok) throw new Error("first");
    const second = applyBoost({ cash: first.cash_after, positionsValue: 11000, capitalBase: first.base_after }, 3);
    if (!second.ok) throw new Error("second");
    expect(second.capital_added).toBeCloseTo(11110 * 0.03, 2);
    expect(second.base_after).toBeCloseTo(10000 * 1.01 * 1.03, 4);
    expect(second.return_after_pct).toBeCloseTo(10, 4);
  });

  it("stays within rounding of the return on awkward numbers", () => {
    for (const [cash, pos, base, pct] of [
      [1234.56, 8765.43, 10000, 1],
      [0.01, 9876.54, 10303.0301, 3],
      [5000, 3333.33, 10000, 5],
    ]) {
      const r = applyBoost({ cash, positionsValue: pos, capitalBase: base }, pct);
      if (!r.ok) throw new Error("refused");
      expect(Math.abs(r.return_after_pct - r.return_before_pct)).toBeLessThan(0.0001);
    }
  });

  it("refuses a portfolio without a usable valuation", () => {
    expect(applyBoost({ cash: 0, positionsValue: 0, capitalBase: 10000 }, 1)).toEqual({ ok: false, reason: "INVALID_VALUATION" });
    expect(applyBoost({ cash: NaN, positionsValue: 0, capitalBase: 10000 }, 1).ok).toBe(false);
    expect(applyBoost({ cash: 100, positionsValue: 0, capitalBase: 0 }, 1).ok).toBe(false);
  });
});
