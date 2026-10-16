import { describe, expect, it } from "vitest";
import { drawdownSeries, maxDrawdown } from "./drawdown";
import { performanceIndex } from "./returns";

const idx = (values: number[]) =>
  values.map((value, i) => ({ date: `2026-02-${String(i + 1).padStart(2, "0")}`, value }));

describe("drawdownSeries", () => {
  it("measures from the running peak", () => {
    const dd = drawdownSeries(idx([100, 120, 90, 130])).map((p) => p.value);
    expect(dd[0]).toBe(0);
    expect(dd[1]).toBe(0);
    expect(dd[2]).toBeCloseTo(-0.25, 12);
    expect(dd[3]).toBe(0);
  });
});

describe("maxDrawdown", () => {
  it("is the largest peak-to-trough fall, not the worst day", () => {
    // Three -10% days in a row: the worst day is -10%, the drawdown -27.1%.
    const result = maxDrawdown(idx([100, 90, 81, 72.9, 80]));
    expect(result?.value).toBeCloseTo(-0.271, 12);
    expect(result?.peak_date).toBe("2026-02-01");
    expect(result?.trough_date).toBe("2026-02-04");
  });

  it("keeps the deeper of two separate drawdowns", () => {
    // 100 -> 80 is -20%; later 150 -> 135 is only -10%.
    const result = maxDrawdown(idx([100, 80, 150, 135]));
    expect(result?.value).toBeCloseTo(-0.2, 12);
    expect(result?.trough_date).toBe("2026-02-02");
  });

  it("is zero with no dates for a series that only rises", () => {
    expect(maxDrawdown(idx([100, 101, 105]))).toEqual({ value: 0, peak_date: null, trough_date: null });
  });

  it("is null for an empty series", () => {
    expect(maxDrawdown([])).toBeNull();
  });

  it("is not hidden by game-earned capital", () => {
    // The book falls from 11,000 to 10,000 on the day a 1,000 reward lands,
    // so raw NAV stays at 11,000 and shows no drawdown at all. The investing
    // lost 1,000 / 11,000 = 9.09%, and the drawdown must say so.
    const index = performanceIndex([
      { date: "2026-02-01", nav: 10000 },
      { date: "2026-02-02", nav: 11000 },
      { date: "2026-02-03", nav: 11000, external_flow: 1000 },
    ]);
    const result = maxDrawdown(index);
    expect(result?.peak_date).toBe("2026-02-02");
    expect(result?.trough_date).toBe("2026-02-03");
    expect(result?.value).toBeCloseTo(10000 / 11000 - 1, 12);
  });
});
