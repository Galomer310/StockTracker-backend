import { PortfolioEvaluation } from "./engine";

/* ===========================================================================
   Professional medals, stage 2: player-level, derived from every
   portfolio's evaluation. Pure.
   ---------------------------------------------------------------------------
   A medal belongs to the player and is never duplicated because several
   portfolios qualified (3.2). Five tiers: 1 Bronze, 2 Silver, 3 Gold,
   4 Platinum, 5 Sovereign; `decoration` carries the advanced evolutions
   of the fifth tier (Sovereign II / III, Green Months' yearly marks).

   Tracks built here (thresholds configurable, the spec's as defaults):
   - btm_monthly_combo   highest monthly winning streak in ONE portfolio (8.3)
   - btm_quarterly       distinct winning quarters with a full-quarter
                         portfolio; consecutive not required (10.1)
   - btm_annual          one historical medal per winning year:
                         Gold / Platinum (>= 15 points) / Sovereign (13.1)
   - portfolio_performance  highest qualified return milestone (17)
   - green_months        highest positive-month streak in one portfolio (20)
   =========================================================================== */

export interface MedalTiers {
  btm_monthly_combo: number[];
  btm_quarterly: number[];
  green_months: number[];
  /** Return threshold (percent) per tier, Bronze to Sovereign. */
  portfolio_performance: number[];
  annual_platinum_points: number;
  capital_protector: number[];
}

export const DEFAULT_MEDAL_TIERS: MedalTiers = {
  btm_monthly_combo: [1, 2, 3, 6, 12],
  btm_quarterly: [1, 2, 3, 4, 5],
  green_months: [1, 3, 6, 9, 12],
  portfolio_performance: [10, 20, 50, 75, 100],
  annual_platinum_points: 15,
  capital_protector: [1, 3, 6, 9, 12],
};

export const TIER_NAMES = ["", "Bronze", "Silver", "Gold", "Platinum", "Sovereign"] as const;

export interface MedalState {
  medal_id: string;
  /** "" for an evolving medal; the year for an annual one. */
  period_key: string;
  tier: number;
  /** Sovereign II = 2, III = 3; Green Months: completed years from 24 months on. */
  decoration: number;
  portfolio_id: number | null;
  relevant_period: string | null;
  qualifying_value: number | null;
  highest_streak: number | null;
  current_streak: number | null;
  /** A short engraved subtitle key: annual_champion, calendar_sweep, combo. */
  subtitle: string | null;
  /** Latest date that contributed (for recency). */
  as_of: string;
}

export const tierFor = (value: number, thresholds: number[]): number => {
  let tier = 0;
  thresholds.forEach((t, i) => {
    if (value >= t) tier = i + 1;
  });
  return tier;
};

export interface PortfolioInput {
  id: number;
  evaluation: PortfolioEvaluation;
}

export const computeMedals = (portfolios: PortfolioInput[], tiers: MedalTiers = DEFAULT_MEDAL_TIERS): MedalState[] => {
  const out: MedalState[] = [];

  // ---- Monthly Beat the Market Combo and Green Months: streak medals.
  const streakMedal = (medal_id: string, key: "btm_month" | "green", thresholds: number[], decorate: boolean) => {
    let best: { p: PortfolioInput; highest: number; end: string } | null = null;
    let current = 0;
    for (const p of portfolios) {
      const s = p.evaluation.streaks[key];
      current = Math.max(current, s.current);
      if (s.highest > 0 && (!best || s.highest > best.highest || (s.highest === best.highest && s.highest_end! < best.end))) {
        best = { p, highest: s.highest, end: s.highest_end! };
      }
    }
    if (!best) return;
    const tier = tierFor(best.highest, thresholds);
    if (tier === 0) return;
    out.push({
      medal_id,
      period_key: "",
      tier,
      // Green Months keeps evolving at every full year from 24 months (20).
      decoration: decorate && best.highest >= 24 ? Math.floor(best.highest / 12) : 0,
      portfolio_id: best.p.id,
      relevant_period: best.end.slice(0, 7),
      qualifying_value: best.highest,
      highest_streak: best.highest,
      current_streak: current,
      subtitle: null,
      as_of: best.end,
    });
  };
  streakMedal("btm_monthly_combo", "btm_month", tiers.btm_monthly_combo, false);
  streakMedal("green_months", "green", tiers.green_months, true);

  // ---- Quarterly Beat the Market: distinct quarters won by a full-quarter portfolio.
  const quarterBest = new Map<string, { id: number; out: number; end: string }>();
  let latestEvaluated = "";
  for (const p of portfolios) {
    for (const q of p.evaluation.quarters) {
      if (q.period > latestEvaluated) latestEvaluated = q.period;
      if (!q.win || !q.medal_eligible) continue;
      const o = q.portfolio_return - q.benchmark_return;
      const prev = quarterBest.get(q.period);
      if (!prev || o > prev.out) quarterBest.set(q.period, { id: p.id, out: o, end: q.end });
    }
  }
  if (quarterBest.size > 0) {
    const won = [...quarterBest.keys()].sort();
    const latest = won[won.length - 1];
    const tier = tierFor(won.length, tiers.btm_quarterly);
    // The COMBO line: consecutive winning quarters up to the latest one evaluated.
    let combo = 0;
    for (let q = latestEvaluated; quarterBest.has(q); q = prevQuarter(q)) combo++;
    const b = quarterBest.get(latest)!;
    if (tier > 0) {
      out.push({
        medal_id: "btm_quarterly",
        period_key: "",
        tier,
        decoration: 0,
        portfolio_id: b.id,
        relevant_period: latest,
        qualifying_value: b.out,
        highest_streak: won.length,
        current_streak: combo,
        subtitle: combo >= 2 ? "combo" : null,
        as_of: b.end,
      });
    }
  }

  // ---- Annual: one historical medal per winning year (13).
  const years = new Map<string, MedalState>();
  for (const p of portfolios) {
    for (const y of p.evaluation.years) {
      if (!y.win) continue;
      const o = y.portfolio_return - y.benchmark_return;
      const tier = y.sweep ? 5 : o * 100 >= tiers.annual_platinum_points - 1e-9 ? 4 : 3;
      const prev = years.get(y.period);
      if (!prev || tier > prev.tier || (tier === prev.tier && o > (prev.qualifying_value ?? -Infinity))) {
        years.set(y.period, {
          medal_id: "btm_annual",
          period_key: y.period,
          tier,
          decoration: 0,
          portfolio_id: p.id,
          relevant_period: y.period,
          qualifying_value: o,
          highest_streak: null,
          current_streak: null,
          subtitle: tier === 5 ? "calendar_sweep" : "annual_champion",
          as_of: y.end,
        });
      }
    }
  }
  out.push(...[...years.values()].sort((a, b) => a.period_key.localeCompare(b.period_key)));

  // ---- Portfolio Performance: the highest qualified return milestone (17).
  let top: { id: number; pct: number; on: string } | null = null;
  for (const p of portfolios) {
    for (const r of p.evaluation.records) {
      if (r.achievement_id !== "portfolio_return") continue;
      const pct = Number(r.period_id);
      if (!top || pct > top.pct || (pct === top.pct && r.earned_on < top.on)) top = { id: p.id, pct, on: r.earned_on };
    }
  }
  if (top) {
    const tier = tierFor(top.pct, tiers.portfolio_performance);
    if (tier > 0) {
      out.push({
        medal_id: "portfolio_performance",
        period_key: "",
        tier,
        decoration: top.pct >= 300 ? 3 : top.pct >= 200 ? 2 : 0,
        portfolio_id: top.id,
        relevant_period: null,
        qualifying_value: top.pct / 100,
        highest_streak: null,
        current_streak: null,
        subtitle: null,
        as_of: top.on,
      });
    }
  }
  // ---- Capital Protector (24): distinct quarters protected by a full-quarter portfolio.
  const protectedQ = new Map<string, { id: number; end: string; down: number }>();
  for (const p of portfolios) {
    for (const q of p.evaluation.risk?.quarters ?? []) {
      if (!q.protector || !q.medal_eligible) continue;
      const prev = protectedQ.get(q.period);
      if (!prev || q.portfolio_downside > prev.down) protectedQ.set(q.period, { id: p.id, end: q.end, down: q.portfolio_downside });
    }
  }
  if (protectedQ.size > 0) {
    const latest = [...protectedQ.keys()].sort().pop()!;
    const tier = tierFor(protectedQ.size, tiers.capital_protector);
    if (tier > 0) {
      out.push({
        medal_id: "capital_protector",
        period_key: "",
        tier,
        decoration: 0,
        portfolio_id: protectedQ.get(latest)!.id,
        relevant_period: latest,
        qualifying_value: protectedQ.size,
        highest_streak: protectedQ.size,
        current_streak: null,
        subtitle: null,
        as_of: protectedQ.get(latest)!.end,
      });
    }
  }

  // ---- Phoenix Recovery (25): the furthest tier along any one portfolio's path.
  let phoenix: { id: number; tiers: string[]; recovered_on: string } | null = null;
  for (const p of portfolios) {
    for (const path of p.evaluation.risk?.phoenix ?? []) {
      const better =
        !phoenix ||
        path.tiers.length > phoenix.tiers.length ||
        (path.tiers.length === phoenix.tiers.length && path.tiers[path.tiers.length - 1] < phoenix.tiers[phoenix.tiers.length - 1]);
      if (path.tiers.length > 0 && better) phoenix = { id: p.id, tiers: path.tiers, recovered_on: path.recovered_on };
    }
  }
  if (phoenix) {
    out.push({
      medal_id: "phoenix_recovery",
      period_key: "",
      tier: Math.min(5, phoenix.tiers.length),
      decoration: 0,
      portfolio_id: phoenix.id,
      relevant_period: phoenix.recovered_on.slice(0, 7),
      // The recovery date, never the depth of the fall (25: no prestige for deeper losses).
      qualifying_value: null,
      highest_streak: null,
      current_streak: null,
      subtitle: null,
      as_of: phoenix.tiers[phoenix.tiers.length - 1],
    });
  }
  return out;
};

const prevQuarter = (q: string) => {
  const y = Number(q.slice(0, 4));
  const n = Number(q.slice(6));
  return n === 1 ? `${y - 1}-Q4` : `${y}-Q${n - 1}`;
};

/** Importance of a track when tiers tie (6.1): a year beats a quarter beats the rest. */
const TRACK_RANK: Record<string, number> = {
  btm_annual: 5,
  btm_quarterly: 4,
  portfolio_performance: 3,
  capital_protector: 2.6,
  phoenix_recovery: 2.4,
  btm_monthly_combo: 2,
  green_months: 1,
};

// Special medals rank by their fixed tier first; among equals they follow the annual medal.
const rankOf = (id: string) => TRACK_RANK[id] ?? (id.startsWith("special_") ? 4.5 : 0);

/** The automatic Player Card order: tier, then importance, then recency (6.1). */
export const autoOrder = <T extends { medal_id: string; tier: number; decoration: number; as_of: string }>(medals: T[]): T[] =>
  [...medals].sort(
    (a, b) =>
      b.tier - a.tier ||
      b.decoration - a.decoration ||
      rankOf(b.medal_id) - rankOf(a.medal_id) ||
      b.as_of.localeCompare(a.as_of)
  );
