/* ===========================================================================
   Portfolio rules.
   ---------------------------------------------------------------------------
   The two numbers that define how the game is played, kept in one place so the
   tier work later changes this file and nothing else.
   =========================================================================== */

// Cash every new portfolio opens with. Fixed and identical for everyone: the
// leaderboard ranks percentage returns, and that only compares like with like
// if every book starts from the same line.
export const STARTING_CASH = 10000;

// How many portfolios one account may hold.
//
// This will become a per-tier lookup (free: 3, paid: more). It is a function
// already so that the call sites do not have to change when it does - they ask
// "how many may this user have", not "what is the constant".
export const FREE_TIER_PORTFOLIO_LIMIT = 3;

export const portfolioLimitFor = (_userId: number): number =>
  FREE_TIER_PORTFOLIO_LIMIT; // TODO: look up the account's tier

// Name rules. A name is what identifies a portfolio in the switcher, on the
// leaderboard and on every feed post, so it has to be short and present.
export const MAX_PORTFOLIO_NAME_LENGTH = 40;
