import { Request, Response } from "express";   // Express types
import pool from "../config/db";                 // Shared PostgreSQL pool (SSL configured for Neon)
import { getCached, getCachedStale, setCached } from "../utils/cache";
import { getMarketStatus as computeMarketStatus } from "../services/marketClock";
import {
  fetchQuote,
  fetchDailyBars,
  fetchOverview,
  fetchNews,
  searchSymbols,
  getQuotaStatus,
  QuotaExhaustedError,
  UpstreamThrottledError,
  UpstreamDataError,
} from "../services/alphaVantage";

/* ===========================================================================
   Market data endpoints, backed by Alpha Vantage.
   ---------------------------------------------------------------------------
   The free tier allows 25 requests per day, so caching here is not an
   optimisation, it is what makes the app usable. Three layers, cheapest first:

     1. the `stocks` table    - survives restarts, 24h, drives the leaderboard
     2. the in-memory cache   - per-endpoint TTLs
     3. a stale cache read    - when the budget is gone, last known beats none

   Responses carry X-Cache (HIT/MISS/STALE) and X-Quota-Remaining so the
   client, and you, can see exactly where a number came from.
   =========================================================================== */

// Reference data barely changes; prices change daily. TTLs reflect that, and
// are long because the budget is tiny.
const TTL = {
  quote: 60 * 60 * 1000,            // 1 hour
  bars: 12 * 60 * 60 * 1000,        // 12 hours
  overview: 7 * 24 * 60 * 60 * 1000, // 7 days
  news: 6 * 60 * 60 * 1000,         // 6 hours
  search: 24 * 60 * 60 * 1000,      // 24 hours
};

// Attach cache and quota headers, then send.
const send = (
  res: Response,
  payload: unknown,
  cacheState: "HIT" | "MISS" | "STALE",
  extra: Record<string, string> = {}
) => {
  res.setHeader("X-Cache", cacheState);
  res.setHeader("X-Quota-Remaining", String(getQuotaStatus().remaining));
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.json(payload);
};

/**
 * Serve `key` from cache, otherwise fetch it. If the fetch fails because the
 * daily budget is gone or the API throttled us, fall back to the stale copy
 * rather than failing outright - a price from this morning is still useful.
 */
const withCache = async <T>(
  res: Response,
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<{ value: T; state: "HIT" | "MISS" | "STALE" } | null> => {
  const hit = getCached<T>(key);
  if (hit !== undefined) return { value: hit, state: "HIT" };

  try {
    const value = await fetcher();
    setCached(key, value, ttlMs);
    return { value, state: "MISS" };
  } catch (error) {
    const isBudget =
      error instanceof QuotaExhaustedError || error instanceof UpstreamThrottledError;

    if (isBudget) {
      const stale = getCachedStale<T>(key);
      if (stale) {
        res.setHeader("X-Stale-Age-Seconds", String(Math.round(stale.age / 1000)));
        return { value: stale.value, state: "STALE" };
      }
      res.status(429).json({
        error:
          error instanceof QuotaExhaustedError
            ? "Daily market data limit reached. Alpha Vantage allows 25 requests per day on the free plan; it resets at midnight UTC."
            : "Market data provider is throttling requests. Please try again shortly.",
        quota: getQuotaStatus(),
      });
      return null;
    }

    if (error instanceof UpstreamDataError) {
      res.status(404).json({ error: (error as Error).message });
      return null;
    }

    console.error("Market data error:", (error as Error).message);
    res.status(502).json({ error: "Failed to fetch market data" });
    return null;
  }
};

// GET /stocks/market-status
// Derived from the clock, so it costs nothing against the daily budget.
export const getMarketStatus = async (_req: Request, res: Response): Promise<void> => {
  send(res, computeMarketStatus(), "HIT");
};

// GET /stocks/quota
// How much of today's request budget is left.
export const getQuota = async (_req: Request, res: Response): Promise<void> => {
  res.json(getQuotaStatus());
};

// GET /stocks/:ticker
// Latest close for one symbol, backed by the 24h `stocks` table so the
// leaderboard and watchlist can value portfolios without spending budget.
export const getStockData = async (req: Request, res: Response): Promise<void> => {
  const ticker = String(req.params.ticker || "").toUpperCase();
  if (!ticker) {
    res.status(400).json({ error: "Stock ticker is required" });
    return;
  }

  try {
    const cached = await pool.query(
      "SELECT last_price FROM stocks WHERE stock_symbol = $1 AND updated_at > NOW() - INTERVAL '24 hours'",
      [ticker]
    );
    if (cached.rows.length > 0) {
      send(res, {
        stock_symbol: ticker,
        last_price: cached.rows[0].last_price,
        source: "cache",
      }, "HIT");
      return;
    }
  } catch (error) {
    console.error("Error reading stocks cache:", (error as Error).message);
  }

  const result = await withCache(res, `quote:${ticker}`, TTL.quote, () => fetchQuote(ticker));
  if (!result) return;

  // Persist so the next 24 hours are free, and so the leaderboard can value
  // this symbol without any API call at all.
  try {
    await pool.query(
      `INSERT INTO stocks (stock_symbol, last_price, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (stock_symbol)
       DO UPDATE SET last_price = $2, updated_at = NOW()`,
      [ticker, result.value.price]
    );
  } catch (error) {
    console.error("Error writing stocks cache:", (error as Error).message);
  }

  send(res, {
    stock_symbol: ticker,
    last_price: result.value.price,
    source: "alphavantage",
  }, result.state);
};

// GET /stocks/:ticker/quote
// Full quote: open/high/low/price/volume/change.
export const getQuoteDetail = async (req: Request, res: Response): Promise<void> => {
  const ticker = String(req.params.ticker || "").toUpperCase();
  const result = await withCache(res, `quote:${ticker}`, TTL.quote, () => fetchQuote(ticker));
  if (!result) return;
  send(res, result.value, result.state);
};

// GET /stocks/:ticker/details
// Company fundamentals. Replaces the two separate Polygon reference calls.
export const getTickerDetails = async (req: Request, res: Response): Promise<void> => {
  const ticker = String(req.params.ticker || "").toUpperCase();
  const result = await withCache(res, `overview:${ticker}`, TTL.overview, () =>
    fetchOverview(ticker)
  );
  if (!result) return;
  send(res, result.value, result.state);
};

// GET /stocks/:ticker/news
export const getTickerNews = async (req: Request, res: Response): Promise<void> => {
  const ticker = String(req.params.ticker || "").toUpperCase();
  const result = await withCache(res, `news:${ticker}`, TTL.news, () => fetchNews(ticker));
  if (!result) return;
  send(res, { articles: result.value }, result.state);
};

// GET /stocks/:ticker/aggregates?days=30
// Historical daily bars. Kept in the { t, o, h, l, c, v } shape the charts
// already consume, so the client charting code is unchanged.
export const getAggregates = async (req: Request, res: Response): Promise<void> => {
  const ticker = String(req.params.ticker || "").toUpperCase();
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 730);

  // Bucket the cache key so 30d and 90d do not thrash one another.
  const bucket = days <= 7 ? "7" : days <= 30 ? "30" : days <= 90 ? "90" : days <= 365 ? "365" : "730";

  const result = await withCache(res, `bars:${ticker}:${bucket}`, TTL.bars, () =>
    fetchDailyBars(ticker, Number(bucket))
  );
  if (!result) return;

  // Trim the cached bucket down to exactly what was asked for.
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  send(res, { bars: result.value.filter((bar) => bar.t >= cutoff) }, result.state);
};

// GET /stocks/search?keywords=micro
// Ticker lookup by free text.
export const getSymbolSearch = async (req: Request, res: Response): Promise<void> => {
  const keywords = String(req.query.keywords || "").trim();
  if (!keywords) {
    res.status(400).json({ error: "keywords query parameter is required" });
    return;
  }
  const result = await withCache(res, `search:${keywords.toLowerCase()}`, TTL.search, () =>
    searchSymbols(keywords)
  );
  if (!result) return;
  send(res, { matches: result.value }, result.state);
};
