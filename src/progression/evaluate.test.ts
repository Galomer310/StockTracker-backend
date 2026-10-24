import { describe, expect, it } from "vitest";
import catalog from "./catalog.json";
import { AchievementDef, evaluate, EvaluationContext, newlyUnlocked, PlayerFacts } from "./evaluate";

const defs: AchievementDef[] = catalog.achievements;
const byId = Object.fromEntries(defs.map((d) => [d.id, d]));
const now = new Date("2026-10-24T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

const facts = (over: Partial<PlayerFacts> = {}): PlayerFacts => ({
  created_at: daysAgo(1),
  nickname: null,
  first_name: null,
  bio: "",
  portfolios: [],
  title_selected: false,
  ...over,
});

const ctx = (over: Partial<EvaluationContext> = {}): EvaluationContext => ({
  defs,
  facts: facts(),
  unlocked: new Set(),
  founding: { start: null, end: null },
  now,
  ...over,
});

const portfolios = (...ages: number[]) => ages.map((age) => ({ created_at: daysAgo(age), closed_at: null }));

describe("newlyUnlocked", () => {
  it("gives a new account only Welcome to the Market", () => {
    expect(newlyUnlocked(ctx())).toEqual(["welcome_to_the_market"]);
  });

  it("unlocks every milestone crossed by one event, and the ones they complete", () => {
    const got = newlyUnlocked(
      ctx({
        facts: facts({ first_name: "Dana", bio: "Value investor.", portfolios: portfolios(1, 1, 1), title_selected: true }),
      })
    );
    expect(got).toEqual([
      "welcome_to_the_market",
      "the_introduction",
      "the_opening_bell",
      "a_title_to_remember",
      "the_second_act",
      "three_of_a_kind",
      // seven unlocked by now, which completes The First Five in a second pass
      "the_first_five",
    ]);
  });

  it("never returns what is already unlocked", () => {
    const unlocked = new Set(["welcome_to_the_market", "the_opening_bell"]);
    const got = newlyUnlocked(ctx({ facts: facts({ portfolios: portfolios(1) }), unlocked }));
    expect(got).toEqual([]);
  });

  it("keeps an earned milestone when its count later falls", () => {
    // Earned with two portfolios; it is in `unlocked`, so nothing re-evaluates it away.
    const unlocked = new Set(["welcome_to_the_market", "the_opening_bell", "the_second_act"]);
    expect(newlyUnlocked(ctx({ facts: facts({ portfolios: portfolios(1) }), unlocked }))).toEqual([]);
  });

  it("does not grant follow, subscription or competition achievements before those systems exist", () => {
    const got = newlyUnlocked(ctx({ facts: facts({ portfolios: portfolios(800, 800, 800) }) }));
    for (const id of ["first_connection", "golden_ticket", "the_first_fan", "enter_the_arena", "the_full_experience"]) {
      expect(got).not.toContain(id);
    }
  });
});

describe("evaluate", () => {
  it("counts portfolio age without requiring any trade, and reports progress", () => {
    expect(evaluate(byId.still_in_the_game, ctx({ facts: facts({ portfolios: portfolios(12) }) }))).toEqual({
      met: false,
      progress: { current: 12, target: 30 },
      blocked_by: [],
    });
    expect(evaluate(byId.one_year_veteran, ctx({ facts: facts({ portfolios: portfolios(365) }) })).met).toBe(true);
  });

  it("counts a closed portfolio's age up to the day it closed", () => {
    const closed = [{ created_at: daysAgo(100), closed_at: daysAgo(70) }];
    expect(evaluate(byId.still_in_the_game, ctx({ facts: facts({ portfolios: closed }) })).met).toBe(true);
    expect(evaluate(byId.playing_the_long_game, ctx({ facts: facts({ portfolios: closed }) })).met).toBe(false);
  });

  it("needs two portfolios of 90 days for Double Anchor", () => {
    const one = evaluate(byId.double_anchor, ctx({ facts: facts({ portfolios: portfolios(200, 30) }) }));
    expect(one).toEqual({ met: false, progress: { current: 1, target: 2 }, blocked_by: [] });
    expect(evaluate(byId.double_anchor, ctx({ facts: facts({ portfolios: portfolios(91, 90) }) })).met).toBe(true);
  });

  it("reports what a blocked achievement waits for", () => {
    expect(evaluate(byId.market_scout, ctx()).blocked_by).toEqual(["follows"]);
    expect(evaluate(byId.from_fan_to_insider, ctx()).blocked_by).toEqual(["follows", "subscriptions"]);
    expect(evaluate(byId.the_full_experience, ctx()).blocked_by).toEqual(["subscriptions", "competitions"]);
    expect(evaluate(byId.make_your_mark, ctx()).blocked_by).toEqual(["nicknames"]);
  });

  it("makes Ready, Set, Invest! wait for what its prerequisites wait for, with progress", () => {
    const unlocked = new Set(["welcome_to_the_market", "the_opening_bell"]);
    expect(evaluate(byId.ready_set_invest, ctx({ unlocked }))).toEqual({
      met: false,
      progress: { current: 2, target: 6 },
      blocked_by: ["nicknames", "follows"],
    });
  });

  it("starts working as soon as a system's facts are supplied", () => {
    const withFollows = facts({ following: 4, followers: 12 });
    expect(evaluate(byId.market_scout, ctx({ facts: withFollows })).met).toBe(true);
    expect(evaluate(byId.talent_spotter, ctx({ facts: withFollows })).progress).toEqual({ current: 4, target: 5 });
    expect(evaluate(byId.the_buzz, ctx({ facts: withFollows })).met).toBe(true);
    const arena = facts({ competitions: { entered: 2, completed: 1, entered_after_completing: true, distinct_months: 2 } });
    expect(evaluate(byId.back_for_more, ctx({ facts: arena })).met).toBe(true);
    expect(evaluate(byId.the_challenger, ctx({ facts: arena })).progress).toEqual({ current: 2, target: 3 });
  });

  it("treats Founding Member as nobody until a launch period ends, then inclusively", () => {
    const joined = facts({ created_at: new Date("2026-11-30T21:00:00Z") });
    expect(evaluate(byId.founding_member, ctx({ facts: joined })).met).toBe(false);
    const founding = { start: null, end: "2026-11-30" };
    expect(evaluate(byId.founding_member, ctx({ facts: joined, founding })).met).toBe(true);
    const late = facts({ created_at: new Date("2026-12-01T00:00:01Z") });
    expect(evaluate(byId.founding_member, ctx({ facts: late, founding })).met).toBe(false);
  });

  it("needs a first name and a bio for The Introduction", () => {
    expect(evaluate(byId.the_introduction, ctx({ facts: facts({ first_name: "Dana" }) })).progress).toEqual({
      current: 1,
      target: 2,
    });
    expect(evaluate(byId.the_introduction, ctx({ facts: facts({ first_name: "Dana", bio: "Hi" }) })).met).toBe(true);
  });

  it("counts the other six categories for The Grand Tour", () => {
    const unlocked = new Set(["welcome_to_the_market", "the_second_act", "still_in_the_game", "the_first_five"]);
    expect(evaluate(byId.the_grand_tour, ctx({ unlocked })).progress).toEqual({ current: 3, target: 6 });
  });

  it("never grants an unknown condition type", () => {
    expect(evaluate({ ...byId.the_buzz, condition_type: "made_up" }, ctx()).met).toBe(false);
  });
});
