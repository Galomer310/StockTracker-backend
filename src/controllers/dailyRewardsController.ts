import { RequestHandler } from "express";
import { acknowledgeToday, checkIn, history, redeem, RewardsError, rewardsView } from "../rewards/service";

/* ===========================================================================
   Daily rewards (src/rewards). Every route is the signed-in player's own.
   =========================================================================== */

// POST /players/me/daily-rewards/check-in
// The app calls this whenever a signed-in player opens it. The first call on
// a calendar date counts the day; every other call that day changes nothing.
// Answers with the dashboard either way.
export const postCheckIn: RequestHandler = async (req, res, next) => {
  const userId = (req as any).user.id;
  try {
    const result = await checkIn(userId);
    res.json({ counted: result.counted, ...(await rewardsView(userId)) });
  } catch (error) {
    next(error);
  }
};

// GET /players/me/daily-rewards
export const getDailyRewards: RequestHandler = async (req, res, next) => {
  try {
    res.json(await rewardsView((req as any).user.id));
  } catch (error) {
    next(error);
  }
};

// POST /players/me/daily-rewards/acknowledge - today's notice has been shown.
export const postAcknowledge: RequestHandler = async (req, res, next) => {
  try {
    await acknowledgeToday((req as any).user.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
};

// POST /players/me/daily-rewards/:rewardId/redeem  { portfolio_id }
// Applies one pending capital reward to one of the player's portfolios.
export const postRedeem: RequestHandler = async (req, res, next) => {
  const userId = (req as any).user.id;
  const rewardId = Number(req.params.rewardId);
  const portfolioId = Number(req.body?.portfolio_id);
  if (!Number.isInteger(rewardId) || !Number.isInteger(portfolioId)) {
    res.status(400).json({ error: "Send the reward in the path and portfolio_id in the body.", code: "INVALID_REQUEST" });
    return;
  }
  try {
    res.json(await redeem(userId, rewardId, portfolioId));
  } catch (error) {
    if (error instanceof RewardsError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    next(error);
  }
};

// GET /players/me/daily-rewards/history
export const getHistory: RequestHandler = async (req, res, next) => {
  try {
    res.json(await history((req as any).user.id));
  } catch (error) {
    next(error);
  }
};
