import { Request, Response } from "express";   // Express types
import pool from "../config/db";                 // Shared PostgreSQL pool (SSL configured for Neon)
import { getCached, getCachedStale, setCached } from "../utils/cache";
import { getMarketStatus as computeMarketStatus } from "../services/marketClock";
import {
  fetchQuote,
  fetchDailyBars,
  fetchIntradayBars,
  fetchOverview,
  fetchNews,
  searchSymbols,
  getQuotaStatus,
  QuotaExhaustedError,
  UpstreamThrottledError,
  UpstreamUnavailableError,
  UpstreamDataError,
  MAX_HISTORY_DAYS,
  Bar,
} from "../services/massive";

/* ===========================================================================
   Market data endpoints, backed by Massive.
   ---------------------------------------------------------------------------
   The free plan allows 5 requests per minute and only moves once a day, at
   the close, so caching here is not an optimisation, it is what makes the app
   usable. Three layers, cheapest first:

     1. the `stocks` table    - survives restarts, 24h, drives the leaderboard
     2. the in-memory cache   - per-endpoint TTLs
     3. a stale cache read    - when the minute's budget is gone, last known
                                beats none

   Responses carry X-Cache (HIT/MISS/STALE) and X-Quota-Remaining so the
   client, and you, can see exactly where a number came from.
   =========================================================================== */

// Reference data barely changes; prices change daily. TTLs reflect that, and
// are long because the budget is small.
const TTL = {
  quote: 60 * 60 * 1000,            // 1 hour
  bars: 12 * 60 * 60 * 1000,        // 12 hours
  intraday: 30 * 60 * 1000,         // 30 minutes - moves during the session
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

// Upstream fetches currently running, by cache key. The stock page asks for
// the profile and the chart at the same moment, and both need the same bars;
// without this they would spend two of the minute's five requests on one copy.
const inflight = new Map<string, Promise<unknown>>();

const fetchOnce = <T>(key: string, fetcher: () => Promise<T>): Promise<T> => {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const started = fetcher().finally(() => inflight.delete(key));
  inflight.set(key, started);
  return started;
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
    const value = await fetchOnce(key, fetcher);
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
            ? "Market data is busy: the current plan allows 5 requests a minute. Please try again in a minute."
            : "Market data provider is throttling requests. Please try again shortly.",
        quota: getQuotaStatus(),
      });
      return null;
    }

    // Premium-gated endpoint: say so plainly instead of suggesting a retry.
    if (error instanceof UpstreamUnavailableError) {
      res.status(501).json({
        error:
          "This data is not available on the current market data plan.",
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
// Derived from the clock, so it costs nothing against the request budget.
export const getMarketStatus = async (_req: Request, res: Response): Promise<void> => {
  send(res, computeMarketStatus(), "HIT");
};

// GET /stocks/quota
// How much of this minute's request budget is left.
export const getQuota = async (_req: Request, res: Response): Promise<void> => {
  res.json(getQuotaStatus());
};

// Persist a fetched price so the next 24 hours are free, and so the
// leaderboard can value this symbol without any API call at all. Buys read
// it too, so buying from the stock page does not spend a request of its own.
const rememberPrice = async (ticker: string, price: number): Promise<void> => {
  if (!price) return;
  try {
    await pool.query(
      `INSERT INTO stocks (stock_symbol, last_price, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (stock_symbol)
       DO UPDATE SET last_price = $2, updated_at = NOW()`,
      [ticker, price]
    );
  } catch (error) {
    console.error("Error writing stocks cache:", (error as Error).message);
  }
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
  await rememberPrice(ticker, result.value.price);

  send(res, {
    stock_symbol: ticker,
    last_price: result.value.price,
    source: "massive",
  }, result.state);
};

// GET /stocks/:ticker/quote
// Full quote: open/high/low/price/volume/change.
export const getQuoteDetail = async (req: Request, res: Response): Promise<void> => {
  const ticker = String(req.params.ticker || "").toUpperCase();
  const result = await withCache(res, `quote:${ticker}`, TTL.quote, () => fetchQuote(ticker));
  if (!result) return;
  if (result.state === "MISS") await rememberPrice(ticker, result.value.price);
  send(res, result.value, result.state);
};

// Two years of daily bars, shared by the charts and the 52-week range. One
// request returns the whole span, so every range is cut from this one copy.
const barsKey = (ticker: string) => `bars:${ticker}`;
const fetchAllBars = (ticker: string) => fetchDailyBars(ticker, MAX_HISTORY_DAYS);

// GET /stocks/:ticker/details
// Company profile. The plan has no fundamentals, so the 52-week range is
// worked out from the daily bars, which the chart on the same page needs too.
export const getTickerDetails = async (req: Request, res: Response): Promise<void> => {
  const ticker = String(req.params.ticker || "").toUpperCase();
  const result = await withCache(res, `overview:${ticker}`, TTL.overview, () =>
    fetchOverview(ticker)
  );
  if (!result) return;

  // Best effort: a missing range should not cost the user the whole profile.
  let bars = getCached<Bar[]>(barsKey(ticker));
  if (!bars) {
    try {
      bars = await fetchOnce(barsKey(ticker), () => fetchAllBars(ticker));
      setCached(barsKey(ticker), bars, TTL.bars);
    } catch {
      bars = getCachedStale<Bar[]>(barsKey(ticker))?.value;
    }
  }
  const lastYear = (bars ?? []).filter((bar) => bar.t >= Date.now() - 365 * 24 * 60 * 60 * 1000);
  const overview = { ...result.value };
  if (lastYear.length > 0) {
    overview.week52_high = Math.max(...lastYear.map((bar) => bar.h));
    overview.week52_low = Math.min(...lastYear.map((bar) => bar.l));
  }
  send(res, overview, result.state);
};

// GET /stocks/:ticker/news
export const getTickerNews = async (req: Request, res: Response): Promise<void> => {
  const ticker = String(req.params.ticker || "").toUpperCase();
  const result = await withCache(res, `news:${ticker}`, TTL.news, () => fetchNews(ticker));
  if (!result) return;
  send(res, { articles: result.value }, result.state);
};

// GET /stocks/:ticker/aggregates?days=30
// Price history in the { t, o, h, l, c, v } shape the charts already consume.
// A one-day range uses intraday bars, since a single daily bar would render as
// one point; everything longer uses daily bars.
export const getAggregates = async (req: Request, res: Response): Promise<void> => {
  const ticker = String(req.params.ticker || "").toUpperCase();
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), MAX_HISTORY_DAYS);

  // Intraday bars are not on the free Massive plan, so they are off unless the
  // account has been upgraded. Without them a 1-day request falls through to
  // daily bars below, which is the most the free plan can give.
  if (days <= 1 && process.env.MASSIVE_INTRADAY === "true") {
    const result = await withCache(res, `intraday:${ticker}`, TTL.intraday, () =>
      fetchIntradayBars(ticker, 5)
    );
    if (!result) return;
    send(res, { bars: result.value, interval: "5min" }, result.state);
    return;
  }

  const result = await withCache(res, barsKey(ticker), TTL.bars, () => fetchAllBars(ticker));
  if (!result) return;

  // Trim the shared two-year copy down to exactly what was asked for.
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  send(res, { bars: result.value.filter((bar) => bar.t >= cutoff), interval: "1day" }, result.state);
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
