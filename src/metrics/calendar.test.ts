import { describe, expect, it } from "vitest";
import { localDate, localMonth } from "./calendar";
import { monthToDateReturn } from "./player";

describe("localDate and localMonth", () => {
  it("defaults to Israel time", () => {
    // 21:30 UTC on 30 Sep is 00:30 on 1 Oct in Israel (UTC+3 in summer).
    const at = new Date("2026-09-30T21:30:00Z");
    expect(localDate(at)).toBe("2026-10-01");
    expect(localMonth(at)).toBe("2026-10");
    expect(localMonth(at, "UTC")).toBe("2026-09");
  });

  it("follows daylight saving rather than a fixed offset", () => {
    // After clocks go back on 25 Oct 2026, Israel is UTC+2: the same 21:30
    // UTC is now 23:30 the same day, not the next.
    expect(localDate(new Date("2026-10-31T21:30:00Z"))).toBe("2026-10-31");
    expect(localDate(new Date("2026-10-31T22:30:00Z"))).toBe("2026-11-01");
  });

  it("rolls the year over at Israel midnight", () => {
    expect(localMonth(new Date("2026-12-31T22:30:00Z"))).toBe("2027-01");
  });

  it("rejects an invalid date", () => {
    expect(() => localDate(new Date("not a date"))).toThrow(RangeError);
  });
});

describe("month-to-date return on Israel calendar months", () => {
  it("puts a value just after Israel midnight into the new month", () => {
    // Recorded at 21:45 UTC on 30 Sep: already 1 Oct in Israel. Dated in
    // UTC it would be September's close and October's return would be 0;
    // dated in Israel time it is October's first value.
    const at = (iso: string) => localDate(new Date(iso));
    const series = [
      { date: at("2026-09-29T14:00:00Z"), nav: 10000 },
      { date: at("2026-09-30T21:45:00Z"), nav: 10300 },
    ];
    expect(series.map((p) => p.date)).toEqual(["2026-09-29", "2026-10-01"]);
    expect(monthToDateReturn(series, localMonth(new Date("2026-10-02T09:00:00Z")))).toBeCloseTo(0.03, 12);
  });
});
