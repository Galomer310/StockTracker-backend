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
// invested      = what was paid: sum(price_at_time * quantity)
// current_value = what it is worth now, using the cached last price per symbol
//                 and falling back to the purchase price when we have never
//                 fetched that symbol (which scores it as a flat 0%).
//
// Reading last_price from the `stocks` cache rather than calling Polygon keeps
// the leaderboard to a single query no matter how many accounts it lists.
const VALUATION_SELECT = `
  COALESCE(SUM(w.price_at_time * w.quantity), 0) AS invested,
  COALESCE(SUM(COALESCE(s.last_price, w.price_at_time) * w.quantity), 0) AS current_value,
  COUNT(w.id)::int AS holdings_count
`;

// Turn the raw numeric strings pg returns into numbers plus a percentage.
const summarise = (row: any) => {
  const invested = parseFloat(row.invested) || 0;
  const currentValue = parseFloat(row.current_value) || 0;
  const profit = currentValue - invested;
  // Guard against dividing by zero for accounts that hold nothing yet.
  const returnPct = invested > 0 ? (profit / invested) * 100 : 0;
  return {
    invested,
    current_value: currentValue,
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
             ${VALUATION_SELECT}
      FROM users u
      LEFT JOIN watchlist w ON w.user_id = u.id
      LEFT JOIN stocks s    ON s.stock_symbol = w.stock_symbol
      GROUP BY u.id, u.display_name, u.created_at
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
      `SELECT ${VALUATION_SELECT}
       FROM watchlist w
       LEFT JOIN stocks s ON s.stock_symbol = w.stock_symbol
       WHERE w.user_id = $1`,
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
