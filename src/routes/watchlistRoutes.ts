import express from "express";                 // Import express
import { getWatchlist, addToWatchlist, sellHolding, removeFromWatchlist } from "../controllers/watchlistController"; // Import controllers for watchlist actions
import { authenticateUser } from "../middleware/authMiddleware"; // Import authentication middleware
import { watchlistLimiter, stockApiLimiter } from "../middleware/rateLimiter"; // Per-user limits

const router = express.Router();               // Create a new router instance

// authenticateUser runs first so the limiter can key on the user id.
router.use(authenticateUser, watchlistLimiter);

// GET route: fetch the authenticated user's holdings
router.get("/", getWatchlist);

// POST route: record a buy.
//
// This is the one portfolio route that can spend Alpha Vantage budget: an
// uncached symbol costs a live quote. It therefore also carries the market
// data limiter, so a user's total spend is capped across /stocks and
// /watchlist together instead of being bypassable through this route.
router.post("/", stockApiLimiter, addToWatchlist);

// POST route: sell all or part of a holding, recording the trade and its note.
// Distinct from DELETE, which removes a mistyped row without logging a trade.
router.post("/:id/sell", sellHolding);

// DELETE route: take back a buy, within 60 seconds of making it.
//
// There is no PUT. A recorded trade cannot be edited: the only ways to change
// a position are to buy more or to sell, both of which are logged publicly.
router.delete("/:id", removeFromWatchlist);

export default router;                         // Export the router
