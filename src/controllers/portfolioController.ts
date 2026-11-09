import { RequestHandler } from "express";      // Express handler type
import pool from "../config/db";                // Shared PostgreSQL pool
import {
  STARTING_CASH,
  portfolioLimitFor,
  MAX_PORTFOLIO_NAME_LENGTH,
} from "../config/portfolio";
import { syncProgressionSafely } from "../progression/service"; // Achievements and XP

/* ===========================================================================
   Portfolios.
   ---------------------------------------------------------------------------
   A user runs up to three books, switches between them in their personal area,
   and every trade lands in whichever one is open.

   Valuation, in one place because four screens depend on agreeing about it:

     equity        = cash + market value of the open positions
     capital_base  = starting_balance, grown by any capital growth rewards
     return_pct    = (equity - capital_base) / capital_base * 100

   A capital growth reward (src/rewards) adds cash and grows capital_base by
   the same factor, so it never moves the return and never counts as profit.
   Until a portfolio's first reward, capital_base is its starting_balance.

   Measuring against the capital base rather than against what was spent is the
   whole point of giving every portfolio the same opening cash. Money left
   sitting in cash is part of the result: a portfolio that deployed a tenth of
   its funds into a stock that doubled is up 10%, not 100%.
   =========================================================================== */

// Market value of the open positions, per portfolio. A symbol with no cached
// quote falls back to what was paid, which scores it flat rather than
// inventing a move.
export const POSITION_VALUES = `
  SELECT w.portfolio_id,
         SUM(COALESCE(s.last_price, w.price_at_time) * w.quantity) AS positions_value,
         COUNT(w.id)::int AS holdings_count
  FROM watchlist w
  LEFT JOIN stocks s ON s.stock_symbol = w.stock_symbol
  GROUP BY w.portfolio_id
`;

// Turns a joined portfolio row into the owner's view. Contains money, so it
// must be passed through publicPortfolio before being shown to anyone else.
export const valuePortfolio = (row: any) => {
  const startingBalance = parseFloat(row.starting_balance) || 0;
  // Queries select COALESCE(p.capital_base, p.starting_balance) AS capital_base.
  const capitalBase = parseFloat(row.capital_base) || startingBalance;
  const cash = parseFloat(row.cash) || 0;
  const positionsValue = parseFloat(row.positions_value) || 0;
  const equity = cash + positionsValue;
  const returnPct = capitalBase > 0 ? ((equity - capitalBase) / capitalBase) * 100 : 0;

  return {
    id: row.id,
    name: row.name,
    starting_balance: startingBalance,
    /** starting_balance plus capital growth rewards; what the return is measured against. */
    capital_base: capitalBase,
    cash,
    positions_value: positionsValue,
    equity,
    // Investment profit only: capital added by rewards is in capital_base.
    profit: equity - capitalBase,
    return_pct: returnPct,
    holdings_count: row.holdings_count ?? 0,
    // What share of the book is still uninvested. A percentage, so unlike the
    // cash figure itself this is safe to show anyone - and it is the single
    // most telling thing about how someone is playing.
    cash_weight_pct: equity > 0 ? (cash / equity) * 100 : 0,
    created_at: row.created_at,
  };
};

// The same portfolio with every monetary figure stripped out.
export const publicPortfolio = (full: ReturnType<typeof valuePortfolio>) => ({
  id: full.id,
  name: full.name,
  return_pct: full.return_pct,
  holdings_count: full.holdings_count,
  cash_weight_pct: full.cash_weight_pct,
  created_at: full.created_at,
});

const SPARKLINE_POINTS = 60;

// Evenly spaced points from a series, always keeping the last one.
export const thin = (values: number[], max: number): number[] => {
  if (values.length <= max) return values;
  const step = (values.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => values[Math.round(i * step)]);
};

// GET /portfolios
// Every portfolio the caller owns, valued, newest last. This is what fills the
// switcher in the personal area.
export const listPortfolios: RequestHandler = async (req, res, next) => {
  const userId = (req as any).user.id;
  try {
    const result = await pool.query(
      `SELECT p.id, p.name, p.status, p.starting_balance, COALESCE(p.capital_base, p.starting_balance) AS capital_base, p.cash, p.created_at,
              COALESCE(v.positions_value, 0) AS positions_value,
              COALESCE(v.holdings_count, 0)  AS holdings_count,
              GREATEST(p.created_at, (SELECT MAX(t.created_at) FROM trade_notes t WHERE t.portfolio_id = p.id)) AS last_updated
       FROM portfolios p
       LEFT JOIN (${POSITION_VALUES}) v ON v.portfolio_id = p.id
       WHERE p.user_id = $1
       ORDER BY p.created_at ASC, p.id ASC`,
      [userId]
    );

    // The carousel's sparkline: each portfolio's genuine performance index
    // (src/performance), thinned to at most SPARKLINE_POINTS, ending on the
    // latest value. Empty until the valuation job has run.
    const ids = result.rows.map((r) => r.id);
    const series = ids.length
      ? await pool.query(
          `SELECT portfolio_id, perf_index FROM portfolio_daily_values
           WHERE portfolio_id = ANY($1::int[]) AND perf_index IS NOT NULL
           ORDER BY portfolio_id, date`,
          [ids]
        )
      : { rows: [] as any[] };
    const byPortfolio = new Map<number, number[]>();
    for (const r of series.rows) byPortfolio.set(r.portfolio_id, [...(byPortfolio.get(r.portfolio_id) ?? []), Number(r.perf_index)]);

    res.json({
      portfolios: result.rows.map((row) => ({
        ...valuePortfolio(row),
        status: row.status,
        last_updated: row.last_updated,
        sparkline: thin(byPortfolio.get(row.id) ?? [], SPARKLINE_POINTS),
      })),
      limit: portfolioLimitFor(userId),
      starting_cash: STARTING_CASH,
    });
  } catch (error) {
    console.error("Error listing portfolios:", error);
    next(error);
  }
};

// POST /portfolios
// Opens a new book with its starting cash.
export const createPortfolio: RequestHandler = async (req, res, next) => {
  const userId = (req as any).user.id;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";

  if (!name) {
    res.status(400).json({ error: "Give the portfolio a name." });
    return;
  }
  if (name.length > MAX_PORTFOLIO_NAME_LENGTH) {
    res.status(400).json({
      error: `A portfolio name must be ${MAX_PORTFOLIO_NAME_LENGTH} characters or fewer.`,
    });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the ACCOUNT, then count. Two requests arriving together would
    // otherwise both see two portfolios and both create a third, putting the
    // user over the limit.
    //
    // The lock has to be taken on users: a row lock only blocks rows that
    // already exist, so locking the portfolios themselves would not stop a
    // concurrent INSERT of a new one. (It cannot be `COUNT(*) ... FOR UPDATE`
    // either - Postgres rejects row locking alongside an aggregate.)
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);

    const existing = await client.query(
      "SELECT COUNT(*)::int AS count FROM portfolios WHERE user_id = $1",
      [userId]
    );
    const limit = portfolioLimitFor(userId);
    if (existing.rows[0].count >= limit) {
      await client.query("ROLLBACK");
      res.status(409).json({
        error: `You can hold ${limit} portfolios. Higher tiers will allow more.`,
        code: "PORTFOLIO_LIMIT_REACHED",
      });
      return;
    }

    const inserted = await client.query(
      `INSERT INTO portfolios (user_id, name, starting_balance, cash)
       VALUES ($1, $2, $3, $3)
       RETURNING id, name, starting_balance, cash, created_at`,
      [userId, name, STARTING_CASH]
    );

    await client.query("COMMIT");

    await syncProgressionSafely(userId); // portfolio-count achievements

    res.status(201).json({
      portfolio: valuePortfolio({
        ...inserted.rows[0],
        positions_value: 0,
        holdings_count: 0,
      }),
    });
  } catch (error: any) {
    await client.query("ROLLBACK").catch(() => undefined);
    // 23505 is the unique violation on (user_id, name).
    if (error?.code === "23505") {
      res.status(409).json({ error: "You already have a portfolio with that name." });
      return;
    }
    console.error("Error creating portfolio:", error);
    next(error);
  } finally {
    client.release();
  }
};
