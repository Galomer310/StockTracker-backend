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
   - Level, XP, the active title and game achievements come from the
     progression system (src/progression). XP per level is not decided, so
     with no thresholds configured every player is level 1 and the progress
     figures say so (thresholds_configured) rather than invent a target. If
     progression could not be loaded, it is unavailable as missing_data.
   - Followers are real (table follows). Subscribers, medals and
     competitions are zero, which is true: none of those systems exists yet,
     so nobody has any.
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
import type { LevelProgress } from "../progression/levels";
import type { TitleView } from "../progression/service";

export const PLAYER_CARD_MODEL = "player_card_model_v1";

export interface PlayerRow {
  nickname: string | null;
  first_name: string | null;
  avatar_url: string | null;
  /** A gallery avatar's id (src/services/playerProfile.ts), or null. */
  avatar_id: string | null;
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

export interface Progression extends LevelProgress {
  /** null until the player chooses a title. */
  active_title: TitleView | null;
}

// Medals and game achievements share this shape. Medals do not exist yet.
export interface Award {
  id: string;
  art: string;
  /** Game achievements: their category, colour and rarity. */
  category?: string;
  accent_color?: string;
  rarity?: string;
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

export interface ProgressionInput {
  progress: LevelProgress;
  active_title: TitleView | null;
  achievements: { total: number; top: Award[] };
}

export const buildPlayerCard = (
  player: PlayerRow,
  portfolios: PortfolioRow[],
  calculatedAt: Date,
  progression: ProgressionInput | null = null,
  followers = 0
): PlayerCard => {
  const summaries = portfolios.map(toSummary);
  const counts = portfolioCounts(summaries);
  return {
    model: PLAYER_CARD_MODEL,
    calculated_at: calculatedAt.toISOString(),
    player: {
      nickname: player.nickname,
      first_name: player.first_name,
      avatar_url: player.avatar_url,
      avatar_id: player.avatar_id,
      bio: player.bio,
    },
    progression: progression
      ? { state: "available", value: { ...progression.progress, active_title: progression.active_title } }
      : { state: "unavailable", reason: "missing_data" },
    social: { followers, subscribers: 0 },
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
    achievements: progression?.achievements ?? { total: 0, top: [] },
  };
};
