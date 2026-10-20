import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

/* ===========================================================================
   Massive client (formerly Polygon.io)
   ---------------------------------------------------------------------------
   The free Basic plan allows 5 requests per MINUTE with no daily cap, end of
   day prices only, and two years of history. Every call goes through this
   module, which:

     1. counts requests in a rolling one-minute window and waits for a free
        slot, but only briefly - a page should fall back to a cached value
        rather than hang for a minute
     2. maps the plan's refusals (HTTP 403) to UpstreamUnavailableError, so a
        caller can tell "not on this plan" from "try again shortly" (429)

   What the free plan does NOT include, checked against the live API:
     - snapshots and last trade, so the "current" price is the latest daily
       close. Trades execute at that price; this was accepted knowingly.
     - intraday bars (accepted, but always empty), so the 1-day chart falls
       back to daily bars unless MASSIVE_INTRADAY=true on a paid plan
     - fundamentals (P/E, financial statements)
     - any exchange outside the US, so no TASE
   =========================================================================== */

const API_KEY = process.env.MASSIVE_API_KEY;
const BASE_URL = "https://api.massive.com";

// Free plan: 5 per minute. Override with MASSIVE_REQUESTS_PER_MINUTE on a paid plan.
const REQUESTS_PER_MINUTE = Number(process.env.MASSIVE_REQUESTS_PER_MINUTE || 5);
const WINDOW_MS = 60 * 1000;

// Longest a request may wait for a free slot before giving up, so the caller
// can serve a stale copy instead.
const MAX_WAIT_MS = Number(process.env.MASSIVE_MAX_WAIT_MS || 15000);

// The plan allows two years; one day short keeps clear of the boundary.
export const MAX_HISTORY_DAYS = 729;

// ---------------------------------------------------------------------------
// Errors, so callers can tell "we ran out of budget" from "the ticker is bad"
// ---------------------------------------------------------------------------
export class QuotaExhaustedError extends Error {
  constructor(message = "Market data request budget exhausted for this minute") {
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

/**
 * The endpoint exists but is not available on our plan. Distinct from
 * throttling because retrying will never succeed - only upgrading will.
 */
export class UpstreamUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamUnavailableError";
  }
}

export class UpstreamDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamDataError";
  }
}

// ---------------------------------------------------------------------------
// Rolling one-minute budget
// ---------------------------------------------------------------------------
let sentAt: number[] = [];

const pruneWindow = () => {
  const since = Date.now() - WINDOW_MS;
  sentAt = sentAt.filter((t) => t > since);
};

export const getQuotaStatus = () => {
  pruneWindow();
  const resetsAt = sentAt.length > 0 ? sentAt[0] + WINDOW_MS : Date.now();
  return {
    used: sentAt.length,
    limit: REQUESTS_PER_MINUTE,
    remaining: Math.max(0, REQUESTS_PER_MINUTE - sentAt.length),
    window: "1 minute",
    resets_at: new Date(resetsAt).toISOString(),
  };
};

// ---------------------------------------------------------------------------
// Serialised request queue
// Requests run one at a time, so concurrent callers (the watchlist fetching
// several symbols at once) take slots in order instead of racing for them.
// ---------------------------------------------------------------------------
let queueTail: Promise<unknown> = Promise.resolve();
let pending = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
  const run = queueTail.then(task);
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
const request = async (path: string, params: Record<string, string> = {}): Promise<any> => {
  if (!API_KEY) {
    throw new UpstreamDataError("MASSIVE_API_KEY is not configured");
  }

  // More callers already waiting than a minute can serve: fail now rather
  // than queue behind them.
  if (pending >= REQUESTS_PER_MINUTE) throw new QuotaExhaustedError();

  pending += 1;
  try {
    return await enqueue(async () => {
      pruneWindow();
      if (sentAt.length >= REQUESTS_PER_MINUTE) {
        const waitFor = sentAt[0] + WINDOW_MS - Date.now();
        if (waitFor > MAX_WAIT_MS) throw new QuotaExhaustedError();
        if (waitFor > 0) await sleep(waitFor);
        pruneWindow();
      }
      sentAt.push(Date.now());

      // The key goes in a header, never the URL, so it cannot end up in logs.
      const response = await axios.get(`${BASE_URL}${path}`, {
        params,
        headers: { Authorization: `Bearer ${API_KEY}` },
        timeout: 15000,
        validateStatus: () => true,
      });
      const data = response.data;
      const message = String(data?.message || data?.error || `HTTP ${response.status}`);

      if (response.status === 429) throw new UpstreamThrottledError(message);
      if (response.status === 403) throw new UpstreamUnavailableError(message);
      if (response.status === 401) {
        throw new UpstreamDataError("Market data provider rejected the API key");
      }
      if (response.status === 404) throw new UpstreamDataError(message);
      if (response.status >= 400) throw new Error(`Market data request failed: ${message}`);

      return data;
    });
  } finally {
    pending -= 1;
  }
};

// ---------------------------------------------------------------------------
// Dates
// Daily bars are stamped at midnight US/Eastern. The charts and the rest of
// the app expect a bar's date at midnight UTC, so convert through the Eastern
// calendar date rather than shifting by a fixed offset (which DST breaks).
// ---------------------------------------------------------------------------
const easternDate = (epochMs: number): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epochMs));

const isoDay = (epochMs: number): string => new Date(epochMs).toISOString().slice(0, 10);

const DAY_MS = 24 * 60 * 60 * 1000;

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export interface Bar {
  t: number; // epoch ms, matching the shape the charts already consume
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

// Daily aggregates over a date range, oldest first.
const dailyAggregates = async (symbol: string, fromMs: number, toMs: number): Promise<Bar[]> => {
  const data = await request(
    `/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${isoDay(fromMs)}/${isoDay(toMs)}`,
    { adjusted: "true", sort: "asc", limit: "50000" }
  );
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.map((bar: any) => ({
    t: new Date(`${easternDate(bar.t)}T00:00:00Z`).getTime(),
    o: num(bar.o),
    h: num(bar.h),
    l: num(bar.l),
    c: num(bar.c),
    v: Math.round(num(bar.v)),
  }));
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

// The latest daily bar and the one before it, from one request. Ten calendar
// days always span at least two sessions, even across a long holiday weekend.
export const fetchQuote = async (symbol: string): Promise<Quote> => {
  const now = Date.now();
  const bars = await dailyAggregates(symbol, now - 10 * DAY_MS, now);
  const latest = bars[bars.length - 1];
  if (!latest) throw new UpstreamDataError(`No quote data returned for ${symbol}`);

  const previous = bars[bars.length - 2];
  const previousClose = previous ? previous.c : latest.o;
  const change = latest.c - previousClose;
  return {
    symbol,
    open: latest.o,
    high: latest.h,
    low: latest.l,
    price: latest.c,
    volume: latest.v,
    latest_trading_day: isoDay(latest.t),
    previous_close: previousClose,
    change,
    change_percent: previousClose ? (change / previousClose) * 100 : 0,
  };
};

// Historical daily bars, oldest first, trimmed to `days` (at most two years).
export const fetchDailyBars = async (symbol: string, days: number): Promise<Bar[]> => {
  const now = Date.now();
  const span = Math.min(Math.max(days, 1), MAX_HISTORY_DAYS);
  const bars = await dailyAggregates(symbol, now - span * DAY_MS, now);
  if (bars.length === 0) throw new UpstreamDataError(`No daily series returned for ${symbol}`);
  return bars;
};

// Intraday bars for a "last day" view.
//
// NOT ON THE FREE PLAN: the endpoint answers, but always with no bars, which
// surfaces as UpstreamDataError. It is kept because one env flag enables it
// on a paid plan; see MASSIVE_INTRADAY in the aggregates controller.
export const fetchIntradayBars = async (
  symbol: string,
  minutes: 5 | 15 | 30 | 60 = 5
): Promise<Bar[]> => {
  const now = Date.now();
  // Four days back reaches the most recent session from a Monday morning.
  const data = await request(
    `/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/${minutes}/minute/${isoDay(
      now - 4 * DAY_MS
    )}/${isoDay(now)}`,
    { adjusted: "true", sort: "asc", limit: "50000" }
  );
  const results = Array.isArray(data?.results) ? data.results : [];
  if (results.length === 0) {
    throw new UpstreamDataError(`No intraday series returned for ${symbol}`);
  }

  // Keep only the latest session.
  const lastDay = easternDate(results[results.length - 1].t);
  return results
    .filter((bar: any) => easternDate(bar.t) === lastDay)
    .map((bar: any) => ({
      t: bar.t,
      o: num(bar.o),
      h: num(bar.h),
      l: num(bar.l),
      c: num(bar.c),
      v: num(bar.v),
    }));
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

// Massive reports exchanges by their MIC code.
const EXCHANGE_NAMES: Record<string, string> = {
  XNAS: "NASDAQ",
  XNYS: "NYSE",
  XASE: "NYSE American",
  ARCX: "NYSE Arca",
  BATS: "Cboe BZX",
};

// "SERVICES-PREPACKAGED SOFTWARE" -> "Services-Prepackaged Software"
const titleCase = (text: string): string =>
  text.toLowerCase().replace(/(^|[\s\-&/])([a-z])/g, (_m, sep, ch) => sep + ch.toUpperCase());

// Ticker overview - company profile.
//
// The plan has no fundamentals, so pe_ratio and dividend_yield are 0, which
// the client already treats as "not shown". The 52-week range is 0 here too;
// the controller fills it from daily bars it has cached anyway.
export const fetchOverview = async (symbol: string): Promise<CompanyOverview> => {
  const data = await request(`/v3/reference/tickers/${encodeURIComponent(symbol)}`);
  const t = data?.results;
  if (!t || !t.ticker) {
    throw new UpstreamDataError(`No company overview returned for ${symbol}`);
  }
  return {
    symbol: t.ticker,
    name: t.name ?? "",
    description: t.description ?? "",
    exchange: EXCHANGE_NAMES[t.primary_exchange] ?? t.primary_exchange ?? "",
    currency: String(t.currency_name ?? "").toUpperCase(),
    country: t.locale === "us" ? "USA" : String(t.locale ?? "").toUpperCase(),
    sector: "",
    industry: t.sic_description ? titleCase(t.sic_description) : "",
    market_cap: num(t.market_cap),
    pe_ratio: 0,
    dividend_yield: 0,
    week52_high: 0,
    week52_low: 0,
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

// Recent articles mentioning the ticker, newest first.
export const fetchNews = async (symbol: string, limit = 10): Promise<NewsArticle[]> => {
  const data = await request("/v2/reference/news", {
    ticker: symbol,
    limit: String(limit),
    order: "desc",
    sort: "published_utc",
  });
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.slice(0, limit).map((item: any) => {
    // Sentiment is given per ticker the article mentions; take this one's.
    const insight = Array.isArray(item.insights)
      ? item.insights.find((i: any) => i?.ticker === symbol)
      : undefined;
    const sentiment = String(insight?.sentiment ?? "");
    return {
      title: item.title ?? "",
      url: item.article_url ?? "",
      published: item.published_utc ?? "",
      source: item.publisher?.name ?? "",
      summary: item.description ?? "",
      sentiment: sentiment ? sentiment[0].toUpperCase() + sentiment.slice(1) : "",
    };
  });
};

export interface SymbolMatch {
  symbol: string;
  name: string;
  type: string;
  region: string;
  currency: string;
}

// How much each listing type is preferred when ranking search results:
// operating companies first, then funds, then exchange-traded notes. Anything
// unlisted here (warrants, rights, units) gets nothing.
const TYPE_PREFERENCE: Record<string, number> = {
  CS: 60,
  ADRC: 60,
  ETF: 40,
  ETS: 40,
  ETV: 40,
  FUND: 30,
  PFD: 20,
  ETN: 10,
};

const TYPE_NAMES: Record<string, string> = {
  CS: "Equity",
  ADRC: "ADR",
  PFD: "Preferred",
  ETF: "ETF",
  ETN: "ETN",
  ETS: "ETF",
  ETV: "ETF",
  FUND: "Fund",
};

// Ticker lookup by free text.
//
// Massive returns matches in ticker order, not by relevance: "micro" does not
// reach Microsoft in the first twenty. So fetch one large page and rank it
// here - exact ticker, then ticker prefix, then a name word starting with the
// text - with common stock ahead of funds, notes, warrants and units.
export const searchSymbols = async (keywords: string, limit = 10): Promise<SymbolMatch[]> => {
  const data = await request("/v3/reference/tickers", {
    search: keywords,
    market: "stocks",
    active: "true",
    limit: "1000",
  });
  const results = Array.isArray(data?.results) ? data.results : [];

  const needle = keywords.trim().toLowerCase();
  const wordStart = new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  const score = (t: any): number => {
    const ticker = String(t.ticker ?? "").toLowerCase();
    const name = String(t.name ?? "").toLowerCase();
    let s = 0;
    if (ticker === needle) s += 1000;
    else if (ticker.startsWith(needle)) s += 300;
    if (name.startsWith(needle)) s += 200;
    else if (wordStart.test(name)) s += 100;
    s += TYPE_PREFERENCE[t.type] ?? 0;
    return s;
  };

  return results
    .map((t: any) => ({ t, s: score(t) }))
    .sort((a: any, b: any) => b.s - a.s || String(a.t.ticker).localeCompare(String(b.t.ticker)))
    .slice(0, limit)
    .map(({ t }: any) => ({
      symbol: t.ticker ?? "",
      name: t.name ?? "",
      type: TYPE_NAMES[t.type] ?? t.type ?? "",
      region: t.locale === "us" ? "United States" : String(t.locale ?? ""),
      currency: String(t.currency_name ?? "").toUpperCase(),
    }));
};
