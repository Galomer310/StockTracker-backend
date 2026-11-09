import { describe, expect, it } from "vitest";
import { computeRare, levelReachedDates, RarePlayer } from "./rare";

const player = (over: Partial<RarePlayer> & { user_id: number }): RarePlayer => ({
  is_tester: false,
  btm: [],
  quarters: [],
  return100: [],
  portfolios: [],
  gold: [],
  level_reached: {},
  ...over,
});
const ids = (rs: ReturnType<typeof computeRare>, id: string) => rs.filter((r) => r.achievement_id === id);

describe("The First to Beat the Market", () => {
  const btm = (portfolio_id: number, earned_on: string, outperformance: number) => ({ portfolio_id, achievement_id: "btm_month", period_id: earned_on.slice(0, 7), earned_on, outperformance });

  it("the earliest completed period wins; within it, the largest outperformance", () => {
    const rs = computeRare({
      players: [
        player({ user_id: 1, btm: [btm(10, "2026-02-28", 0.09)] }),
        player({ user_id: 2, btm: [btm(20, "2026-01-31", 0.01)] }),
        player({ user_id: 3, btm: [btm(30, "2026-01-31", 0.04)] }),
      ],
      taken: new Set(),
    });
    expect(ids(rs, "first_to_beat_market")).toEqual([
      expect.objectContaining({ user_id: 3, period_id: "platform", earned_on: "2026-01-31", outperformance: 0.04 }),
    ]);
  });

  it("identical outperformance: the lower player id, deterministically; only one ever", () => {
    const players = [player({ user_id: 9, btm: [btm(90, "2026-01-31", 0.02)] }), player({ user_id: 4, btm: [btm(40, "2026-01-31", 0.02)] })];
    expect(ids(computeRare({ players, taken: new Set() }), "first_to_beat_market").map((r) => r.user_id)).toEqual([4]);
    expect(ids(computeRare({ players, taken: new Set(["first_to_beat_market"]) }), "first_to_beat_market")).toEqual([]);
  });

  it("a test account never takes it", () => {
    const rs = computeRare({
      players: [player({ user_id: 1, is_tester: true, btm: [btm(10, "2025-01-31", 0.5)] }), player({ user_id: 2, btm: [btm(20, "2026-01-31", 0.01)] })],
      taken: new Set(),
    });
    expect(ids(rs, "first_to_beat_market").map((r) => r.user_id)).toEqual([2]);
  });
});

describe("Level pioneers", () => {
  const thresholds = Array.from({ length: 99 }, (_, i) => ({ level: i + 2, xp_required: 25 * (i + 1) ** 2 }));

  it("when cumulative XP first reached the level, from the ledger", () => {
    const need25 = 25 * 24 ** 2; // 14,400
    const d = levelReachedDates([{ at: "2026-03-01T10:00:00Z", amount: need25 - 1 }, { at: "2026-03-05T10:00:00Z", amount: 1 }], thresholds);
    expect(d[25]).toBe("2026-03-05T10:00:00Z");
    expect(d[50]).toBeUndefined();
    // A gap in the thresholds means the level is never reached.
    expect(levelReachedDates([{ at: "2026-03-01T10:00:00Z", amount: 1e9 }], thresholds.filter((t) => t.level !== 10))[25]).toBeUndefined();
  });

  it("the first player to each level, testers excluded, once each, and no medal", () => {
    const rs = computeRare({
      players: [
        player({ user_id: 1, is_tester: true, level_reached: { 25: "2026-01-01T00:00:00Z" } }),
        player({ user_id: 2, level_reached: { 25: "2026-02-01T00:00:00Z", 50: "2026-05-01T00:00:00Z" } }),
        player({ user_id: 3, level_reached: { 25: "2026-01-15T00:00:00Z" } }),
      ],
      taken: new Set(["first_to_level_50"]),
    });
    expect(ids(rs, "first_to_level_25").map((r) => [r.user_id, r.earned_on])).toEqual([[3, "2026-01-15"]]);
    expect(ids(rs, "first_to_level_50")).toEqual([]);
  });
});

describe("Several portfolios in one quarter", () => {
  const q = (portfolio_id: number, quarter: string, outperformance: number) => ({ portfolio_id, quarter, earned_on: "2026-03-31", outperformance });

  it("three and five distinct portfolios in the same quarter; one record per quarter", () => {
    const quarters = [q(1, "2026-Q1", 0.05), q(2, "2026-Q1", 0.05), q(3, "2026-Q1", 0.05), q(4, "2026-Q1", 0.05), q(5, "2026-Q1", 0.05), q(1, "2026-Q2", 0.05), q(2, "2026-Q2", 0.05)];
    const rs = computeRare({ players: [player({ user_id: 1, quarters })], taken: new Set() });
    expect(ids(rs, "three_portfolios_above_market").map((r) => r.period_id)).toEqual(["2026-Q1"]);
    expect(ids(rs, "five_portfolios_above_market").map((r) => r.period_id)).toEqual(["2026-Q1"]);
  });

  it("different quarters do not add up", () => {
    const rs = computeRare({ players: [player({ user_id: 1, quarters: [q(1, "2026-Q1", 0.3), q(2, "2026-Q2", 0.3), q(3, "2026-Q3", 0.3)] })], taken: new Set() });
    expect(rs).toEqual([]);
  });

  it("Triple Alpha: 20 points absolute, not 20% of the benchmark's return", () => {
    const ok = computeRare({ players: [player({ user_id: 1, quarters: [q(1, "2026-Q1", 0.2), q(2, "2026-Q1", 0.25), q(3, "2026-Q1", 0.31)] })], taken: new Set() });
    expect(ids(ok, "triple_alpha").map((r) => r.period_id)).toEqual(["2026-Q1"]);
    const short = computeRare({ players: [player({ user_id: 1, quarters: [q(1, "2026-Q1", 0.2), q(2, "2026-Q1", 0.25), q(3, "2026-Q1", 0.19)] })], taken: new Set() });
    expect(ids(short, "triple_alpha")).toEqual([]);
  });
});

describe("Portfolio Master and Five-Star Investor", () => {
  it("Portfolio Master: three distinct portfolios qualified at 100%, dated by the third", () => {
    const rs = computeRare({
      players: [player({ user_id: 1, return100: [{ portfolio_id: 1, earned_on: "2026-01-10" }, { portfolio_id: 2, earned_on: "2026-04-10" }, { portfolio_id: 3, earned_on: "2026-02-10" }] })],
      taken: new Set(),
    });
    expect(ids(rs, "portfolio_master")).toEqual([expect.objectContaining({ period_id: "once", earned_on: "2026-04-10" })]);
    expect(computeRare({ players: [player({ user_id: 1, return100: [{ portfolio_id: 1, earned_on: "2026-01-10" }, { portfolio_id: 1, earned_on: "2026-02-10" }] })], taken: new Set() })).toEqual([]);
  });

  it("Five-Star Investor: five portfolios and three Gold medal tracks at player level", () => {
    const portfolios = [1, 2, 3, 4, 5].map((id) => ({ portfolio_id: id, first_earned_on: `2026-0${id}-28` }));
    const gold = [
      { medal_id: "btm_annual", on: "2026-01-01" },
      { medal_id: "green_months", on: "2026-02-01" },
      { medal_id: "capital_protector", on: "2026-07-01" },
    ];
    const rs = computeRare({ players: [player({ user_id: 1, portfolios, gold })], taken: new Set() });
    expect(ids(rs, "five_star_investor")).toEqual([expect.objectContaining({ earned_on: "2026-07-01" })]);
    // Four portfolios, or Gold in a track not on the list: not yet.
    expect(computeRare({ players: [player({ user_id: 1, portfolios: portfolios.slice(0, 4), gold })], taken: new Set() })).toEqual([]);
    expect(computeRare({ players: [player({ user_id: 1, portfolios, gold })], taken: new Set(), fiveStarMedals: ["btm_annual", "green_months"] })).toEqual([]);
  });
});
