import express from "express";                 // Import express
import { listPortfolios, createPortfolio } from "../controllers/portfolioController";
import { authenticateUser } from "../middleware/authMiddleware"; // Authentication middleware
import { watchlistLimiter } from "../middleware/rateLimiter";    // Per-user limit

const router = express.Router();               // Create a new router instance

// These are the caller's own portfolios, so a valid token is required.
// authenticateUser runs first so the limiter can key on the user id.
router.use(authenticateUser, watchlistLimiter);

// GET /portfolios - every portfolio the caller owns, valued
router.get("/", listPortfolios);

// POST /portfolios - open a new one, up to the account's limit
router.post("/", createPortfolio);

// There is no delete route yet. Deleting a portfolio would erase its trade
// history from the public record, which is the one thing the removal window on
// a single buy exists to prevent - so it needs a rule of its own first.

export default router;                         // Export the router
