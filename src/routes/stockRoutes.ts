import express from "express";                 // Import express
import {
  getMarketStatus,
  getStockData,
  getPreviousClose,
  getTickerDetails,
  getCompanyInfo,
  getTickerNews,
  getAggregates,
} from "../controllers/stockController";       // Import the stock controllers
import { authenticateUser } from "../middleware/authMiddleware"; // Import authentication middleware
import { stockApiLimiter } from "../middleware/rateLimiter";     // Per-user rate limit for market data

const router = express.Router();               // Create a new router instance

// Every route below proxies Polygon.io using the server-side API key, so all of
// them require a valid token — otherwise the proxy would be an open relay for
// our paid market-data quota.
//
// authenticateUser runs first so the limiter can key on the user id, then
// stockApiLimiter caps each user's spend. Responses are additionally cached in
// the controller, so a rate-limited burst mostly never reaches Polygon at all.
router.use(authenticateUser, stockApiLimiter);

// Market status must be declared before "/:ticker", or it would be captured as a ticker
router.get("/market-status", getMarketStatus);

// Cached last close for a ticker (e.g. GET /stocks/AAPL)
router.get("/:ticker", getStockData);

// Full previous-day bar, including volume (e.g. GET /stocks/AAPL/prev)
router.get("/:ticker/prev", getPreviousClose);

// Reference data: company name, industry, branding
router.get("/:ticker/details", getTickerDetails);

// Legacy company metadata: CEO, employee count, description
router.get("/:ticker/company", getCompanyInfo);

// Latest news articles for a ticker
router.get("/:ticker/news", getTickerNews);

// Historical bars; requires multiplier, timespan, from and to query parameters
router.get("/:ticker/aggregates", getAggregates);

export default router;                         // Export the router
