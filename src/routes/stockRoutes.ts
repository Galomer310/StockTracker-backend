import express from "express";                 // Import express
import {
  getMarketStatus,
  getQuota,
  getStockData,
  getQuoteDetail,
  getTickerDetails,
  getTickerNews,
  getAggregates,
  getSymbolSearch,
} from "../controllers/stockController";       // Import the stock controllers
import { authenticateUser } from "../middleware/authMiddleware"; // Import authentication middleware
import { stockApiLimiter } from "../middleware/rateLimiter";     // Per-user rate limit for market data

const router = express.Router();               // Create a new router instance

// Every route below spends the Massive request budget (5 a minute on the
// free plan), so all of them require a valid token - otherwise the proxy would
// be an open relay for an allowance that runs out in seconds.
//
// authenticateUser runs first so the limiter can key on the user id, then
// stockApiLimiter caps each user. The market data client adds a hard
// per-minute budget and serialises upstream calls on top of that.
router.use(authenticateUser, stockApiLimiter);

// Fixed paths must come before "/:ticker", or they would be read as tickers.

// Market open/closed, derived from the clock - costs nothing upstream
router.get("/market-status", getMarketStatus);

// How much of this minute's request budget remains
router.get("/quota", getQuota);

// Ticker lookup by free text (e.g. GET /stocks/search?keywords=micro)
router.get("/search", getSymbolSearch);

// Latest close, served from the 24h `stocks` table where possible
router.get("/:ticker", getStockData);

// Full quote: open/high/low/price/volume/change
router.get("/:ticker/quote", getQuoteDetail);

// Company profile: name, industry, description, market cap, 52-week range
router.get("/:ticker/details", getTickerDetails);

// Recent news articles mentioning the ticker
router.get("/:ticker/news", getTickerNews);

// Historical daily bars; accepts ?days=30
router.get("/:ticker/aggregates", getAggregates);

export default router;                         // Export the router
