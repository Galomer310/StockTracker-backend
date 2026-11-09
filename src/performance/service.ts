import pool from "../config/db";
import { localDate } from "../metrics/calendar";
import { fetchOverview, fetchUnadjustedCloses } from "../services/massive";
import { computeExposures, TechRule } from "./exposures";
import { averageDailyDollarVolume } from "../metrics/exposure";
import { compositionEvents } from "./composition";
import { compareWithIndex, computeInsights, sessionPoints } from "./insights";
import { computeProfile, DEFAULT_SCALES, ProfileScales } from "./profile";
import { addDays, checkAgainstLive, finalThrough, lastFinalSession, performanceIndexOf, PricePoint, reconstructDailyValues } from "./history";

/* ===========================================================================
   Portfolio history: the database side (stage 1 of professional
   achievements).
   ---------------------------------------------------------------------------
   runValuationJob, on a timer (VALUATION_HOURS, default 6):
     1. makes sure every symbol ever traded, and the benchmark, has its
        daily closes in daily_prices up to the last finished session;
     2. rebuilds every portfolio's daily values (src/performance/history.ts)
        and stores them, with whether the record matches the live portfolio
        and how far its values are final.

   Market data costs requests (5 a minute on the free plan, shared with the
   pages). A symbol is fetched only when a new session has closed since it
   was last checked, and only the missing dates, so a normal day costs one
   request per symbol held anywhere plus one for the benchmark.
   =========================================================================== */

export interface BenchmarkSetting {
  symbol: string;
  name: string;
  source: string;
  return_type: string;
  provisional: boolean;
}

const DEFAULT_BENCHMARK: BenchmarkSetting = {
  symbol: "SPY",
  name: "S&P 500",
  source: "etf_proxy",
  return_type: "price",
  provisional: true,
};

// The free plan keeps two years; one day short stays clear of the edge.
const HISTORY_DAYS = 729;

export const loadBenchmark = async (): Promise<BenchmarkSetting> => {
  const r = await pool.query("SELECT value FROM progression_settings WHERE key = 'benchmark'");
  return { ...DEFAULT_BENCHMARK, ...(r.rows[0]?.value ?? {}) };
};

const DEFAULT_NASDAQ100: BenchmarkSetting = {
  symbol: "QQQ",
  name: "NASDAQ-100",
  source: "etf_proxy",
  return_type: "price",
  provisional: true,
};

export interface ComparisonIndex {
  key: string;
  symbol: string;
  name: string;
}

const DEFAULT_COMPARISON_INDICES: ComparisonIndex[] = [
  { key: "sp500", symbol: "SPY", name: "S&P 500" },
  { key: "nasdaq_composite", symbol: "ONEQ", name: "Nasdaq Composite" },
  { key: "dow", symbol: "DIA", name: "Dow Jones Industrial Average" },
  { key: "russell2000", symbol: "IWM", name: "Russell 2000" },
];

/** The indices of the comparison screen (spec 41), from the `comparison_indices` setting. */
export const loadComparisonIndices = async (): Promise<ComparisonIndex[]> => {
  const r = await pool.query("SELECT value FROM progression_settings WHERE key = 'comparison_indices'");
  const v = r.rows[0]?.value;
  return Array.isArray(v) && v.length ? v : DEFAULT_COMPARISON_INDICES;
};

/** Every benchmark Performance Insights compares with, in display order. */
export const loadBenchmarks = async (): Promise<(BenchmarkSetting & { key: string })[]> => {
  const r = await pool.query("SELECT value FROM progression_settings WHERE key = 'benchmark_nasdaq100'");
  return [
    { key: "sp500", ...(await loadBenchmark()) },
    { key: "nasdaq100", ...DEFAULT_NASDAQ100, ...(r.rows[0]?.value ?? {}) },
  ];
};

// A DATE column as "YYYY-MM-DD" (node-postgres reads DATE as local midnight).
const dateText = (d: Date | string): string => {
  if (typeof d === "string") return d.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Fetches whatever closes are missing for these symbols, up to the last final session. */
export const ensureCloses = async (symbols: string[], now: Date = new Date()) => {
  const target = lastFinalSession(now);
  const report: { symbol: string; fetched: number; error?: string }[] = [];
  for (const symbol of symbols) {
    const cov = await pool.query("SELECT checked_through FROM price_coverage WHERE symbol = $1", [symbol]);
    const checked = cov.rows[0] ? dateText(cov.rows[0].checked_through) : null;
    if (checked && checked >= target) continue;
    const from = checked ? addDays(checked, 1) : addDays(target, -HISTORY_DAYS);
    try {
      const closes = (await fetchUnadjustedCloses(symbol, from, target)).filter((c) => c.date <= target);
      if (closes.length > 0) {
        await pool.query(
          `INSERT INTO daily_prices (symbol, date, close, volume)
           SELECT $1, d, c, v FROM unnest($2::date[], $3::numeric[], $4::numeric[]) AS t(d, c, v)
           ON CONFLICT (symbol, date) DO UPDATE SET close = EXCLUDED.close, volume = COALESCE(EXCLUDED.volume, daily_prices.volume)`,
          [symbol, closes.map((c) => c.date), closes.map((c) => c.close), closes.map((c) => c.volume)]
        );
      }
      await pool.query(
        `INSERT INTO price_coverage (symbol, checked_through, fetched_at, last_error) VALUES ($1, $2, NOW(), NULL)
         ON CONFLICT (symbol) DO UPDATE SET checked_through = EXCLUDED.checked_through, fetched_at = NOW(), last_error = NULL`,
        [symbol, target]
      );
      report.push({ symbol, fetched: closes.length });
    } catch (error: any) {
      const message = String(error?.message ?? error).slice(0, 300);
      await pool.query(
        `INSERT INTO price_coverage (symbol, checked_through, fetched_at, last_error)
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (symbol) DO UPDATE SET fetched_at = NOW(), last_error = EXCLUDED.last_error`,
        [symbol, checked ?? addDays(from, -1), message]
      );
      report.push({ symbol, fetched: 0, error: message });
    }
  }
  return report;
};

/** Sessions of volume the liquidity measure looks back over (spec: 20). */
const VOLUME_SESSIONS = 20;
// Calendar days that always hold 20 sessions, even across holidays.
const VOLUME_LOOKBACK_DAYS = 45;

/**
 * Closes stored before daily_prices had a volume column have none. For the
 * symbols held now, fetch the recent sessions again (one request each) when
 * any of them lacks its volume. A no-op once filled: new closes arrive with
 * their volume.
 */
export const ensureVolumes = async (symbols: string[], now: Date = new Date()) => {
  const target = lastFinalSession(now);
  const from = addDays(target, -VOLUME_LOOKBACK_DAYS);
  const report: { symbol: string; filled: number; error?: string }[] = [];
  for (const symbol of symbols) {
    const gap = await pool.query(
      "SELECT COUNT(*)::int AS n FROM daily_prices WHERE symbol = $1 AND date >= $2 AND volume IS NULL",
      [symbol, from]
    );
    if (gap.rows[0].n === 0) continue;
    try {
      const bars = await fetchUnadjustedCloses(symbol, from, target);
      const r = await pool.query(
        `UPDATE daily_prices p SET volume = t.v
         FROM unnest($2::date[], $3::numeric[]) AS t(d, v)
         WHERE p.symbol = $1 AND p.date = t.d AND p.volume IS NULL`,
        [symbol, bars.map((b) => b.date), bars.map((b) => b.volume)]
      );
      report.push({ symbol, filled: r.rowCount ?? 0 });
    } catch (error: any) {
      report.push({ symbol, filled: 0, error: String(error?.message ?? error).slice(0, 300) });
    }
  }
  return report;
};

/**
 * Average daily dollar volume as the spec defines it: the 20-day average
 * price times the 20-day average share volume (metrics/exposure). Null with
 * fewer than 20 sessions of volume.
 */
const loadDollarVolumes = async (symbols: string[]): Promise<Record<string, number | null>> => {
  const out: Record<string, number | null> = Object.fromEntries(symbols.map((s) => [s, null]));
  if (symbols.length === 0) return out;
  const r = await pool.query(
    `SELECT symbol, close, volume FROM (
       SELECT symbol, date, close, volume, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
       FROM daily_prices WHERE symbol = ANY($1::text[]) AND volume IS NOT NULL
     ) x WHERE rn <= $2 ORDER BY symbol, date`,
    [symbols, VOLUME_SESSIONS]
  );
  const bars = new Map<string, { close: number; volume: number }[]>();
  for (const row of r.rows) bars.set(row.symbol, [...(bars.get(row.symbol) ?? []), { close: Number(row.close), volume: Number(row.volume) }]);
  for (const [symbol, b] of bars) out[symbol] = averageDailyDollarVolume(b);
  return out;
};

/** Company reference data older than this is fetched again. */
const SECURITY_REFRESH_DAYS = 7;

/**
 * The security master: market cap and SIC industry for the symbols held
 * now, one reference request each when missing or older than a week.
 */
export const ensureSecurities = async (symbols: string[]) => {
  const report: { symbol: string; error?: string }[] = [];
  for (const symbol of symbols) {
    const cur = await pool.query(
      "SELECT 1 FROM securities WHERE symbol = $1 AND fetched_at > NOW() - make_interval(days => $2)",
      [symbol, SECURITY_REFRESH_DAYS]
    );
    if (cur.rows.length) continue;
    try {
      const o = await fetchOverview(symbol);
      await pool.query(
        `INSERT INTO securities (symbol, name, sic_code, sic_description, market_cap, fetched_at, last_error)
         VALUES ($1, $2, $3, $4, $5, NOW(), NULL)
         ON CONFLICT (symbol) DO UPDATE SET name = EXCLUDED.name, sic_code = EXCLUDED.sic_code,
           sic_description = EXCLUDED.sic_description, market_cap = EXCLUDED.market_cap, fetched_at = NOW(), last_error = NULL`,
        [symbol, o.name || null, o.sic_code, o.industry || null, o.market_cap > 0 ? o.market_cap : null]
      );
      report.push({ symbol });
    } catch (error: any) {
      const message = String(error?.message ?? error).slice(0, 300);
      // Remember the failure, but keep what was known; try again next run.
      await pool.query(
        `INSERT INTO securities (symbol, fetched_at, last_error) VALUES ($1, NOW() - make_interval(days => $3), $2)
         ON CONFLICT (symbol) DO UPDATE SET last_error = EXCLUDED.last_error`,
        [symbol, message, SECURITY_REFRESH_DAYS + 1]
      );
      report.push({ symbol, error: message });
    }
  }
  return report;
};

const loadCloses = async (symbols: string[]): Promise<Record<string, PricePoint[]>> => {
  if (symbols.length === 0) return {};
  const r = await pool.query(
    "SELECT symbol, date, close FROM daily_prices WHERE symbol = ANY($1::text[]) ORDER BY symbol, date",
    [symbols]
  );
  const out: Record<string, PricePoint[]> = {};
  for (const row of r.rows) (out[row.symbol] ??= []).push({ date: dateText(row.date), close: Number(row.close) });
  return out;
};

// Capital growth rewards arrive with the daily rewards feature; until its
// table exists there are no flows.
const loadFlows = async (portfolioId: number) => {
  const exists = await pool.query("SELECT to_regclass('public.capital_adjustments') IS NOT NULL AS ok");
  if (!exists.rows[0].ok) return [];
  const r = await pool.query(
    "SELECT applied_at, cash_after - cash_before AS amount FROM capital_adjustments WHERE portfolio_id = $1",
    [portfolioId]
  );
  return r.rows.map((row) => ({ date: localDate(new Date(row.applied_at)), amount: Number(row.amount) }));
};

/** Rebuilds and stores one portfolio's daily values. */
export const rebuildPortfolio = async (portfolioId: number, now: Date = new Date()) => {
  const p = (
    await pool.query("SELECT id, starting_balance, cash, created_at FROM portfolios WHERE id = $1", [portfolioId])
  ).rows[0];
  if (!p) return null;

  const [tradesR, liveR, flows] = await Promise.all([
    // Dated by execution (created_at), never by the player's own date.
    pool.query(
      `SELECT created_at, stock_symbol, action, quantity, price FROM trade_notes
       WHERE portfolio_id = $1 ORDER BY created_at, id`,
      [portfolioId]
    ),
    pool.query("SELECT stock_symbol, SUM(quantity)::int AS qty FROM watchlist WHERE portfolio_id = $1 GROUP BY stock_symbol", [
      portfolioId,
    ]),
    loadFlows(portfolioId),
  ]);
  const trades = tradesR.rows.map((t) => ({
    date: localDate(new Date(t.created_at)),
    symbol: t.stock_symbol,
    action: t.action as "buy" | "sell",
    quantity: Number(t.quantity),
    price: Number(t.price),
  }));
  const symbols = [...new Set(trades.map((t) => t.symbol))];
  const closes = await loadCloses(symbols);

  const openedOn = localDate(new Date(p.created_at));
  const today = localDate(now);
  const days = reconstructDailyValues({
    startingBalance: Number(p.starting_balance),
    openedOn,
    through: today,
    trades,
    flows,
    closes,
  });
  const index = performanceIndexOf(days);

  const live = {
    cash: Number(p.cash),
    holdings: Object.fromEntries(liveR.rows.filter((r) => r.qty !== 0).map((r) => [r.stock_symbol, Number(r.qty)])),
  };
  const check = checkAgainstLive(days[days.length - 1], live);

  // How far the values are final: day by day, against the symbols held that day.
  const cov = symbols.length
    ? await pool.query("SELECT symbol, checked_through FROM price_coverage WHERE symbol = ANY($1::text[])", [symbols])
    : { rows: [] as any[] };
  const coverage = Object.fromEntries(cov.rows.map((r) => [r.symbol, dateText(r.checked_through)]));
  const final = finalThrough(days, coverage, addDays(today, -1));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM portfolio_daily_values WHERE portfolio_id = $1", [portfolioId]);
    if (days.length > 0) {
      await client.query(
        `INSERT INTO portfolio_daily_values (portfolio_id, date, cash, positions_value, nav, external_flow, perf_index, estimated)
         SELECT $1, d, c, pv, n, f, i, e
         FROM unnest($2::date[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[], $8::boolean[])
           AS t(d, c, pv, n, f, i, e)`,
        [
          portfolioId,
          days.map((d) => d.date),
          days.map((d) => d.cash),
          days.map((d) => d.positions_value),
          days.map((d) => d.nav),
          days.map((d) => d.external_flow),
          index,
          days.map((d) => d.estimated_symbols.length > 0),
        ]
      );
    }
    await client.query(
      `INSERT INTO portfolio_history_status (portfolio_id, consistent, reason, final_through, rebuilt_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (portfolio_id) DO UPDATE
       SET consistent = EXCLUDED.consistent, reason = EXCLUDED.reason, final_through = EXCLUDED.final_through, rebuilt_at = NOW()`,
      [portfolioId, check.ok, check.ok ? null : check.reason, final]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return { portfolioId, days: days.length, consistent: check.ok, reason: check.ok ? null : check.reason, finalThrough: final };
};

let running = false;

/** Fetch missing closes, then rebuild every portfolio. One run at a time. */
export const runValuationJob = async (now: Date = new Date()) => {
  if (running) return null;
  running = true;
  try {
    // The benchmarks, and the indices players can compare with (spec 41).
    const marks = [
      ...new Set([...(await loadBenchmarks()).map((b) => b.symbol), ...(await loadComparisonIndices()).map((i) => i.symbol)]),
    ];
    const traded = await pool.query("SELECT DISTINCT stock_symbol FROM trade_notes ORDER BY stock_symbol");
    const symbols = [...marks, ...traded.rows.map((r) => r.stock_symbol).filter((s) => !marks.includes(s))];
    const prices = await ensureCloses(symbols, now);
    const held = await pool.query("SELECT DISTINCT stock_symbol FROM watchlist ORDER BY stock_symbol");
    const volumes = await ensureVolumes(held.rows.map((r) => r.stock_symbol), now);
    const securities = await ensureSecurities(held.rows.map((r) => r.stock_symbol));
    const portfolios = await pool.query("SELECT id FROM portfolios ORDER BY id");
    const rebuilt = [];
    for (const { id } of portfolios.rows) {
      try {
        rebuilt.push(await rebuildPortfolio(id, now));
      } catch (error) {
        console.error(`[valuation] portfolio ${id} failed:`, error);
      }
    }
    const inconsistent = rebuilt.filter((r) => r && !r.consistent);
    console.log(
      `[valuation] ${prices.filter((p) => !p.error).length}/${prices.length} symbols fetched, ` +
        `${rebuilt.length} portfolios rebuilt, ${inconsistent.length} inconsistent` +
        (volumes.length ? `, volume filled for ${volumes.filter((v) => !v.error).length}/${volumes.length} held symbols` : "")
    );
    // Professional achievements are measured on the history just rebuilt.
    // Loaded here rather than at the top: src/professional reads this module.
    const { runProfessionalEvaluation } = await import("../professional/service");
    let professional = null;
    try {
      professional = await runProfessionalEvaluation();
    } catch (error) {
      console.error("[professional] evaluation failed:", error);
    }
    return { prices, volumes, securities, rebuilt, professional };
  } finally {
    running = false;
  }
};

/** The owner's view of one portfolio's history. */
export const portfolioHistory = async (portfolioId: number, userId: number) => {
  const owner = await pool.query("SELECT id FROM portfolios WHERE id = $1 AND user_id = $2", [portfolioId, userId]);
  if (owner.rows.length === 0) return null;
  const [status, rows] = await Promise.all([
    pool.query("SELECT consistent, reason, final_through, rebuilt_at FROM portfolio_history_status WHERE portfolio_id = $1", [
      portfolioId,
    ]),
    pool.query(
      `SELECT date, cash, positions_value, nav, external_flow, perf_index, estimated
       FROM portfolio_daily_values WHERE portfolio_id = $1 ORDER BY date`,
      [portfolioId]
    ),
  ]);
  const s = status.rows[0];
  return {
    status: s
      ? { consistent: s.consistent, reason: s.reason, final_through: s.final_through ? dateText(s.final_through) : null, rebuilt_at: s.rebuilt_at }
      : null,
    days: rows.rows.map((r) => ({
      date: dateText(r.date),
      cash: Number(r.cash),
      positions_value: Number(r.positions_value),
      nav: Number(r.nav),
      external_flow: Number(r.external_flow),
      perf_index: r.perf_index === null ? null : Number(r.perf_index),
      estimated: r.estimated,
    })),
  };
};

/**
 * Module 5, Performance Insights, for the owner: worked out on request from
 * the stored history and closes (src/performance/insights.ts). Null when the
 * portfolio is not the caller's.
 */
export const portfolioInsights = async (portfolioId: number, userId: number, now: Date = new Date()) => {
  const p = (
    await pool.query("SELECT id, name, created_at FROM portfolios WHERE id = $1 AND user_id = $2", [portfolioId, userId])
  ).rows[0];
  if (!p) return null;
  const benchmarks = await loadBenchmarks();
  const [status, rows, closes] = await Promise.all([
    pool.query("SELECT consistent, final_through, rebuilt_at FROM portfolio_history_status WHERE portfolio_id = $1", [portfolioId]),
    pool.query("SELECT date, perf_index, estimated FROM portfolio_daily_values WHERE portfolio_id = $1 ORDER BY date", [portfolioId]),
    loadCloses(benchmarks.map((b) => b.symbol)),
  ]);
  const s = status.rows[0];
  const outcome = computeInsights({
    openedOn: localDate(new Date(p.created_at)),
    today: localDate(now),
    days: rows.rows.map((r) => ({
      date: dateText(r.date),
      perf_index: r.perf_index === null ? null : Number(r.perf_index),
      estimated: r.estimated,
    })),
    benchmarks: benchmarks.map((b) => ({ key: b.key, symbol: b.symbol, name: b.name, closes: closes[b.symbol] ?? [] })),
  });
  return {
    portfolio: { id: p.id, name: p.name, created_at: p.created_at },
    status: s
      ? { consistent: s.consistent, final_through: s.final_through ? dateText(s.final_through) : null, rebuilt_at: s.rebuilt_at }
      : null,
    benchmarks: benchmarks.map((b) => ({
      key: b.key,
      symbol: b.symbol,
      name: b.name,
      source: b.source,
      return_type: b.return_type,
      provisional: b.provisional,
    })),
    ...(outcome.ok
      ? { available: true as const, insights: outcome.insights }
      : { available: false as const, reason: outcome.reason, age_days: outcome.age_days }),
  };
};

/** The approved scales, with any override from the `risk_scales` setting. */
export const loadScales = async (): Promise<ProfileScales> => {
  const r = await pool.query("SELECT value FROM progression_settings WHERE key = 'risk_scales'");
  return { ...DEFAULT_SCALES, ...(r.rows[0]?.value ?? {}) };
};

/**
 * Module 3, Investment Profile, for the owner (src/performance/profile.ts).
 * Null when the portfolio is not the caller's.
 */
export const portfolioProfile = async (portfolioId: number, userId: number, now: Date = new Date()) => {
  const p = (
    await pool.query("SELECT id, name, starting_balance, cash, created_at FROM portfolios WHERE id = $1 AND user_id = $2", [
      portfolioId,
      userId,
    ])
  ).rows[0];
  if (!p) return null;
  const [benchmarks, scales] = await Promise.all([loadBenchmarks(), loadScales()]);
  const [rows, lotsR, tradesR, flowsR] = await Promise.all([
    pool.query("SELECT date, perf_index, estimated FROM portfolio_daily_values WHERE portfolio_id = $1 ORDER BY date", [portfolioId]),
    // The holdings now, valued as every screen values them: the cached
    // close, or what was paid. Sector as recorded with the most recent lot.
    pool.query(
      `SELECT w.stock_symbol, w.price_at_time, w.quantity, w.industry, s.last_price
       FROM watchlist w LEFT JOIN stocks s ON s.stock_symbol = w.stock_symbol
       WHERE w.portfolio_id = $1 ORDER BY w.added_at, w.id`,
      [portfolioId]
    ),
    pool.query(
      "SELECT id, created_at, stock_symbol, action, quantity, price FROM trade_notes WHERE portfolio_id = $1 ORDER BY created_at, id",
      [portfolioId]
    ),
    pool.query("SELECT applied_at, cash_after - cash_before AS amount FROM capital_adjustments WHERE portfolio_id = $1", [portfolioId]),
  ]);

  const bySymbol = new Map<string, any[]>();
  for (const lot of lotsR.rows) bySymbol.set(lot.stock_symbol, [...(bySymbol.get(lot.stock_symbol) ?? []), lot]);
  const holdings = [...bySymbol.entries()].map(([symbol, lots]) => {
    const shares = lots.reduce((t, l) => t + Number(l.quantity), 0);
    const cost = lots.reduce((t, l) => t + Number(l.quantity) * Number(l.price_at_time), 0);
    const priced = lots.find((l) => l.last_price !== null);
    const price = priced ? Number(priced.last_price) : shares ? cost / shares : 0;
    const sector = [...lots].reverse().find((l) => l.industry)?.industry ?? null;
    return { symbol, value: shares * price, sector };
  });

  const trades = tradesR.rows.map((t) => ({
    id: t.id,
    at: new Date(t.created_at).toISOString(),
    date: localDate(new Date(t.created_at)),
    symbol: t.stock_symbol as string,
    action: t.action as "buy" | "sell",
    quantity: Number(t.quantity),
    price: Number(t.price),
  }));
  const symbols = [...new Set(trades.map((t) => t.symbol))];
  const [closes, dollarVolume] = await Promise.all([
    loadCloses([...new Set([...symbols, ...benchmarks.map((b) => b.symbol)])]),
    loadDollarVolumes(holdings.map((h) => h.symbol)),
  ]);
  const events = compositionEvents({
    startingBalance: Number(p.starting_balance),
    trades,
    flows: flowsR.rows.map((f) => ({ at: new Date(f.applied_at).toISOString(), amount: Number(f.amount) })),
    closes,
  });

  const days = rows.rows.map((r) => ({
    date: dateText(r.date),
    perf_index: r.perf_index === null ? null : Number(r.perf_index),
    estimated: r.estimated,
  }));
  const openedOn = localDate(new Date(p.created_at));
  const profile = computeProfile({
    today: localDate(now),
    points: sessionPoints(
      openedOn,
      days,
      benchmarks.map((b) => ({ key: b.key, symbol: b.symbol, name: b.name, closes: closes[b.symbol] ?? [] }))
    ),
    holdings,
    cash: Number(p.cash),
    dollarVolume,
    events: events.map((e) => ({ date: localDate(new Date(e.at)), before: e.before, after: e.after })),
    trades,
    scales,
  });
  return {
    portfolio: { id: p.id, name: p.name },
    history_built: days.length > 0,
    scales: { provisional: true },
    ...profile,
  };
};

export class ComparisonError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The owner's portfolio against one market index over a period (spec 41).
 * Null when the portfolio is not the caller's.
 */
export const portfolioIndexComparison = async (
  portfolioId: number,
  userId: number,
  query: { index?: unknown; from?: unknown; to?: unknown }
) => {
  const indices = await loadComparisonIndices();
  const key = typeof query.index === "string" && query.index ? query.index : indices[0].key;
  const index = indices.find((i) => i.key === key);
  if (!index) throw new ComparisonError("UNKNOWN_INDEX");
  const date = (v: unknown) => {
    if (v === undefined || v === "") return null;
    if (typeof v !== "string" || !ISO_DATE.test(v) || Number.isNaN(Date.parse(v))) throw new ComparisonError("INVALID_DATE");
    return v;
  };
  const from = date(query.from);
  const to = date(query.to);
  if (from && to && from >= to) throw new ComparisonError("INVALID_RANGE");

  const p = (await pool.query("SELECT id, name, created_at FROM portfolios WHERE id = $1 AND user_id = $2", [portfolioId, userId])).rows[0];
  if (!p) return null;
  const [rows, closes] = await Promise.all([
    pool.query("SELECT date, perf_index, estimated FROM portfolio_daily_values WHERE portfolio_id = $1 ORDER BY date", [portfolioId]),
    loadCloses([index.symbol]),
  ]);
  const result = compareWithIndex({
    openedOn: localDate(new Date(p.created_at)),
    days: rows.rows.map((r) => ({ date: dateText(r.date), perf_index: r.perf_index === null ? null : Number(r.perf_index), estimated: r.estimated })),
    closes: closes[index.symbol] ?? [],
    from,
    to,
  });
  return {
    portfolio: { id: p.id, name: p.name },
    index: { ...index, source: "etf_proxy", return_type: "price", provisional: true },
    indices: indices.map((i) => ({ key: i.key, symbol: i.symbol, name: i.name })),
    ...result,
  };
};

/**
 * Module 4, Exposure & Characteristics, for the owner
 * (src/performance/exposures.ts). Null when the portfolio is not the caller's.
 */
export const portfolioExposures = async (portfolioId: number, userId: number) => {
  const p = (await pool.query("SELECT id, name, cash FROM portfolios WHERE id = $1 AND user_id = $2", [portfolioId, userId])).rows[0];
  if (!p) return null;
  const lotsR = await pool.query(
    `SELECT w.stock_symbol, w.price_at_time, w.quantity, s.last_price
     FROM watchlist w LEFT JOIN stocks s ON s.stock_symbol = w.stock_symbol
     WHERE w.portfolio_id = $1 ORDER BY w.added_at, w.id`,
    [portfolioId]
  );
  const bySymbol = new Map<string, any[]>();
  for (const lot of lotsR.rows) bySymbol.set(lot.stock_symbol, [...(bySymbol.get(lot.stock_symbol) ?? []), lot]);
  const symbols = [...bySymbol.keys()];
  const [secR, barsR, rulesR] = await Promise.all([
    pool.query("SELECT symbol, name, sic_code, sic_description, market_cap FROM securities WHERE symbol = ANY($1::text[])", [symbols]),
    pool.query(
      `SELECT symbol, close, volume FROM (
         SELECT symbol, date, close, volume, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
         FROM daily_prices WHERE symbol = ANY($1::text[])
       ) x WHERE rn <= 220 ORDER BY symbol, date`,
      [symbols]
    ),
    pool.query("SELECT kind, symbol, sic_from, sic_to, tech FROM tech_classification"),
  ]);
  const sec = new Map(secR.rows.map((r) => [r.symbol, r]));
  const bars = new Map<string, { close: number; volume: number | null }[]>();
  for (const r of barsR.rows) bars.set(r.symbol, [...(bars.get(r.symbol) ?? []), { close: Number(r.close), volume: r.volume === null ? null : Number(r.volume) }]);
  const holdings = symbols.map((symbol) => {
    const lots = bySymbol.get(symbol)!;
    const shares = lots.reduce((t, l) => t + Number(l.quantity), 0);
    const cost = lots.reduce((t, l) => t + Number(l.quantity) * Number(l.price_at_time), 0);
    const priced = lots.find((l) => l.last_price !== null);
    const price = priced ? Number(priced.last_price) : shares ? cost / shares : 0;
    const s = sec.get(symbol);
    return {
      symbol,
      value: shares * price,
      market_cap: s?.market_cap == null ? null : Number(s.market_cap),
      sic: s?.sic_code ?? null,
      bars: bars.get(symbol) ?? [],
    };
  });
  const e = computeExposures({ holdings, cash: Number(p.cash), rules: rulesR.rows as TechRule[] });
  return {
    portfolio: { id: p.id, name: p.name },
    ...e,
    holdings: e.holdings.map((h) => ({ ...h, industry: sec.get(h.symbol)?.sic_description ?? null })),
    not_available: ["dividend", "profitability"],
  };
};
