import { describe, expect, it } from "vitest";
import catalog from "./catalog.json";
import { tierUnlockLevel } from "./levels";

// The approved title table, tier by tier: Professional Path, Market Legends,
// Capital Empire. The seed must match it exactly, in order.
const APPROVED_TITLES = [
  ["Junior Analyst", "Chart Rookie", "Capital Apprentice"],
  ["Research Associate", "Trend Scout", "Seed Investor"],
  ["Equity Researcher", "Signal Seeker", "Asset Collector"],
  ["Financial Modeler", "Dip Hunter", "Deal Maker"],
  ["Valuation Specialist", "Breakout Artist", "Equity Builder"],
  ["Sector Expert", "Momentum Rider", "Wealth Architect"],
  ["Senior Analyst", "Pattern Breaker", "Fortune Seeker"],
  ["Risk Strategist", "Volatility Navigator", "Power Broker"],
  ["Portfolio Architect", "Risk Tactician", "Fortune Maker"],
  ["Strategic Investor", "Bull Whisperer", "The Financier"],
  ["Portfolio Manager", "The Contrarian", "Empire Builder"],
  ["Head of Research", "Alpha Hunter", "The Rainmaker"],
  ["Fund Director", "Price Alchemist", "The Magnate"],
  ["Investment Principal", "The Dark Horse", "The Tycoon"],
  ["Managing Partner", "Cycle Commander", "Wall Street Royalty"],
  ["Chief Investment Officer", "Stormbreaker", "Dynasty Founder"],
  ["Investment Sage", "The Unshaken", "Legacy Architect"],
  ["Master Investor", "Market Phantom", "Capital Titan"],
  ["Market Visionary", "The Untouchable", "The Kingmaker"],
  ["The Grandmaster", "The Apex Trader", "The Sovereign"],
];

describe("title catalog", () => {
  it("holds the 60 approved titles, three per tier, in the approved order", () => {
    expect(catalog.titles).toHaveLength(60);
    const byTier = APPROVED_TITLES.map((_, i) =>
      catalog.titles.filter((t) => t.tier === i + 1).sort((a, b) => a.sort_order - b.sort_order)
    );
    byTier.forEach((tier, i) => {
      expect(tier.map((t) => t.name)).toEqual(APPROVED_TITLES[i]);
      expect(tier.map((t) => t.category)).toEqual(["professional_path", "market_legends", "capital_empire"]);
    });
  });

  it("unlocks each tier on its first level: 1, 6, 11 ... 96", () => {
    for (const t of catalog.titles) expect(t.required_level).toBe(tierUnlockLevel(t.tier));
    expect(catalog.titles.filter((t) => t.tier === 20).map((t) => t.required_level)).toEqual([96, 96, 96]);
  });

  it("gives every title a unique, stable id", () => {
    const ids = catalog.titles.map((t) => t.id);
    expect(new Set(ids).size).toBe(60);
    expect(ids).toContain("chief_investment_officer");
    expect(ids).toContain("the_apex_trader");
  });

  it("uses the approved category colours and icons", () => {
    expect(catalog.title_categories).toEqual([
      { id: "professional_path", name: "Professional Path", accent_color: "#9DBDE7", icon: "mortarboard" },
      { id: "market_legends", name: "Market Legends", accent_color: "#DAA17F", icon: "flame" },
      { id: "capital_empire", name: "Capital Empire", accent_color: "#E4CC91", icon: "crown" },
    ]);
  });
});

describe("game achievement catalog", () => {
  it("has 62 achievements in the seven approved categories", () => {
    expect(catalog.achievements).toHaveLength(62);
    const counts = Object.fromEntries(
      catalog.achievement_categories.map((c) => [c.id, catalog.achievements.filter((a) => a.category_id === c.id).length])
    );
    expect(counts).toEqual({
      first_steps: 7,
      portfolio_lab: 6,
      exploration: 9,
      community_influence: 16,
      the_arena: 9,
      dedication: 8,
      legacy_milestones: 7,
    });
  });

  it("keeps the approved category names and colours", () => {
    expect(catalog.achievement_categories.map((c) => [c.name_en, c.name_he, c.accent_color])).toEqual([
      ["First Steps", "צעדים ראשונים", "#8FA7C2"],
      ["Portfolio Lab", "תיקים והשקעות", "#C5A56C"],
      ["Exploration", "חקר וגילוי", "#9381C5"],
      ["Community & Influence", "קהילה והשפעה", "#64A9BB"],
      ["The Arena", "זירת התחרויות", "#C88F72"],
      ["Dedication", "התמדה ומסירות", "#83B498"],
      ["Legacy & Milestones", "מורשת ונקודות ציון מהותיות", "#C9AB71"],
    ]);
  });

  it("gives every achievement both languages, a known condition and a positive reward", () => {
    const known = new Set([
      "account_created", "nickname_chosen", "profile_completed", "portfolios_opened", "players_followed",
      "title_selected", "prerequisites", "subscriptions_purchased", "subscribed_after_following", "followers",
      "paying_subscribers", "competitions_entered", "competitions_completed", "competition_reentry",
      "competition_months", "portfolio_open_days", "subscription_consecutive_months", "founding_member",
      "achievements_unlocked", "full_experience", "both_sides", "categories_covered",
    ]);
    for (const a of catalog.achievements) {
      expect(a.title_en && a.title_he && a.description_en && a.description_he).toBeTruthy();
      expect(known.has(a.condition_type)).toBe(true);
      expect(a.xp_reward).toBeGreaterThan(0);
    }
    expect(new Set(catalog.achievements.map((a) => a.id)).size).toBe(62);
  });

  it("uses the proposed rewards: four tiers plus the two exceptions", () => {
    const rarity: Record<number, string> = { 25: "basic", 50: "advanced", 100: "rare", 150: "epic" };
    for (const a of catalog.achievements) {
      if (a.id === "the_powerhouse" || a.id === "the_market_mogul") continue;
      expect(a.rarity).toBe(rarity[a.xp_reward]);
    }
    const byId = Object.fromEntries(catalog.achievements.map((a) => [a.id, a]));
    expect(byId.the_powerhouse).toMatchObject({ xp_reward: 250, rarity: "exceptional", target_value: 250 });
    expect(byId.the_market_mogul).toMatchObject({ xp_reward: 500, rarity: "exceptional", target_value: 1000 });
    expect(byId.golden_ticket).toMatchObject({ title_en: "Golden Ticket", title_he: "כרטיס הזהב", xp_reward: 50 });
  });

  it("makes Ready, Set, Invest! require exactly the six onboarding achievements before it", () => {
    const first = catalog.achievements.filter((a) => a.category_id === "first_steps");
    const ready = first.find((a) => a.id === "ready_set_invest")!;
    expect(ready.prerequisite_ids).toEqual(first.filter((a) => a.id !== "ready_set_invest").map((a) => a.id));
  });
});
