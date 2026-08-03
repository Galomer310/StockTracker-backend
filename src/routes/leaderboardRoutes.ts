import express from "express";                 // Import express
import { getLeaderboard, getUserPortfolio } from "../controllers/leaderboardController";
import { authenticateUser } from "../middleware/authMiddleware"; // Authentication middleware

const router = express.Router();               // Create a new router instance

// Both routes expose other people's data, so a valid token is required.
router.use(authenticateUser);

// GET /social/leaderboard - every account ranked by percentage return
router.get("/leaderboard", getLeaderboard);

// GET /social/users/:id/portfolio - one account's holdings and summary.
// Works for your own id too, which the compare view relies on.
router.get("/users/:id/portfolio", getUserPortfolio);

export default router;                         // Export the router
