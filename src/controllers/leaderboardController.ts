import { RequestHandler } from "express";      // Express handler type
import pool from "../config/db";                // Shared PostgreSQL pool

// ---------------------------------------------------------------------------
// Portfolio visibility
//
// Every logged-in user can currently open every other portfolio. The plan is to
// gate this behind paid tiers that grant a limited number of "exposures", so
// the decision lives in ONE function: change this and every route that reveals
// another user's holdings is gated at once.
//
// When tiers arrive this becomes async (a subscription and quota lookup), and
// probably records the view so exposures can be counted.
// ---------------------------------------------------------------------------
const canViewPortfolio = (viewerId: number, ownerId: number): boolean => {
  if (viewerId === ownerId) return true; // Always allowed to see your own
  return true;                           // TODO: replace with tier/quota check
};

// Shared SQL for valuing a portfolio.
//
// Performance is measured from the TRADE LOG, not from whatever positions
// happen to be open right now. Valuing only open positions was wrong in both
// directions: selling a winner erased the gain from your score, and deleting a
// loser erased the loss. Either made the ranking meaningless.
//
//   invested      = every buy ever made      (capital actually deployed)
//   current_value = open positions at latest price + proceeds from every sale
//   realized      = proceeds from sales, shown separately
//
// A symbol with no cached price falls back to its purchase price, which scores
// it flat rather than inventing a move.
const TRADE_TOTALS = `
  SELECT user_id,
         SUM(CASE WHEN action = 'buy'  THEN quantity * price ELSE 0 END) AS cost_basis,
         SUM(CASE WHEN action = 'sell' THEN quantity * price ELSE 0 END) AS proceeds
  FROM trade_notes
  GROUP BY user_id
`;

const OPEN_POSITIONS = `
  SELECT w.user_id,
         SUM(COALESCE(s.last_price, w.price_at_time) * w.quantity) AS open_value,
         COUNT(w.id)::int AS holdings_count
  FROM watchlist w
  LEFT JOIN stocks s ON s.stock_symbol = w.stock_symbol
  GROUP BY w.user_id
`;

// Turn the raw numeric strings pg returns into numbers plus a percentage.
const summarise = (row: any) => {
  const invested = parseFloat(row.invested) || 0;
  const currentValue = parseFloat(row.current_value) || 0;
  const realized = parseFloat(row.realized) || 0;
  const profit = currentValue - invested;
  // Guard against dividing by zero for accounts that hold nothing yet.
  const returnPct = invested > 0 ? (profit / invested) * 100 : 0;
  return {
    invested,
    current_value: currentValue,
    realized,
    profit,
    return_pct: returnPct,
    holdings_count: row.holdings_count ?? 0,
  };
};

// GET LEADERBOARD
// Every account ranked by percentage return since the account was opened.
export const getLeaderboard: RequestHandler = async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT u.id,
             u.display_name,
             u.created_at,
             COALESCE(t.cost_basis, 0) AS invested,
             COALESCE(o.open_value, 0) + COALESCE(t.proceeds, 0) AS current_value,
             COALESCE(t.proceeds, 0) AS realized,
             COALESCE(o.holdings_count, 0) AS holdings_count
      FROM users u
      LEFT JOIN (${TRADE_TOTALS}) t ON t.user_id = u.id
      LEFT JOIN (${OPEN_POSITIONS}) o ON o.user_id = u.id
    `);

    const entries = result.rows
      .map((row) => ({
        id: row.id,
        // display_name is nullable for accounts created before it existed.
        display_name: row.display_name || `Investor #${row.id}`,
        member_since: row.created_at,
        ...summarise(row),
      }))
      // Rank by percentage return so a small portfolio can out-rank a large one.
      .sort((a, b) => b.return_pct - a.return_pct)
      .map((entry, index) => ({ rank: index + 1, ...entry }));

    res.json({ leaderboard: entries });
  } catch (error) {
    console.error("Error building leaderboard:", error);
    next(error);
  }
};

// GET USER PORTFOLIO
// One account's holdings and summary. Works for your own id too, which is what
// the compare view uses so both sides come from an identical shape.
export const getUserPortfolio: RequestHandler = async (req, res, next) => {
  const viewerId = (req as any).user.id;
  const ownerId = Number(req.params.id);

  if (!Number.isInteger(ownerId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  if (!canViewPortfolio(viewerId, ownerId)) {
    res.status(403).json({ error: "You do not have access to this portfolio" });
    return;
  }

  try {
    const userResult = await pool.query(
      "SELECT id, display_name, created_at FROM users WHERE id = $1",
      [ownerId]
    );
    if (userResult.rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const owner = userResult.rows[0];

    // Individual holdings, each valued against the cached latest price.
    const holdingsResult = await pool.query(
      `SELECT w.id,
              w.stock_symbol,
              w.price_at_time,
              w.quantity,
              w.added_at,
              w.industry,
              s.last_price
       FROM watchlist w
       LEFT JOIN stocks s ON s.stock_symbol = w.stock_symbol
       WHERE w.user_id = $1
       ORDER BY w.added_at ASC`,
      [ownerId]
    );

    const holdings = holdingsResult.rows.map((row) => {
      const purchasePrice = parseFloat(row.price_at_time);
      const latestPrice =
        row.last_price !== null ? parseFloat(row.last_price) : purchasePrice;
      const quantity = Number(row.quantity);
      return {
        id: row.id,
        stock_symbol: row.stock_symbol,
        price_at_time: purchasePrice,
        latest_price: latestPrice,
        quantity,
        added_at: row.added_at,
        industry: row.industry,
        profit_loss: (latestPrice - purchasePrice) * quantity,
      };
    });

    // Recompute the summary with the same SQL the leaderboard uses, so a user's
    // numbers can never disagree between the two screens.
    const summaryResult = await pool.query(
      `SELECT COALESCE(t.cost_basis, 0) AS invested,
              COALESCE(o.open_value, 0) + COALESCE(t.proceeds, 0) AS current_value,
              COALESCE(t.proceeds, 0) AS realized,
              COALESCE(o.holdings_count, 0) AS holdings_count
       FROM (SELECT $1::int AS uid) me
       LEFT JOIN (${TRADE_TOTALS}) t ON t.user_id = me.uid
       LEFT JOIN (${OPEN_POSITIONS}) o ON o.user_id = me.uid`,
      [ownerId]
    );

    res.json({
      user: {
        id: owner.id,
        display_name: owner.display_name || `Investor #${owner.id}`,
        member_since: owner.created_at,
      },
      is_self: viewerId === ownerId,
      summary: summarise(summaryResult.rows[0]),
      holdings,
    });
  } catch (error) {
    console.error("Error fetching user portfolio:", error);
    next(error);
  }
};

// GET USER JOURNAL
// The owner's recorded buys and sells with their reasoning. Public to anyone
// who may view the portfolio, so it passes through the same access gate.
export const getUserJournal: RequestHandler = async (req, res, next) => {
  const viewerId = (req as any).user.id;
  const ownerId = Number(req.params.id);

  if (!Number.isInteger(ownerId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  if (!canViewPortfolio(viewerId, ownerId)) {
    res.status(403).json({ error: "You do not have access to this journal" });
    return;
  }

  try {
    const owner = await pool.query(
      "SELECT id, display_name FROM users WHERE id = $1",
      [ownerId]
    );
    if (owner.rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const result = await pool.query(
      `SELECT id, stock_symbol, action, quantity, price, note, occurred_at, created_at
       FROM trade_notes
       WHERE user_id = $1
       ORDER BY occurred_at DESC, id DESC
       LIMIT 200`,
      [ownerId]
    );

    res.json({
      user: {
        id: owner.rows[0].id,
        display_name: owner.rows[0].display_name || `Investor #${owner.rows[0].id}`,
      },
      is_self: viewerId === ownerId,
      entries: result.rows.map((row) => ({
        id: row.id,
        stock_symbol: row.stock_symbol,
        action: row.action,
        quantity: Number(row.quantity),
        price: parseFloat(row.price),
        note: row.note,
        occurred_at: row.occurred_at,
        created_at: row.created_at,
        // True when the trade was backdated relative to when it was written up,
        // which viewers deserve to see rather than having it quietly smoothed.
        backdated:
          Math.abs(
            new Date(row.created_at).getTime() - new Date(row.occurred_at).getTime()
          ) > 60 * 60 * 1000,
      })),
    });
  } catch (error) {
    console.error("Error fetching journal:", error);
    next(error);
  }
};
