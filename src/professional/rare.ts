/* ===========================================================================
   Professional achievements, stage 4: Rare Achievements and special medals.
   Pure.
   ---------------------------------------------------------------------------
   Spec v1.0 sections 27-28. Player-level achievements built from the
   permanent records of stages 2-3 and the players' medals:

   - The First to Beat the Market (one player on the platform): the earliest
     completed period in which any portfolio beat the S&P 500; several
     players in that period are ranked by outperformance, ties by the lower
     player id (27.2).
   - First to Level 25 / 50 / 100 (one player each), when cumulative XP first
     reached the level. No medals for these (28.2).
   - Three / Five Portfolios Above the Market: that many distinct portfolios
     with Beat the Market in the same calendar quarter (one record per
     quarter, never more because a fourth portfolio qualified).
   - Portfolio Master: three distinct portfolios that completed the 100%
     Portfolio Return achievement (the 30-day qualification already applied).
   - Five-Star Investor: professional achievements in five distinct
     portfolios AND Gold or higher in three eligible medal tracks (player
     level, configurable list).
   - Triple Alpha: three distinct portfolios each at least 20 percentage
     points above the S&P 500 in the same quarter (absolute difference).

   Test accounts never take a platform-first: the test panel can set XP and
   history at will.

   Decided here, flagged: "meaningful professional accomplishments" for
   Five-Star Investor = at least one professional achievement record in the
   portfolio; the three Gold "categories" are three distinct medal tracks.
   =========================================================================== */

export interface RarePlayer {
  user_id: number;
  is_tester: boolean;
  /** Every Beat the Market record (month, quarter, year): for the platform-first. */
  btm: { portfolio_id: number; achievement_id: string; period_id: string; earned_on: string; outperformance: number }[];
  /** Quarterly Beat the Market records. */
  quarters: { portfolio_id: number; quarter: string; earned_on: string; outperformance: number }[];
  /** 100% Portfolio Return records. */
  return100: { portfolio_id: number; earned_on: string }[];
  /** First professional record date per portfolio. */
  portfolios: { portfolio_id: number; first_earned_on: string }[];
  /** First date each medal reached Gold (tier 3) or higher. */
  gold: { medal_id: string; on: string }[];
  /** When the player first reached each pioneer level; absent = not reached. */
  level_reached: Partial<Record<number, string>>;
}

export interface RareRecord {
  user_id: number;
  achievement_id: string;
  period_id: string;
  earned_on: string;
  outperformance: number | null;
  details: Record<string, unknown>;
}

export const PIONEER_LEVELS = [25, 50, 100] as const;
export const TRIPLE_ALPHA_POINTS = 0.2;

/** Which achievements award a special medal (28.1), with its fixed prestige. */
export const SPECIAL_MEDALS: Record<string, { medal_id: string; tier: number }> = {
  first_to_beat_market: { medal_id: "special_first_to_beat_market", tier: 5 },
  three_portfolios_above_market: { medal_id: "special_triple_market_beater", tier: 3 },
  five_portfolios_above_market: { medal_id: "special_five_portfolio_elite", tier: 5 },
  portfolio_master: { medal_id: "special_portfolio_master", tier: 4 },
  five_star_investor: { medal_id: "special_five_star_investor", tier: 5 },
  triple_alpha: { medal_id: "special_triple_alpha", tier: 4 },
};

export const DEFAULT_FIVE_STAR_MEDALS = [
  "btm_annual",
  "btm_quarterly",
  "btm_monthly_combo",
  "portfolio_performance",
  "green_months",
  "capital_protector",
  "phoenix_recovery",
];

const nth = (dates: string[], n: number) => [...dates].sort()[n - 1] ?? null;

export const computeRare = (input: {
  players: RarePlayer[];
  /** Platform-unique achievement ids already awarded to someone. */
  taken: Set<string>;
  fiveStarMedals?: string[];
}): RareRecord[] => {
  const out: RareRecord[] = [];
  const eligible = new Set(input.fiveStarMedals ?? DEFAULT_FIVE_STAR_MEDALS);
  const real = input.players.filter((p) => !p.is_tester);

  // ---- The First to Beat the Market (27.2).
  if (!input.taken.has("first_to_beat_market")) {
    const all = real.flatMap((p) => p.btm.map((r) => ({ ...r, user_id: p.user_id })));
    if (all.length) {
      const first = all.map((r) => r.earned_on).sort()[0];
      const winner = all
        .filter((r) => r.earned_on === first)
        .sort((a, b) => b.outperformance - a.outperformance || a.user_id - b.user_id || a.portfolio_id - b.portfolio_id)[0];
      out.push({
        user_id: winner.user_id,
        achievement_id: "first_to_beat_market",
        period_id: "platform",
        earned_on: first,
        outperformance: winner.outperformance,
        details: { portfolio_id: winner.portfolio_id, via: winner.achievement_id, period: winner.period_id },
      });
    }
  }

  // ---- First to Level 25 / 50 / 100 (27.3).
  for (const level of PIONEER_LEVELS) {
    const id = `first_to_level_${level}`;
    if (input.taken.has(id)) continue;
    const winner = real
      .filter((p) => p.level_reached[level])
      .sort((a, b) => a.level_reached[level]!.localeCompare(b.level_reached[level]!) || a.user_id - b.user_id)[0];
    if (winner) {
      out.push({ user_id: winner.user_id, achievement_id: id, period_id: "platform", earned_on: winner.level_reached[level]!.slice(0, 10), outperformance: null, details: { level } });
    }
  }

  for (const p of input.players) {
    // ---- Same-quarter achievements (27.4, 27.7): distinct portfolios.
    const byQuarter = new Map<string, typeof p.quarters>();
    for (const q of p.quarters) byQuarter.set(q.quarter, [...(byQuarter.get(q.quarter) ?? []), q]);
    for (const [quarter, wins] of byQuarter) {
      const ids = [...new Set(wins.map((w) => w.portfolio_id))].sort((a, b) => a - b);
      const end = wins[0].earned_on;
      if (ids.length >= 3) out.push({ user_id: p.user_id, achievement_id: "three_portfolios_above_market", period_id: quarter, earned_on: end, outperformance: null, details: { portfolios: ids } });
      if (ids.length >= 5) out.push({ user_id: p.user_id, achievement_id: "five_portfolios_above_market", period_id: quarter, earned_on: end, outperformance: null, details: { portfolios: ids } });
      const alpha = [...new Set(wins.filter((w) => w.outperformance >= TRIPLE_ALPHA_POINTS - 1e-12).map((w) => w.portfolio_id))].sort((a, b) => a - b);
      if (alpha.length >= 3) out.push({ user_id: p.user_id, achievement_id: "triple_alpha", period_id: quarter, earned_on: end, outperformance: null, details: { portfolios: alpha } });
    }

    // ---- Portfolio Master (27.5): the third distinct portfolio to qualify at 100%.
    const firstAt100 = new Map<number, string>();
    for (const r of p.return100) if (!firstAt100.has(r.portfolio_id) || r.earned_on < firstAt100.get(r.portfolio_id)!) firstAt100.set(r.portfolio_id, r.earned_on);
    const masterOn = nth([...firstAt100.values()], 3);
    if (masterOn) out.push({ user_id: p.user_id, achievement_id: "portfolio_master", period_id: "once", earned_on: masterOn, outperformance: null, details: { portfolios: [...firstAt100.keys()].sort((a, b) => a - b) } });

    // ---- Five-Star Investor (27.6): both conditions; earned when the later one is met.
    const fifthPortfolio = nth(p.portfolios.map((x) => x.first_earned_on), 5);
    const goldOn = new Map<string, string>();
    for (const g of p.gold) if (eligible.has(g.medal_id) && (!goldOn.has(g.medal_id) || g.on < goldOn.get(g.medal_id)!)) goldOn.set(g.medal_id, g.on);
    const thirdGold = nth([...goldOn.values()], 3);
    if (fifthPortfolio && thirdGold) {
      out.push({
        user_id: p.user_id,
        achievement_id: "five_star_investor",
        period_id: "once",
        earned_on: fifthPortfolio > thirdGold ? fifthPortfolio : thirdGold,
        outperformance: null,
        details: { portfolios: p.portfolios.map((x) => x.portfolio_id).sort((a, b) => a - b), gold_medals: [...goldOn.keys()].sort() },
      });
    }
  }
  return out;
};

/**
 * When cumulative XP first reached each level, from the player's ledger in
 * time order and the configured thresholds (a level with no threshold, or
 * with a gap below it, is never reached - as levelFor does).
 */
export const levelReachedDates = (
  ledger: { at: string; amount: number }[],
  thresholds: { level: number; xp_required: number }[],
  levels: readonly number[] = PIONEER_LEVELS
): Partial<Record<number, string>> => {
  const req = new Map(thresholds.map((t) => [t.level, t.xp_required]));
  const need = (level: number) => {
    // Every level up to it must be configured.
    for (let l = 2; l <= level; l++) if (!req.has(l)) return null;
    return req.get(level)!;
  };
  const out: Partial<Record<number, string>> = {};
  let total = 0;
  const sorted = [...ledger].sort((a, b) => a.at.localeCompare(b.at));
  for (const e of sorted) {
    total += e.amount;
    for (const level of levels) {
      const n = need(level);
      if (n !== null && out[level] === undefined && total >= n) out[level] = e.at;
    }
  }
  return out;
};
