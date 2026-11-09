import pool from "../config/db";
import { localDate } from "../metrics/calendar";
import { fetchUnadjustedCloses } from "../services/massive";
import { computeInsights } from "./insights";
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
          `INSERT INTO daily_prices (symbol, date, close)
           SELECT $1, d, c FROM unnest($2::date[], $3::numeric[]) AS t(d, c)
           ON CONFLICT (symbol, date) DO UPDATE SET close = EXCLUDED.close`,
          [symbol, closes.map((c) => c.date), closes.map((c) => c.close)]
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
    const marks = [...new Set((await loadBenchmarks()).map((b) => b.symbol))];
    const traded = await pool.query("SELECT DISTINCT stock_symbol FROM trade_notes ORDER BY stock_symbol");
    const symbols = [...marks, ...traded.rows.map((r) => r.stock_symbol).filter((s) => !marks.includes(s))];
    const prices = await ensureCloses(symbols, now);
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
        `${rebuilt.length} portfolios rebuilt, ${inconsistent.length} inconsistent`
    );
    return { prices, rebuilt };
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
