import { describe, expect, it } from "vitest";
import { buildPlayerCard, PlayerRow, PortfolioRow } from "./playerCard";

const player: PlayerRow = { nickname: null, first_name: null, avatar_url: null, bio: "" };
const at = new Date("2026-10-16T12:00:00Z");
let id = 1;
const pf = (return_pct: number, over: Partial<PortfolioRow> = {}): PortfolioRow => ({
  id: id++,
  name: `Book ${id}`,
  status: "active",
  created_at: "2026-01-01T09:00:00Z",
  return_pct,
  ...over,
});

describe("buildPlayerCard", () => {
  it("converts the shared valuation's percentages to fractions for the engine", () => {
    const card = buildPlayerCard(player, [pf(30), pf(-10)], at);
    expect(card.stats.average_active_return).toEqual({ state: "available", value: expect.closeTo(0.1, 12) });
    expect(card.stats.best_portfolio_gain).toEqual({ state: "available", value: expect.closeTo(0.3, 12) });
  });

  it("applies the engine's locks", () => {
    const card = buildPlayerCard(player, [pf(12)], at);
    expect(card.stats.average_active_return).toEqual({ state: "locked", reason: "requires_min_active_portfolios" });
    expect(card.stats.best_portfolio_gain.state).toBe("locked");
    expect(card.stats.top_portfolio).toEqual({ state: "locked", reason: "no_active_portfolio_above_threshold" });
  });

  it("names the top portfolio above 20%", () => {
    const best = pf(35, { name: "Growth" });
    const card = buildPlayerCard(player, [pf(5), best], at);
    expect(card.stats.top_portfolio).toEqual({
      state: "available",
      value: { id: best.id, name: "Growth", cumulative_return: expect.closeTo(0.35, 12) },
    });
  });

  it("counts closed portfolios in the total but not in any average", () => {
    const card = buildPlayerCard(player, [pf(10), pf(20), pf(90, { status: "closed" })], at);
    expect(card.stats.portfolios_total).toBe(3);
    expect(card.stats.portfolios_active).toBe(2);
    expect(card.stats.average_active_return).toEqual({ state: "available", value: expect.closeTo(0.15, 12) });
  });

  it("withholds what has no data or no rules yet, instead of inventing it", () => {
    const card = buildPlayerCard(player, [pf(10), pf(20)], at);
    expect(card.stats.average_month_to_date_return).toEqual({ state: "unavailable", reason: "missing_data" });
    expect(card.progression).toEqual({ state: "unavailable", reason: "not_defined" });
  });

  it("reports systems that do not exist yet as zero, since nobody has any", () => {
    const card = buildPlayerCard(player, [], at);
    expect(card.social).toEqual({ followers: 0, subscribers: 0 });
    expect(card.competitions).toEqual({ participations: 0, prize_wins: 0, top_3: 0, first_place: 0 });
    expect(card.medals).toEqual({ total: 0, top: [] });
    expect(card.achievements).toEqual({ total: 0, top: [] });
  });

  it("handles a player with no portfolios", () => {
    const card = buildPlayerCard(player, [], at);
    expect(card.stats.portfolios_total).toBe(0);
    expect(card.stats.average_month_to_date_return).toEqual({ state: "unavailable", reason: "no_active_portfolios" });
  });

  it("passes identity through unchanged and stamps the model and time", () => {
    const me = { nickname: "growthhunter", first_name: "Roee", avatar_url: null, bio: "Growth investor." };
    const card = buildPlayerCard(me, [], at);
    expect(card.player).toEqual(me);
    expect(card.model).toBe("player_card_model_v1");
    expect(card.calculated_at).toBe("2026-10-16T12:00:00.000Z");
  });
});
