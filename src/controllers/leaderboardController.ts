import { RequestHandler } from "express";      // Express handler type
import pool from "../config/db";                // Shared PostgreSQL pool
import {
  POSITION_VALUES,
  valuePortfolio,
  publicPortfolio,
} from "./portfolioController";                 // One shared valuation

/* ===========================================================================
   What other people are allowed to see.
   ---------------------------------------------------------------------------
   The rule for this whole file: money is private, percentages are public.

   Only the owner of a portfolio ever receives prices, quantities, cash or any
   absolute figure derived from them. Everyone else receives percentages and
   timestamps. That is enforced HERE, in the responses, not in the frontend:
   hiding a number in React still ships it to the browser, where anyone can
   read it out of the network tab or call the endpoint directly.

   Concretely, a viewer who is not the owner never sees:
     - what a position was bought or sold at
     - how many shares are held
     - cash, starting balance, equity, or profit and loss

   and does see:
     - total return %, each position's gain % and share of the book, and how
       much of the book is sitting in cash
     - every buy and sell with its date, time and reasoning, expressed as the
       % the stock has moved since that trade

   Since portfolios replaced accounts as the unit, everything here is keyed by
   portfolio id: the leaderboard ranks books, not people, so one user's three
   portfolios rank independently.
   =========================================================================== */

// ---------------------------------------------------------------------------
// Portfolio visibility
//
// Every logged-in user can currently open every portfolio. The plan is to gate
// this behind paid tiers that grant a limited number of "exposures", so the
// decision lives in ONE function: change this and every route that reveals
// someone else's holdings is gated at once.
//
// When tiers arrive this becomes async (a subscription and quota lookup), and
// probably records the view so exposures can be counted.
// ---------------------------------------------------------------------------
const canViewPortfolio = (viewerId: number, ownerId: number): boolean => {
  if (viewerId === ownerId) return true; // Always allowed to see your own
  return true;                           // TODO: replace with tier/quota check
};

// How far a stock has moved since a trade was made, as a percentage.
//
// For a buy this is the position's gain or loss to date. For a sell it is what
// the stock has done since it was let go. Either way it says how the decision
// has aged without revealing the price it was made at.
//
// null when the symbol has no cached price: a missing quote should read as
// "unknown", not as 0.00%.
const moveSince = (tradePrice: number, latestPrice: number | null): number | null => {
  if (latestPrice === null || !Number.isFinite(latestPrice)) return null;
  if (!Number.isFinite(tradePrice) || tradePrice <= 0) return null;
  return ((latestPrice - tradePrice) / tradePrice) * 100;
};

// Loads a portfolio with its owner, or responds 404/403 and returns null.
const loadPortfolioForViewer = async (
  portfolioId: number,
  viewerId: number,
  res: any
) => {
  const result = await pool.query(
    `SELECT p.id, p.name, p.starting_balance, p.cash, p.created_at,
            p.user_id, u.display_name,
            COALESCE(v.positions_value, 0) AS positions_value,
            COALESCE(v.holdings_count, 0)  AS holdings_count
     FROM portfolios p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN (${POSITION_VALUES}) v ON v.portfolio_id = p.id
     WHERE p.id = $1`,
    [portfolioId]
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: "Portfolio not found" });
    return null;
  }

  const row = result.rows[0];
  if (!canViewPortfolio(viewerId, row.user_id)) {
    res.status(403).json({ error: "You do not have access to this portfolio" });
    return null;
  }

  return row;
};

// GET LEADERBOARD
// Every portfolio ranked by percentage return since it was opened.
//
// Percentages only, including your own rows: portfolio values are nobody's
// business here, and ranking on them would reward the biggest cheque rather
// than the best decisions. Every book starts from the same $10,000, so the
// percentages are directly comparable.
export const getLeaderboard: RequestHandler = async (req, res, next) => {
  const viewerId = (req as any).user.id;
  try {
    const result = await pool.query(
      `SELECT p.id, p.name, p.starting_balance, p.cash, p.created_at,
              p.user_id, u.display_name,
              COALESCE(v.positions_value, 0) AS positions_value,
              COALESCE(v.holdings_count, 0)  AS holdings_count
       FROM portfolios p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN (${POSITION_VALUES}) v ON v.portfolio_id = p.id`
    );

    const entries = result.rows
      .map((row) => ({
        // The money inside valuePortfolio decides the ranking and is then
        // dropped: only percentages and counts leave the server.
        ...publicPortfolio(valuePortfolio(row)),
        owner: {
          id: row.user_id,
          // display_name is nullable for accounts created before it existed.
          display_name: row.display_name || `Investor #${row.user_id}`,
        },
        is_mine: row.user_id === viewerId,
      }))
      // Rank by percentage return so a cautious book can out-rank a big one.
      .sort((a, b) => b.return_pct - a.return_pct)
      .map((entry, index) => ({ rank: index + 1, ...entry }));

    res.json({ leaderboard: entries });
  } catch (error) {
    console.error("Error building leaderboard:", error);
    next(error);
  }
};

// GET PORTFOLIO
// One portfolio's holdings and summary. Works for your own too, which is what
// the compare view uses so both sides come from an identical shape.
//
// The owner gets prices, quantities and cash. Everyone else gets percentages:
// each position's gain and its share of the book, plus how much is uninvested,
// which conveys how the portfolio is built and how it is doing without
// disclosing its size.
export const getPortfolio: RequestHandler = async (req, res, next) => {
  const viewerId = (req as any).user.id;
  const portfolioId = Number(req.params.id);

  if (!Number.isInteger(portfolioId)) {
    res.status(400).json({ error: "Invalid portfolio id" });
    return;
  }

  try {
    const row = await loadPortfolioForViewer(portfolioId, viewerId, res);
    if (!row) return;

    const isSelf = row.user_id === viewerId;
    const summary = valuePortfolio(row);

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
       WHERE w.portfolio_id = $1
       ORDER BY w.added_at ASC`,
      [portfolioId]
    );

    const holdings = holdingsResult.rows.map((hRow) => {
      const purchasePrice = parseFloat(hRow.price_at_time);
      const latestPrice =
        hRow.last_price !== null ? parseFloat(hRow.last_price) : purchasePrice;
      const quantity = Number(hRow.quantity);
      return {
        id: hRow.id,
        stock_symbol: hRow.stock_symbol,
        price_at_time: purchasePrice,
        latest_price: latestPrice,
        quantity,
        added_at: hRow.added_at,
        industry: hRow.industry,
        profit_loss: (latestPrice - purchasePrice) * quantity,
      };
    });

    // Weight is measured against EQUITY, not against the invested total, so
    // the position weights and the cash weight add up to 100 - which is the
    // point of running the portfolio against a fixed starting balance.
    const equity = summary.equity;

    // Percentage-only projection of each position: what it has done, and how
    // much of the book it represents. Both are ratios, so neither discloses a
    // price or a share count.
    const publicHoldings = holdings.map((h) => ({
      id: h.id,
      stock_symbol: h.stock_symbol,
      industry: h.industry,
      added_at: h.added_at,
      gain_pct: moveSince(h.price_at_time, h.latest_price) ?? 0,
      weight_pct: equity > 0 ? ((h.latest_price * h.quantity) / equity) * 100 : 0,
    }));

    res.json({
      portfolio: {
        id: row.id,
        name: row.name,
        created_at: row.created_at,
      },
      owner: {
        id: row.user_id,
        display_name: row.display_name || `Investor #${row.user_id}`,
      },
      is_self: isSelf,
      summary: isSelf ? summary : publicPortfolio(summary),
      holdings: isSelf
        ? holdings.map((h) => ({
            ...h,
            weight_pct: equity > 0 ? ((h.latest_price * h.quantity) / equity) * 100 : 0,
          }))
        : publicHoldings,
    });
  } catch (error) {
    console.error("Error fetching portfolio:", error);
    next(error);
  }
};

// GET PORTFOLIO JOURNAL
// The portfolio's recorded buys and sells with their reasoning. Public to
// anyone who may view it, so it passes through the same access gate.
//
// Visible to everyone: what was done, to which ticker, when (date and time),
// why, and how the stock has moved since. Visible to the owner alone: the
// price and the size of the trade.
export const getPortfolioJournal: RequestHandler = async (req, res, next) => {
  const viewerId = (req as any).user.id;
  const portfolioId = Number(req.params.id);

  if (!Number.isInteger(portfolioId)) {
    res.status(400).json({ error: "Invalid portfolio id" });
    return;
  }

  try {
    const row = await loadPortfolioForViewer(portfolioId, viewerId, res);
    if (!row) return;

    const isSelf = row.user_id === viewerId;

    // The join carries the cached price so the percentage move since each trade
    // can be computed here - the client is never given the two prices to
    // divide for itself.
    const result = await pool.query(
      `SELECT t.id, t.stock_symbol, t.action, t.quantity, t.price, t.note,
              t.occurred_at, t.created_at, s.last_price
       FROM trade_notes t
       LEFT JOIN stocks s ON s.stock_symbol = t.stock_symbol
       WHERE t.portfolio_id = $1
       ORDER BY t.occurred_at DESC, t.id DESC
       LIMIT 200`,
      [portfolioId]
    );

    res.json({
      portfolio: { id: row.id, name: row.name },
      owner: {
        id: row.user_id,
        display_name: row.display_name || `Investor #${row.user_id}`,
      },
      is_self: isSelf,
      entries: result.rows.map((entryRow) => {
        const tradePrice = parseFloat(entryRow.price);
        const latestPrice =
          entryRow.last_price !== null ? parseFloat(entryRow.last_price) : null;

        const entry: Record<string, unknown> = {
          id: entryRow.id,
          stock_symbol: entryRow.stock_symbol,
          action: entryRow.action,
          note: entryRow.note,
          // When the trade happened, to the minute, and when it was written up.
          occurred_at: entryRow.occurred_at,
          created_at: entryRow.created_at,
          // How the stock has moved since - the public measure of the decision.
          change_pct_since: moveSince(tradePrice, latestPrice),
          // True when the trade was backdated relative to when it was written up,
          // which viewers deserve to see rather than having it quietly smoothed.
          backdated:
            Math.abs(
              new Date(entryRow.created_at).getTime() -
                new Date(entryRow.occurred_at).getTime()
            ) > 60 * 60 * 1000,
        };

        // Size and price of the trade: the owner's business alone.
        if (isSelf) {
          entry.quantity = Number(entryRow.quantity);
          entry.price = tradePrice;
        }

        return entry;
      }),
    });
  } catch (error) {
    console.error("Error fetching journal:", error);
    next(error);
  }
};
