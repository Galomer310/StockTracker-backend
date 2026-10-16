import { describe, expect, it } from "vitest";
import {
  PortfolioSummary,
  averageActiveReturn,
  averageMonthToDateReturn,
  bestPortfolioGain,
  competitionStats,
  monthToDateReturn,
  portfolioCounts,
  topPortfolio,
} from "./player";

let nextId = 1;
const p = (over: Partial<PortfolioSummary> = {}): PortfolioSummary => ({
  id: nextId++,
  name: `Book ${nextId}`,
  status: "active",
  opened_at: "2026-01-01",
  cumulative_return: 0,
  month_to_date_return: 0,
  ...over,
});

describe("portfolioCounts (9.1, 9.2)", () => {
  it("counts every portfolio ever opened, and the active ones separately", () => {
    expect(portfolioCounts([p(), p({ status: "closed" }), p()])).toEqual({ total: 3, active: 2 });
    expect(portfolioCounts([])).toEqual({ total: 0, active: 0 });
  });
});

describe("averageActiveReturn (4.1, 9.3)", () => {
  it("is a simple mean with every active portfolio weighted equally", () => {
    const r = averageActiveReturn([p({ cumulative_return: 0.3 }), p({ cumulative_return: -0.1 })]);
    expect(r).toEqual({ state: "available", value: expect.closeTo(0.1, 12) });
  });

  it("leaves closed portfolios out", () => {
    const r = averageActiveReturn([
      p({ cumulative_return: 0.1 }),
      p({ cumulative_return: 0.3 }),
      p({ status: "closed", cumulative_return: -0.9 }),
    ]);
    expect(r).toEqual({ state: "available", value: expect.closeTo(0.2, 12) });
  });

  it("does not adjust for how long each portfolio has existed", () => {
    const r = averageActiveReturn([
      p({ opened_at: "2024-01-01", cumulative_return: 0.5 }),
      p({ opened_at: "2026-10-01", cumulative_return: 0.01 }),
    ]);
    expect(r).toEqual({ state: "available", value: expect.closeTo(0.255, 12) });
  });

  it("is locked below two active portfolios, counting only active ones", () => {
    expect(averageActiveReturn([p()])).toEqual({ state: "locked", reason: "requires_min_active_portfolios" });
    expect(averageActiveReturn([p(), p({ status: "closed" })])).toEqual({
      state: "locked",
      reason: "requires_min_active_portfolios",
    });
  });

  it("is unavailable when an active portfolio's return is unknown", () => {
    expect(averageActiveReturn([p(), p({ cumulative_return: null })])).toEqual({
      state: "unavailable",
      reason: "missing_data",
    });
  });

  it("reports a zero average as available, not missing", () => {
    expect(averageActiveReturn([p({ cumulative_return: 0.1 }), p({ cumulative_return: -0.1 })])).toEqual({
      state: "available",
      value: expect.closeTo(0, 12),
    });
  });
});

describe("bestPortfolioGain (4.6)", () => {
  it("is the highest active return, below 20% included", () => {
    const r = bestPortfolioGain([p({ cumulative_return: 0.05 }), p({ cumulative_return: 0.12 })]);
    expect(r).toEqual({ state: "available", value: 0.12 });
  });

  it("can be negative when every active portfolio is down", () => {
    expect(bestPortfolioGain([p({ cumulative_return: -0.05 }), p({ cumulative_return: -0.2 })])).toEqual({
      state: "available",
      value: -0.05,
    });
  });

  it("ignores a better closed portfolio", () => {
    const r = bestPortfolioGain([
      p({ cumulative_return: 0.05 }),
      p({ cumulative_return: 0.1 }),
      p({ status: "closed", cumulative_return: 0.9 }),
    ]);
    expect(r).toEqual({ state: "available", value: 0.1 });
  });

  it("is locked below two active portfolios", () => {
    expect(bestPortfolioGain([p({ cumulative_return: 0.5 })])).toEqual({
      state: "locked",
      reason: "requires_min_active_portfolios",
    });
  });
});

describe("topPortfolio (9.5, 9.6)", () => {
  it("names the best active portfolio and gives its return, above 20%", () => {
    const best = p({ name: "Growth", cumulative_return: 0.35 });
    const r = topPortfolio([p({ cumulative_return: 0.21 }), best]);
    expect(r).toEqual({ state: "available", value: { id: best.id, name: "Growth", cumulative_return: 0.35 } });
  });

  it("needs strictly more than 20%", () => {
    expect(topPortfolio([p({ cumulative_return: 0.2 })])).toEqual({
      state: "locked",
      reason: "no_active_portfolio_above_threshold",
    });
    expect(topPortfolio([p({ cumulative_return: 0.2000001 })]).state).toBe("available");
  });

  it("has no minimum number of portfolios", () => {
    expect(topPortfolio([p({ cumulative_return: 0.25 })]).state).toBe("available");
  });

  it("is locked with no active portfolio, and ignores closed ones", () => {
    expect(topPortfolio([]).state).toBe("locked");
    expect(topPortfolio([p({ status: "closed", cumulative_return: 0.9 })]).state).toBe("locked");
  });

  it("picks the portfolio opened first when two tie", () => {
    const later = p({ opened_at: "2026-05-01", cumulative_return: 0.3 });
    const earlier = p({ opened_at: "2026-02-01", cumulative_return: 0.3 });
    const r = topPortfolio([later, earlier]);
    expect(r.state === "available" && r.value.id).toBe(earlier.id);
  });

  it("is unavailable when an active portfolio's return is unknown", () => {
    expect(topPortfolio([p({ cumulative_return: 0.5 }), p({ cumulative_return: null })]).state).toBe("unavailable");
  });
});

describe("averageMonthToDateReturn (9.4)", () => {
  it("is a simple mean over active portfolios, closed ones excluded", () => {
    const r = averageMonthToDateReturn([
      p({ month_to_date_return: 0.04 }),
      p({ month_to_date_return: -0.02 }),
      p({ status: "closed", month_to_date_return: 0.5 }),
    ]);
    expect(r).toEqual({ state: "available", value: expect.closeTo(0.01, 12) });
  });

  it("works with a single active portfolio, since no minimum is stated", () => {
    expect(averageMonthToDateReturn([p({ month_to_date_return: 0.03 })])).toEqual({ state: "available", value: 0.03 });
  });

  it("is unavailable with no active portfolio or a missing value", () => {
    expect(averageMonthToDateReturn([]).state).toBe("unavailable");
    expect(averageMonthToDateReturn([p(), p({ month_to_date_return: null })]).state).toBe("unavailable");
  });
});

describe("monthToDateReturn", () => {
  it("measures from the last value before the month began", () => {
    const r = monthToDateReturn(
      [
        { date: "2026-09-29", nav: 10500 },
        { date: "2026-09-30", nav: 11000 },
        { date: "2026-10-01", nav: 11330 },
        { date: "2026-10-15", nav: 11550 },
      ],
      "2026-10"
    );
    expect(r).toBeCloseTo(11550 / 11000 - 1, 12);
  });

  it("measures from opening for a portfolio opened during the month", () => {
    const r = monthToDateReturn(
      [
        { date: "2026-10-10", nav: 10000 },
        { date: "2026-10-15", nav: 10400 },
      ],
      "2026-10"
    );
    expect(r).toBeCloseTo(0.04, 12);
  });

  it("starts a new period each month", () => {
    const series = [
      { date: "2026-09-01", nav: 10000 },
      { date: "2026-09-30", nav: 12000 },
      { date: "2026-10-02", nav: 12000 },
    ];
    expect(monthToDateReturn(series, "2026-09")).toBeCloseTo(0.2, 12);
    expect(monthToDateReturn(series, "2026-10")).toBe(0);
  });

  it("excludes game capital credited during the month", () => {
    const r = monthToDateReturn(
      [
        { date: "2026-09-30", nav: 11000 },
        { date: "2026-10-05", nav: 12000, external_flow: 1000 },
      ],
      "2026-10"
    );
    expect(r).toBeCloseTo(0, 12);
  });

  it("is 0 before any value in the month, and null with no data at all", () => {
    expect(monthToDateReturn([{ date: "2026-09-30", nav: 11000 }], "2026-10")).toBe(0);
    expect(monthToDateReturn([], "2026-10")).toBeNull();
    expect(monthToDateReturn([{ date: "2026-11-02", nav: 10000 }], "2026-10")).toBeNull();
  });

  it("rejects a malformed month", () => {
    expect(() => monthToDateReturn([], "2026-1")).toThrow(RangeError);
  });
});

describe("competitionStats (8)", () => {
  it("counts the four figures, with first place inside top 3", () => {
    const s = competitionStats([
      { competition_id: "sep-2026", results_confirmed: true, final_rank: 1, won_prize: true },
      { competition_id: "q3-2026", results_confirmed: true, final_rank: 3, won_prize: false },
      { competition_id: "aug-2026", results_confirmed: true, final_rank: 7, won_prize: true },
      { competition_id: "jul-2026", results_confirmed: true, final_rank: 40, won_prize: false },
    ]);
    expect(s).toEqual({ participations: 4, prize_wins: 2, top_3: 2, first_place: 1 });
  });

  it("counts a running competition as a participation only", () => {
    const s = competitionStats([{ competition_id: "oct-2026", results_confirmed: false, final_rank: 1, won_prize: true }]);
    expect(s).toEqual({ participations: 1, prize_wins: 0, top_3: 0, first_place: 0 });
  });

  it("counts each competition once, even with several entries in it", () => {
    const s = competitionStats([
      { competition_id: "sep-2026", results_confirmed: true, final_rank: 2, won_prize: true },
      { competition_id: "sep-2026", results_confirmed: true, final_rank: 3, won_prize: true },
    ]);
    expect(s).toEqual({ participations: 1, prize_wins: 1, top_3: 1, first_place: 0 });
  });

  it("rejects an impossible rank", () => {
    expect(() =>
      competitionStats([{ competition_id: 1, results_confirmed: true, final_rank: 0, won_prize: false }])
    ).toThrow(RangeError);
  });
});
