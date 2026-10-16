/* ===========================================================================
   Player Card assembly.
   ---------------------------------------------------------------------------
   Turns what the database holds about a player into the card the frontend
   renders (StockTrack-frontend src/api/playerCard.ts). Pure: the controller
   loads the rows and passes in the time, so this can be tested without a
   database.

   Every figure is real or says why it is not:

   - Portfolio counts and returns are real. Returns come from the shared
     valuation (portfolioController's valuePortfolio), the same one the
     leaderboard ranks by, so the two can never disagree. No game capital
     exists yet, so that simple return equals the flow-adjusted return the
     spec requires; once rewards are credited, this must switch to the
     metric engine's NAV-based return.
   - The averages, best portfolio and top portfolio, with their locks, come
     from the metric engine (src/metrics/player.ts).
   - Month-to-date return needs each portfolio's value at the start of the
     month, which nothing records yet, so it is unavailable.
   - Level, XP and titles are unavailable as not_defined: the XP rules are
     deliberately not written yet, and inventing them is forbidden.
   - Followers, subscribers, medals, achievements and competitions are zero,
     which is true: none of those systems exists yet, so nobody has any.
   =========================================================================== */

import {
  averageActiveReturn,
  averageMonthToDateReturn,
  bestPortfolioGain,
  CardValue,
  competitionStats,
  CompetitionStats,
  portfolioCounts,
  PortfolioSummary,
  topPortfolio,
  TopPortfolio,
} from "../metrics";

export const PLAYER_CARD_MODEL = "player_card_model_v1";

export interface PlayerRow {
  nickname: string | null;
  first_name: string | null;
  avatar_url: string | null;
  bio: string;
}

export interface PortfolioRow {
  id: number;
  name: string;
  status: "active" | "closed";
  created_at: Date | string;
  /** Percent, as valuePortfolio returns it: 12.5 means +12.5%. */
  return_pct: number;
}

export interface Progression {
  level: number;
  title: string;
  xp: number;
  next_level_xp: number;
  next_level: number;
  next_title: string;
}

// Awards will have this shape once the banks exist; there are none yet.
export interface Award {
  id: string;
  art: string;
  name: { he: string; en: string };
  description: { he: string; en: string };
  condition: { he: string; en: string };
  rank: number;
  xp: number;
  earned_at: string;
}

export interface PlayerCard {
  model: string;
  calculated_at: string;
  player: PlayerRow;
  progression: CardValue<Progression>;
  social: { followers: number; subscribers: number };
  stats: {
    portfolios_total: number;
    portfolios_active: number;
    average_active_return: CardValue<number>;
    best_portfolio_gain: CardValue<number>;
    top_portfolio: CardValue<TopPortfolio>;
    average_month_to_date_return: CardValue<number>;
  };
  competitions: { participations: number; prize_wins: number; top_3: number; first_place: number };
  medals: { total: number; top: Award[] };
  achievements: { total: number; top: Award[] };
}

const toSummary = (p: PortfolioRow): PortfolioSummary => ({
  id: p.id,
  name: p.name,
  status: p.status,
  opened_at: new Date(p.created_at).toISOString(),
  cumulative_return: Number.isFinite(p.return_pct) ? p.return_pct / 100 : null,
  month_to_date_return: null, // needs NAV history, which nothing records yet
});

const competitionsOf = (s: CompetitionStats) => ({
  participations: s.participations,
  prize_wins: s.prize_wins,
  top_3: s.top_3,
  first_place: s.first_place,
});

export const buildPlayerCard = (player: PlayerRow, portfolios: PortfolioRow[], calculatedAt: Date): PlayerCard => {
  const summaries = portfolios.map(toSummary);
  const counts = portfolioCounts(summaries);
  return {
    model: PLAYER_CARD_MODEL,
    calculated_at: calculatedAt.toISOString(),
    player: {
      nickname: player.nickname,
      first_name: player.first_name,
      avatar_url: player.avatar_url,
      bio: player.bio,
    },
    progression: { state: "unavailable", reason: "not_defined" },
    social: { followers: 0, subscribers: 0 },
    stats: {
      portfolios_total: counts.total,
      portfolios_active: counts.active,
      average_active_return: averageActiveReturn(summaries),
      best_portfolio_gain: bestPortfolioGain(summaries),
      top_portfolio: topPortfolio(summaries),
      average_month_to_date_return: averageMonthToDateReturn(summaries),
    },
    competitions: competitionsOf(competitionStats([])),
    medals: { total: 0, top: [] },
    achievements: { total: 0, top: [] },
  };
};
