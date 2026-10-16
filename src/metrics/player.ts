/* ===========================================================================
   Player Card aggregates (docs/PRODUCT-SPEC-AND-GAP.md, Parts 3 and 4).
   ---------------------------------------------------------------------------
   Player-level figures built from per-portfolio ones. Each portfolio's
   returns come from returns.ts, so game-earned capital never counts here
   either; this file only decides which portfolios count and how they are
   combined.

   Card figures can be available, locked (a rule withholds them, and the card
   explains the condition) or unavailable (the data is missing). The spec
   requires all three to display properly, so they are distinct states here
   rather than a null that the UI has to interpret.

   Average return (4.1) and Player Performance's average return (9.3) are the
   same figure by rule, so there is one function for both.

   When two active portfolios share the highest return, the one opened first
   is chosen (then the lower id) - agreed 2026-10-16, since the spec does not
   say. It matters only where a name is shown (9.5).
   =========================================================================== */

import { MIN_ACTIVE_PORTFOLIOS_FOR_PLAYER_STATS, TOP_PORTFOLIO_MIN_RETURN } from "./config";
import { NavPoint, totalReturn } from "./returns";
import { MetricDefinition } from "./types";

const playerMetric = (id: string): MetricDefinition => ({
  id,
  version: "player_card_model_v1",
  sources: ["internal_portfolio_db", "market_data_api", "game_engine"],
  explanation: null,
});

export const PLAYER_AVERAGE_RETURN = playerMetric("player_average_active_return");
export const PLAYER_BEST_PORTFOLIO_GAIN = playerMetric("player_best_portfolio_gain");
export const PLAYER_TOP_PORTFOLIO = playerMetric("player_top_portfolio");
// Distinct from Module 5's per-portfolio Average Monthly Return, which is a
// different metric under a similar name.
export const PLAYER_AVERAGE_MONTH_TO_DATE_RETURN = playerMetric("player_average_month_to_date_return");

export type LockReason =
  | "requires_min_active_portfolios"
  | "no_active_portfolio_above_threshold";

// not_defined: the rules behind the figure are deliberately not written yet
// (XP, levels and titles), so it is withheld rather than invented.
export type UnavailableReason = "missing_data" | "no_active_portfolios" | "not_defined";

export type CardValue<T> =
  | { state: "available"; value: T }
  | { state: "locked"; reason: LockReason }
  | { state: "unavailable"; reason: UnavailableReason };

export interface PortfolioSummary {
  id: number;
  name: string;
  status: "active" | "closed";
  /** When it was opened, ISO. */
  opened_at: string;
  /** Since opening, flow-adjusted. null when it cannot be computed. */
  cumulative_return: number | null;
  /** Since the start of the current month, or since opening if later. null when unknown. */
  month_to_date_return: number | null;
}

const available = <T>(value: T): CardValue<T> => ({ state: "available", value });
const locked = (reason: LockReason): CardValue<never> => ({ state: "locked", reason });
const unavailable = (reason: UnavailableReason): CardValue<never> => ({ state: "unavailable", reason });

const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length;

const activeOnly = (portfolios: PortfolioSummary[]) => portfolios.filter((p) => p.status === "active");

// 9.1 and 9.2. Total counts every portfolio ever opened, closed ones included.
export const portfolioCounts = (portfolios: PortfolioSummary[]): { total: number; active: number } => ({
  total: portfolios.length,
  active: activeOnly(portfolios).length,
});

// 4.1 / 9.3: simple mean of active portfolios' returns since opening, every
// portfolio weighted equally, no adjustment for age.
export const averageActiveReturn = (portfolios: PortfolioSummary[]): CardValue<number> => {
  const active = activeOnly(portfolios);
  if (active.length < MIN_ACTIVE_PORTFOLIOS_FOR_PLAYER_STATS) return locked("requires_min_active_portfolios");
  const returns = active.map((p) => p.cumulative_return);
  if (returns.some((r) => r === null)) return unavailable("missing_data");
  return available(mean(returns as number[]));
};

// The active portfolio with the highest cumulative return; null when there
// are none. "missing" when any active portfolio's return is unknown, since
// the unknown one might be the highest.
const highestActive = (active: PortfolioSummary[]): PortfolioSummary | null | "missing" => {
  if (active.some((p) => p.cumulative_return === null)) return "missing";
  let best: PortfolioSummary | null = null;
  for (const p of active) {
    const r = p.cumulative_return as number;
    const b = best?.cumulative_return as number;
    if (
      !best ||
      r > b ||
      (r === b && (p.opened_at < best.opened_at || (p.opened_at === best.opened_at && p.id < best.id)))
    ) {
      best = p;
    }
  }
  return best;
};

// 4.6: the highest active cumulative return. The 20% threshold of 9.5 does
// not apply here, by rule.
export const bestPortfolioGain = (portfolios: PortfolioSummary[]): CardValue<number> => {
  const active = activeOnly(portfolios);
  if (active.length < MIN_ACTIVE_PORTFOLIOS_FOR_PLAYER_STATS) return locked("requires_min_active_portfolios");
  const best = highestActive(active);
  if (best === "missing") return unavailable("missing_data");
  return available(best!.cumulative_return as number);
};

export interface TopPortfolio {
  id: number;
  name: string;
  cumulative_return: number;
}

// 9.5 and 9.6 as one value, so the name and the return always refer to the
// same portfolio and lock and unlock together. Shown only above 20%, and
// with no minimum number of portfolios.
export const topPortfolio = (portfolios: PortfolioSummary[]): CardValue<TopPortfolio> => {
  const best = highestActive(activeOnly(portfolios));
  if (best === "missing") return unavailable("missing_data");
  if (!best || !((best.cumulative_return as number) > TOP_PORTFOLIO_MIN_RETURN)) {
    return locked("no_active_portfolio_above_threshold");
  }
  return available({ id: best.id, name: best.name, cumulative_return: best.cumulative_return as number });
};

// 9.4: simple mean of active portfolios' month-to-date returns, equally
// weighted. The spec states no minimum number of portfolios for this one.
export const averageMonthToDateReturn = (portfolios: PortfolioSummary[]): CardValue<number> => {
  const active = activeOnly(portfolios);
  if (active.length === 0) return unavailable("no_active_portfolios");
  const returns = active.map((p) => p.month_to_date_return);
  if (returns.some((r) => r === null)) return unavailable("missing_data");
  return available(mean(returns as number[]));
};

// One portfolio's return since the start of `month` ("2026-10"), measured
// from the last value before the month began - or from opening, for a
// portfolio opened during the month - to the latest value in it. Flows are
// excluded as everywhere else.
//
// Months are Israel calendar months (MONTH_TIME_ZONE), so the series must be
// dated with localDate() and the current month taken from localMonth(), both
// in calendar.ts; dates in any other zone would put values near midnight in
// the wrong month. A month
// with no value yet after its baseline has a return of 0. null for a series
// with nothing in or before the month.
export const monthToDateReturn = (series: NavPoint[], month: string): number | null => {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new RangeError(`Month must look like "2026-10"; got ${month}`);
  const monthStart = `${month}-01`;

  const before = series.filter((p) => p.date < monthStart);
  const during = series.filter((p) => p.date.slice(0, 7) === month);

  const window = before.length > 0 ? [before[before.length - 1], ...during] : during;
  if (window.length === 0) return null;
  if (window.length === 1) return 0;
  return totalReturn(window);
};

// ---- Competitions (8) --------------------------------------------------------

export interface CompetitionEntry {
  competition_id: string | number;
  /** Placings and prizes count only once the results are confirmed. */
  results_confirmed: boolean;
  /** 1 = first. null while the competition is running. */
  final_rank: number | null;
  won_prize: boolean;
}

export interface CompetitionStats {
  participations: number;
  prize_wins: number;
  top_3: number;
  first_place: number;
}

// Each competition counts once, even if the player entered it more than once
// (with several portfolios, say): a competition counts towards a figure when
// any of the player's confirmed entries in it qualifies. Top 3 includes first
// place. A prize win is separate from placing, by rule.
export const competitionStats = (entries: CompetitionEntry[]): CompetitionStats => {
  const all = new Set<string | number>();
  const wins = new Set<string | number>();
  const top3 = new Set<string | number>();
  const firsts = new Set<string | number>();

  for (const e of entries) {
    if (e.final_rank !== null && !(Number.isInteger(e.final_rank) && e.final_rank >= 1)) {
      throw new RangeError(`final_rank must be a whole number from 1; got ${e.final_rank}`);
    }
    all.add(e.competition_id);
    if (!e.results_confirmed) continue;
    if (e.won_prize) wins.add(e.competition_id);
    if (e.final_rank !== null && e.final_rank <= 3) top3.add(e.competition_id);
    if (e.final_rank === 1) firsts.add(e.competition_id);
  }

  return { participations: all.size, prize_wins: wins.size, top_3: top3.size, first_place: firsts.size };
};
