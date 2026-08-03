import { Request, Response } from "express";   // Import Express types for Request and Response
import axios from "axios";                       // Import axios for making HTTP requests
import dotenv from "dotenv";                     // Import dotenv for environment variables
import pool from "../config/db";                 // Shared PostgreSQL pool (configured with SSL for Neon)
import { getCached, setCached } from "../utils/cache"; // In-memory TTL cache for upstream responses

dotenv.config();                                 // Load environment variables

// Retrieve the Polygon API key from environment variables. This key stays on the
// server: the browser never sees it and reaches Polygon only through the proxy
// handlers below.
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
const POLYGON_BASE_URL = "https://api.polygon.io";

// Perform a GET against Polygon with the server-side key attached as a query
// parameter. Passing params via axios (rather than string interpolation) keeps
// the key out of the interpolated path we build and log.
const polygonGet = async (path: string, params: Record<string, string> = {}) => {
    const response = await axios.get(`${POLYGON_BASE_URL}${path}`, {
        params: { ...params, apiKey: POLYGON_API_KEY as string },
    });
    return response.data;
};

// How long each kind of response stays fresh. Reference data barely moves, so
// it is held far longer than prices; market status is polled once a minute by
// the client, so a 60s TTL collapses that to one upstream call per minute
// regardless of how many users are watching.
const TTL = {
  marketStatus: 60 * 1000,             // 1 minute
  previousClose: 60 * 60 * 1000,       // 1 hour — the previous close is fixed until the next one
  tickerDetails: 24 * 60 * 60 * 1000,  // 24 hours
  companyInfo: 24 * 60 * 60 * 1000,    // 24 hours
  news: 15 * 60 * 1000,                // 15 minutes
  aggregates: 60 * 60 * 1000,          // 1 hour
};

// Fetch from Polygon via the cache. Returns the payload plus whether it was
// served from cache, so handlers can surface that as an X-Cache header.
const cachedPolygonGet = async (
    cacheKey: string,
    path: string,
    params: Record<string, string>,
    ttlMs: number
): Promise<{ data: any; cached: boolean }> => {
    const hit = getCached<any>(cacheKey);
    if (hit !== undefined) {
        return { data: hit, cached: true };
    }
    const data = await polygonGet(path, params);
    setCached(cacheKey, data, ttlMs);
    return { data, cached: false };
};

// Send a proxied payload, tagging whether it came from the cache.
const sendProxied = (res: Response, result: { data: any; cached: boolean }): void => {
    res.setHeader("X-Cache", result.cached ? "HIT" : "MISS");
    res.json(result.data);
};

// Encode a value for safe use as a single URL path segment. Without this a
// crafted ticker such as "../../v3/reference/..." could steer the proxied
// request at an arbitrary Polygon endpoint using our key.
const seg = (value: unknown): string => encodeURIComponent(String(value));

// Translate an upstream failure into a response for our client. Client-side
// errors from Polygon (404 for an unknown ticker, 429 for rate limiting) are
// forwarded as-is; anything else is reported as a bad gateway.
const handleProxyError = (res: Response, error: any, context: string): void => {
    const status = error.response?.status;
    console.error(`Error fetching ${context}:`, error.message);
    if (status && status >= 400 && status < 500) {
        res.status(status).json({ error: `Upstream error fetching ${context}` });
        return;
    }
    res.status(502).json({ error: `Failed to fetch ${context}` });
};

// Guard used by every handler: without a key there is nothing we can proxy.
const missingApiKey = (res: Response): boolean => {
    if (!POLYGON_API_KEY) {
        console.error("POLYGON_API_KEY is not configured");
        res.status(500).json({ error: "Market data is not configured" });
        return true;
    }
    return false;
};

// GET MARKET STATUS CONTROLLER
// Proxies Polygon's current market status (used to warn that prices are stale).
export const getMarketStatus = async (_req: Request, res: Response): Promise<void> => {
    if (missingApiKey(res)) return;
    try {
        const result = await cachedPolygonGet(
            "market-status",
            "/v1/marketstatus/now",
            {},
            TTL.marketStatus
        );
        sendProxied(res, result);
    } catch (error: any) {
        handleProxyError(res, error, "market status");
    }
};

// GET STOCK DATA CONTROLLER
// Returns the last known close for a ticker, cached in Postgres for 24 hours.
export const getStockData = async (req: Request, res: Response): Promise<void> => {
    const { ticker } = req.params;              // Extract the ticker from URL parameters
    if (!ticker) {                              // If no ticker is provided, send a 400 error response
        res.status(400).json({ error: "Stock ticker is required" });
        return;
    }
    if (missingApiKey(res)) return;
    try {
        // Check if stock data exists in the database and is recent (updated within the last 24 hours)
        const stockResult = await pool.query(
            "SELECT * FROM stocks WHERE stock_symbol = $1 AND updated_at > NOW() - INTERVAL '24 hours'",
            [ticker]
        );
        if (stockResult.rows.length > 0) {
            // Return cached stock data from the database
            res.json({
              stock_symbol: ticker,
              last_price: stockResult.rows[0].last_price,
              source: "cache"
            });
            return;
        }
        // If no recent data is found, fetch fresh data from Polygon.io
        const data = await polygonGet(`/v2/aggs/ticker/${seg(ticker)}/prev`, { adjusted: "true" });
        // Extract the last price from the response data
        const lastPrice = data.results?.[0]?.c;
        if (!lastPrice) throw new Error("Invalid stock data"); // Throw an error if last price is missing

        // Update the database with the newly fetched stock data using an upsert
        await pool.query(
            "INSERT INTO stocks (stock_symbol, last_price, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (stock_symbol) DO UPDATE SET last_price = $2, updated_at = NOW()",
            [ticker, lastPrice]
        );
        // Return the fresh stock data with a source indicating it came from Polygon.io
        res.json({ stock_symbol: ticker, last_price: lastPrice, source: "polygon.io" });
    } catch (error: any) {
        handleProxyError(res, error, "stock data");
    }
};

// GET PREVIOUS CLOSE CONTROLLER
// Pass-through of the previous-day aggregate bar (open/high/low/close/volume).
export const getPreviousClose = async (req: Request, res: Response): Promise<void> => {
    const { ticker } = req.params;
    if (missingApiKey(res)) return;
    try {
        const result = await cachedPolygonGet(
            `prev:${ticker}`,
            `/v2/aggs/ticker/${seg(ticker)}/prev`,
            { adjusted: "true" },
            TTL.previousClose
        );
        sendProxied(res, result);
    } catch (error: any) {
        handleProxyError(res, error, "previous close");
    }
};

// GET TICKER DETAILS CONTROLLER
// Pass-through of Polygon's ticker reference data (name, sic_description, branding).
export const getTickerDetails = async (req: Request, res: Response): Promise<void> => {
    const { ticker } = req.params;
    if (missingApiKey(res)) return;
    try {
        const result = await cachedPolygonGet(
            `details:${ticker}`,
            `/v3/reference/tickers/${seg(ticker)}`,
            {},
            TTL.tickerDetails
        );
        sendProxied(res, result);
    } catch (error: any) {
        handleProxyError(res, error, "ticker details");
    }
};

// GET COMPANY INFO CONTROLLER
// Pass-through of Polygon's legacy company metadata endpoint (CEO, employees).
// Note: this is a deprecated v1 endpoint and may 404 on current Polygon plans.
export const getCompanyInfo = async (req: Request, res: Response): Promise<void> => {
    const { ticker } = req.params;
    if (missingApiKey(res)) return;
    try {
        const result = await cachedPolygonGet(
            `company:${ticker}`,
            `/v1/meta/symbols/${seg(ticker)}/company`,
            {},
            TTL.companyInfo
        );
        sendProxied(res, result);
    } catch (error: any) {
        handleProxyError(res, error, "company info");
    }
};

// GET TICKER NEWS CONTROLLER
// Pass-through of the latest news articles for a ticker.
export const getTickerNews = async (req: Request, res: Response): Promise<void> => {
    const { ticker } = req.params;
    if (missingApiKey(res)) return;
    try {
        const result = await cachedPolygonGet(
            `news:${ticker}`,
            "/v2/reference/news",
            { ticker: String(ticker) },
            TTL.news
        );
        sendProxied(res, result);
    } catch (error: any) {
        handleProxyError(res, error, "ticker news");
    }
};

// GET AGGREGATES CONTROLLER
// Pass-through of historical aggregate bars for a ticker over a date range.
// Expects multiplier, timespan, from and to as query parameters.
export const getAggregates = async (req: Request, res: Response): Promise<void> => {
    const { ticker } = req.params;
    const { multiplier, timespan, from, to } = req.query;
    if (!multiplier || !timespan || !from || !to) {
        res.status(400).json({
            error: "multiplier, timespan, from and to query parameters are required",
        });
        return;
    }
    if (missingApiKey(res)) return;
    try {
        const result = await cachedPolygonGet(
            `aggs:${ticker}:${multiplier}:${timespan}:${from}:${to}`,
            `/v2/aggs/ticker/${seg(ticker)}/range/${seg(multiplier)}/${seg(timespan)}/${seg(from)}/${seg(to)}`,
            { adjusted: "true" },
            TTL.aggregates
        );
        sendProxied(res, result);
    } catch (error: any) {
        handleProxyError(res, error, "aggregated data");
    }
};
