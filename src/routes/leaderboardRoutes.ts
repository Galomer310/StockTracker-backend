import express from "express";                 // Import express
import { getLeaderboard, getPortfolio, getPortfolioJournal } from "../controllers/leaderboardController";
import { authenticateUser } from "../middleware/authMiddleware"; // Authentication middleware
import { socialLimiter } from "../middleware/rateLimiter";       // Per-user read limit

const router = express.Router();               // Create a new router instance

// These routes expose other people's data, so a valid token is required.
// authenticateUser runs first so the limiter can key on the user id.
router.use(authenticateUser, socialLimiter);

// GET /social/leaderboard - every portfolio ranked by percentage return
router.get("/leaderboard", getLeaderboard);

// The unit is the portfolio, not the account: one user may run three, and each
// is ranked, viewed and compared on its own.

// GET /social/portfolios/:id - one portfolio's holdings and summary.
// Works for your own id too, which the compare view relies on.
router.get("/portfolios/:id", getPortfolio);

// GET /social/portfolios/:id/journal - its recorded trades and reasoning
router.get("/portfolios/:id/journal", getPortfolioJournal);

export default router;                         // Export the router
