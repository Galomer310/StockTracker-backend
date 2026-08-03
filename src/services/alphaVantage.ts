import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

/* ===========================================================================
   Alpha Vantage client
   ---------------------------------------------------------------------------
   The free tier allows 25 requests per DAY and roughly 1 per second. That is
   restrictive enough that the budget has to be enforced in code rather than
   hoped for, so every call goes through this module, which:

     1. serialises requests with a minimum gap, so the burst limit is never hit
     2. counts requests against a hard daily budget and refuses to exceed it
     3. detects throttling, which the API reports as HTTP 200 with an
        "Information" or "Note" key rather than a 4xx status

   Point 3 is the subtle one: a naive client checking response.status sees 200
   and then fails to find the data it expected.
   =========================================================================== */

const API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
const BASE_URL = "https://www.alphavantage.co/query";

// Free tier: 25/day. Override with ALPHA_VANTAGE_DAILY_LIMIT on a paid plan.
const DAILY_LIMIT = Number(process.env.ALPHA_VANTAGE_DAILY_LIMIT || 25);

// The documented burst limit is ~1 request/second; 1.2s leaves headroom.
const MIN_REQUEST_GAP_MS = Number(process.env.ALPHA_VANTAGE_MIN_GAP_MS || 1200);

// ---------------------------------------------------------------------------
// Errors, so callers can tell "we ran out of budget" from "the ticker is bad"
// ---------------------------------------------------------------------------
export class QuotaExhaustedError extends Error {
  constructor(message = "Daily market data request budget exhausted") {
    super(message);
    this.name = "QuotaExhaustedError";
  }
}

export class UpstreamThrottledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamThrottledError";
  }
}

export class UpstreamDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamDataError";
  }
}

// ---------------------------------------------------------------------------
// Daily budget
// Alpha Vantage resets the free allowance daily; we track it per UTC date.
// ---------------------------------------------------------------------------
let budgetDate = "";
let requestsUsed = 0;

const utcDateKey = () => new Date().toISOString().slice(0, 10);

const rollBudgetIfNewDay = () => {
  const today = utcDateKey();
  if (today !== budgetDate) {
    budgetDate = today;
    requestsUsed = 0;
  }
};

export const getQuotaStatus = () => {
  rollBudgetIfNewDay();
  return {
    used: requestsUsed,
    limit: DAILY_LIMIT,
    remaining: Math.max(0, DAILY_LIMIT - requestsUsed),
    resets_at: `${utcDateKey()}T24:00:00Z`,
  };
};

// ---------------------------------------------------------------------------
// Serialised request queue
// Requests run one at a time with a minimum gap, so concurrent callers (the
// watchlist fetching several symbols at once) cannot trip the burst limit.
// ---------------------------------------------------------------------------
let queueTail: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
  const run = queueTail.then(async () => {
    const waitFor = lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
    if (waitFor > 0) await sleep(waitFor);
    lastRequestAt = Date.now();
    return task();
  });
  // Keep the chain alive even when a task rejects.
  queueTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
};

// ---------------------------------------------------------------------------
// Core request
// ---------------------------------------------------------------------------
const request = async (params: Record<string, string>): Promise<any> => {
  if (!API_KEY) {
    throw new UpstreamDataError("ALPHA_VANTAGE_API_KEY is not configured");
  }

  rollBudgetIfNewDay();
  if (requestsUsed >= DAILY_LIMIT) {
    throw new QuotaExhaustedError();
  }

  return enqueue(async () => {
    // Re-check inside the queue: earlier queued calls may have used the last slot.
    rollBudgetIfNewDay();
    if (requestsUsed >= DAILY_LIMIT) throw new QuotaExhaustedError();

    requestsUsed += 1;

    const response = await axios.get(BASE_URL, {
      params: { ...params, apikey: API_KEY },
      timeout: 15000,
    });
    const data = response.data;

    // Alpha Vantage signals problems with a 200 and one of these keys.
    if (data && typeof data === "object") {
      if (data["Information"]) throw new UpstreamThrottledError(String(data["Information"]));
      if (data["Note"]) throw new UpstreamThrottledError(String(data["Note"]));
      if (data["Error Message"]) throw new UpstreamDataError(String(data["Error Message"]));
    }

    return data;
  });
};

// ---------------------------------------------------------------------------
// Parsing helpers
// Every numeric value arrives as a string, and quote keys are numbered with
// spaces ("05. price"), so nothing can be destructured normally.
// ---------------------------------------------------------------------------
const num = (value: unknown): number => {
  const parsed = parseFloat(String(value ?? "").replace("%", ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

export interface Quote {
  symbol: string;
  open: number;
  high: number;
  low: number;
  price: number;
  volume: number;
  previous_close: number;
  change: number;
  change_percent: number;
  latest_trading_day: string;
}

// GLOBAL_QUOTE - the current (or most recent close) price for one symbol.
export const fetchQuote = async (symbol: string): Promise<Quote> => {
  const data = await request({ function: "GLOBAL_QUOTE", symbol });
  const q = data?.["Global Quote"];
  if (!q || !q["01. symbol"]) {
    throw new UpstreamDataError(`No quote data returned for ${symbol}`);
  }
  return {
    symbol: q["01. symbol"],
    open: num(q["02. open"]),
    high: num(q["03. high"]),
    low: num(q["04. low"]),
    price: num(q["05. price"]),
    volume: num(q["06. volume"]),
    latest_trading_day: q["07. latest trading day"] ?? "",
    previous_close: num(q["08. previous close"]),
    change: num(q["09. change"]),
    change_percent: num(q["10. change percent"]),
  };
};

export interface Bar {
  t: number; // epoch ms, matching the shape the charts already consume
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

// TIME_SERIES_DAILY - historical bars, newest first in the response.
// Returned oldest-first and trimmed to `days`, which is what a chart wants.
export const fetchDailyBars = async (symbol: string, days: number): Promise<Bar[]> => {
  const data = await request({
    function: "TIME_SERIES_DAILY",
    symbol,
    outputsize: days > 100 ? "full" : "compact", // "full" needs a paid plan
  });
  const series = data?.["Time Series (Daily)"];
  if (!series) throw new UpstreamDataError(`No daily series returned for ${symbol}`);

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return Object.entries(series)
    .map(([date, bar]: [string, any]) => ({
      t: new Date(`${date}T00:00:00Z`).getTime(),
      o: num(bar["1. open"]),
      h: num(bar["2. high"]),
      l: num(bar["3. low"]),
      c: num(bar["4. close"]),
      v: num(bar["5. volume"]),
    }))
    .filter((bar) => bar.t >= cutoff)
    .sort((a, b) => a.t - b.t);
};

export interface CompanyOverview {
  symbol: string;
  name: string;
  description: string;
  exchange: string;
  currency: string;
  country: string;
  sector: string;
  industry: string;
  market_cap: number;
  pe_ratio: number;
  dividend_yield: number;
  week52_high: number;
  week52_low: number;
}

// OVERVIEW - company fundamentals. Replaces both Polygon reference calls.
export const fetchOverview = async (symbol: string): Promise<CompanyOverview> => {
  const data = await request({ function: "OVERVIEW", symbol });
  if (!data || !data.Symbol) {
    throw new UpstreamDataError(`No company overview returned for ${symbol}`);
  }
  return {
    symbol: data.Symbol,
    name: data.Name ?? "",
    description: data.Description ?? "",
    exchange: data.Exchange ?? "",
    currency: data.Currency ?? "",
    country: data.Country ?? "",
    sector: data.Sector ?? "",
    industry: data.Industry ?? "",
    market_cap: num(data.MarketCapitalization),
    pe_ratio: num(data.PERatio),
    dividend_yield: num(data.DividendYield),
    week52_high: num(data["52WeekHigh"]),
    week52_low: num(data["52WeekLow"]),
  };
};

export interface NewsArticle {
  title: string;
  url: string;
  published: string;
  source: string;
  summary: string;
  sentiment: string;
}

// NEWS_SENTIMENT - recent articles mentioning the ticker.
export const fetchNews = async (symbol: string, limit = 10): Promise<NewsArticle[]> => {
  const data = await request({
    function: "NEWS_SENTIMENT",
    tickers: symbol,
    limit: String(limit),
  });
  const feed = data?.feed;
  if (!Array.isArray(feed)) return [];
  return feed.slice(0, limit).map((item: any) => ({
    title: item.title ?? "",
    url: item.url ?? "",
    // time_published arrives as YYYYMMDDTHHMMSS, which Date cannot parse as-is.
    published: parseAvTimestamp(item.time_published),
    source: item.source ?? "",
    summary: item.summary ?? "",
    sentiment: item.overall_sentiment_label ?? "",
  }));
};

// Convert Alpha Vantage's 20260803T142740 into an ISO string.
const parseAvTimestamp = (raw?: string): string => {
  if (!raw || raw.length < 15) return "";
  const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(
    9,
    11
  )}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
};

export interface SymbolMatch {
  symbol: string;
  name: string;
  type: string;
  region: string;
  currency: string;
}

// SYMBOL_SEARCH - ticker lookup by free text.
export const searchSymbols = async (keywords: string): Promise<SymbolMatch[]> => {
  const data = await request({ function: "SYMBOL_SEARCH", keywords });
  const matches = data?.bestMatches;
  if (!Array.isArray(matches)) return [];
  return matches.map((m: any) => ({
    symbol: m["1. symbol"] ?? "",
    name: m["2. name"] ?? "",
    type: m["3. type"] ?? "",
    region: m["4. region"] ?? "",
    currency: m["8. currency"] ?? "",
  }));
};
