import { RequestHandler } from "express";      // Import Express types
import pool from "../config/db";                // Import the PostgreSQL pool from the config
import dotenv from "dotenv";                    // Import dotenv to load environment variables
import { fetchQuote } from "../services/massive"; // Market data client (budgeted + serialised)

dotenv.config();                                // Load environment variables

/* ===========================================================================
   Holdings, cash and the trade journal.
   ---------------------------------------------------------------------------
   `watchlist` holds CURRENT positions. `trade_notes` records what was done and
   why, and outlives the position: selling shrinks or deletes the holding row,
   but the trade and its thesis stay readable by other users.

   Everything belongs to a portfolio, and every portfolio has a cash balance.
   A buy takes money out of it, a sale puts money back, and cash can never go
   negative - which is what stops anyone buying an unlimited number of shares
   and makes each position's weight a real percentage of a real book.

   Every buy and sell therefore writes THREE things in one transaction: the
   position, the journal entry, and the cash. A trade that moved the cash but
   left no record, or a record with no money behind it, would be worse than
   failing the request outright.
   =========================================================================== */

// A thesis is required on every trade, so the public journal never has an
// entry with no reasoning behind it.
const MAX_NOTE_LENGTH = 2000;

// How long after a buy it may still be taken back.
//
// There is no edit: a recorded trade cannot be rewritten, because an editable
// cost basis let anyone manufacture whatever return they liked after the fact.
// The only actions on a position are buy and sell.
//
// What remains is a brief window to undo a buy you have just made - the wrong
// ticker, the wrong quantity - before anyone has seen it. It is deliberately
// short: long enough to catch a slip you notice immediately, too short to be
// used for quietly dropping a position that started to move against you. After
// it closes the record stands, and the only way out is a sale.
//
// Measured from when the buy was RECORDED, not from the date it is dated.
// Those are the same moment for an ordinary purchase, but manual entries -
// no longer accepted, though older rows remain - could be backdated to a
// trade made years ago, and measuring from added_at there
// would close the window before the row even existed, leaving a mistyped
// import permanently stuck in the portfolio.
const REMOVAL_WINDOW_MS = 60 * 1000; // 60 seconds

const withinRemovalWindow = (recordedAt: Date | string): boolean =>
  Date.now() - new Date(recordedAt).getTime() < REMOVAL_WINDOW_MS;

const validateNote = (raw: unknown): { note: string } | { error: string } => {
  const note = typeof raw === "string" ? raw.trim() : "";
  if (!note) return { error: "A note is required. Explain your reasoning for this trade." };
  if (note.length > MAX_NOTE_LENGTH) {
    return { error: `Note must be ${MAX_NOTE_LENGTH} characters or fewer.` };
  }
  return { note };
};

// Money is stored as NUMERIC and read back as a string. Rounding to cents on
// the way in keeps the cash balance from drifting into fractions of a penny
// that no screen can display.
const money = (value: number): number => Math.round(value * 100) / 100;

// The price a trade executes at. Always the server's own quote, never a figure
// from the request: a price the client chooses is a return the client chooses,
// and the leaderboard ranks exactly that.
//
// Uses the cached price where possible; otherwise spends one request.
const marketPrice = async (symbol: string): Promise<number> => {
  const cached = await pool.query(
    "SELECT last_price FROM stocks WHERE stock_symbol = $1 AND updated_at > NOW() - INTERVAL '24 hours'",
    [symbol]
  );
  if (cached.rows.length > 0) return parseFloat(cached.rows[0].last_price);

  const quote = await fetchQuote(symbol);
  if (!quote.price) throw new Error("Invalid stock data");
  await pool.query(
    `INSERT INTO stocks (stock_symbol, last_price, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (stock_symbol)
     DO UPDATE SET last_price = $2, updated_at = NOW()`,
    [symbol, quote.price]
  );
  return quote.price;
};

// Which portfolio this request is acting on.
//
// The client sends it as a header on every call, because "which book am I
// looking at" is context for the whole session rather than a property of one
// request. An explicit portfolio_id in the body or query wins, so a form can
// still target a specific book.
const requestedPortfolioId = (req: any): number | null => {
  const raw =
    req.body?.portfolio_id ?? req.query?.portfolio_id ?? req.get("X-Portfolio-Id");
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// Resolves the portfolio for a request and confirms the caller owns it.
// Responds and returns null when it cannot, so callers just `return`.
const resolvePortfolio = async (
  req: any,
  res: any,
  client: { query: typeof pool.query } = pool
): Promise<{ id: number; name: string; cash: number } | null> => {
  const userId = req.user.id;
  const portfolioId = requestedPortfolioId(req);

  if (portfolioId === null) {
    res.status(400).json({
      error: "No portfolio selected. Choose one in your dashboard first.",
      code: "NO_PORTFOLIO",
    });
    return null;
  }

  const found = await client.query(
    "SELECT id, name, cash FROM portfolios WHERE id = $1 AND user_id = $2",
    [portfolioId, userId]
  );
  if (found.rows.length === 0) {
    // Not found and not-yours are answered identically, so this cannot be used
    // to discover which portfolio ids exist.
    res.status(404).json({ error: "Portfolio not found.", code: "NO_PORTFOLIO" });
    return null;
  }

  return {
    id: found.rows[0].id,
    name: found.rows[0].name,
    cash: parseFloat(found.rows[0].cash),
  };
};

// GET WATCHLIST CONTROLLER
// Holdings and cash for the portfolio currently open.
export const getWatchlist: RequestHandler = async (req, res, next) => {
  try {
    const portfolio = await resolvePortfolio(req, res);
    if (!portfolio) return;

    // recorded_at rides along so the client can show the "undo buy" button for
    // exactly as long as the server will honour it. Without it the dashboard
    // would have to guess from added_at, which is the trade's date and can be
    // backdated years into the past.
    const result = await pool.query(
      `SELECT w.*, t.created_at AS recorded_at
       FROM watchlist w
       LEFT JOIN trade_notes t ON t.id = w.trade_note_id
       WHERE w.portfolio_id = $1
       ORDER BY w.added_at ASC`,
      [portfolio.id]
    );
    const watchlist = result.rows;

    // Total cost of the open positions. Kept for the dashboard header, which
    // has always shown what is currently deployed.
    const totalPrice = watchlist.reduce((sum: number, item: any) => {
      return sum + parseFloat(item.price_at_time) * Number(item.quantity);
    }, 0);

    res.json({
      total: totalPrice,
      cash: portfolio.cash,
      portfolio: { id: portfolio.id, name: portfolio.name },
      watchlist,
    });
  } catch (error) {
    console.error("Error fetching watchlist:", error);
    next(error);
  }
};

// ADD TO WATCHLIST CONTROLLER
// Records a buy: creates the holding and its journal entry, and pays for it
// out of the portfolio's cash.
export const addToWatchlist: RequestHandler = async (req, res, next): Promise<void> => {
  const { stock_symbol, quantity, industry, manual, note } = req.body;
  const userId = (req as any).user.id;

  // Manual entry used to take its price and date from the request, so anyone
  // could "buy" at a price of their choosing on a day of their choosing and
  // rank on the return. Every position now opens at the market price, today.
  // Refused rather than ignored: quietly buying at today's price would record
  // a trade the caller did not ask for.
  if (manual) {
    res.status(400).json({
      error: "Manual entry is no longer supported. Positions open at the market price.",
      code: "MANUAL_ENTRY_REMOVED",
    });
    return;
  }

  if (!stock_symbol) {
    res.status(400).json({ error: "Stock symbol is required" });
    return;
  }

  const noteResult = validateNote(note);
  if ("error" in noteResult) {
    res.status(400).json({ error: noteResult.error });
    return;
  }

  const symbol = String(stock_symbol).toUpperCase();
  const qty = quantity ? parseInt(quantity) : 1;
  if (!Number.isInteger(qty) || qty < 1) {
    res.status(400).json({ error: "Quantity must be a positive whole number" });
    return;
  }

  const portfolio = await resolvePortfolio(req, res);
  if (!portfolio) return;

  const client = await pool.connect();
  try {
    const currentPrice = await marketPrice(symbol);
    const timestamp = new Date().toISOString();

    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      res.status(400).json({ error: "Price must be greater than zero" });
      return;
    }

    const cost = money(currentPrice * qty);

    await client.query("BEGIN");

    // Lock the portfolio row and re-read the balance INSIDE the transaction.
    // The copy read earlier is only good enough to render a form: two buys
    // submitted at once would both pass a check made against it and together
    // overdraw the account.
    const locked = await client.query(
      "SELECT cash FROM portfolios WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [portfolio.id, userId]
    );
    if (locked.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Portfolio not found.", code: "NO_PORTFOLIO" });
      return;
    }

    const cash = parseFloat(locked.rows[0].cash);
    if (cost > cash) {
      await client.query("ROLLBACK");
      res.status(400).json({
        error: `Not enough cash. ${qty} ${symbol} at $${currentPrice.toFixed(2)} costs $${cost.toFixed(
          2
        )}, and ${portfolio.name} has $${cash.toFixed(2)} available.`,
        code: "INSUFFICIENT_CASH",
        cash,
        cost,
      });
      return;
    }

    // Journal entry first, so the holding can point at it. The link is what
    // lets a later removal keep the two in step rather than drifting.
    const noteRow = await client.query(
      `INSERT INTO trade_notes (user_id, portfolio_id, stock_symbol, action, quantity, price, note, occurred_at)
       VALUES ($1, $2, $3, 'buy', $4, $5, $6, $7)
       RETURNING id`,
      [userId, portfolio.id, symbol, qty, currentPrice, noteResult.note, timestamp]
    );

    await client.query(
      `INSERT INTO watchlist (user_id, portfolio_id, stock_symbol, price_at_time, quantity, added_at, industry, trade_note_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, portfolio.id, symbol, currentPrice, qty, timestamp, industry || null, noteRow.rows[0].id]
    );

    // Pay for it. The CHECK on the column is the last line of defence: if this
    // ever went negative the insert would fail rather than quietly allowing it.
    const updated = await client.query(
      "UPDATE portfolios SET cash = cash - $1 WHERE id = $2 RETURNING cash",
      [cost, portfolio.id]
    );

    await client.query("COMMIT");

    res.json({
      message: `Bought ${qty} ${symbol} at ${currentPrice}`,
      stock_symbol: symbol,
      quantity: qty,
      price: currentPrice,
      cost,
      cash_remaining: parseFloat(updated.rows[0].cash),
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Error adding to watchlist:", error);
    next(error);
  } finally {
    client.release();
  }
};

// SELL HOLDING CONTROLLER
// Records a sale: reduces or closes the position, writes the journal entry,
// and credits the proceeds back to the portfolio's cash.
//
// The sale executes at the market price, exactly as a buy does. Any price in
// the request body is ignored: accepting one let anyone sell a single share
// for a million dollars and take the top of the leaderboard.
export const sellHolding: RequestHandler = async (req, res, next): Promise<void> => {
  const { id } = req.params;
  const { quantity, note } = req.body;
  const userId = (req as any).user.id;

  const noteResult = validateNote(note);
  if ("error" in noteResult) {
    res.status(400).json({ error: noteResult.error });
    return;
  }

  const sellQty = parseInt(quantity);
  if (!Number.isInteger(sellQty) || sellQty < 1) {
    res.status(400).json({ error: "Quantity must be a positive whole number" });
    return;
  }

  const client = await pool.connect();
  try {
    // Price the sale before the transaction opens. A quote can wait in the
    // market data queue, and the position should not sit locked while it does.
    // The symbol on a holding never changes, so it is safe to read it first.
    const owned = await client.query(
      "SELECT stock_symbol FROM watchlist WHERE id = $1 AND user_id = $2",
      [id, userId]
    );
    if (owned.rows.length === 0) {
      res.status(404).json({ error: "Holding not found" });
      return;
    }
    const salePrice = await marketPrice(owned.rows[0].stock_symbol);
    if (!Number.isFinite(salePrice) || salePrice <= 0) {
      res.status(502).json({ error: "No market price is available for this stock right now." });
      return;
    }

    await client.query("BEGIN");

    // Lock the row so two concurrent sells cannot both pass the quantity check.
    // The holding carries its own portfolio_id, so the sale credits the book
    // that owns the position rather than whichever one happens to be open.
    const held = await client.query(
      "SELECT id, stock_symbol, quantity, portfolio_id FROM watchlist WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [id, userId]
    );
    if (held.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Holding not found" });
      return;
    }

    const holding = held.rows[0];
    const heldQty = Number(holding.quantity);
    if (sellQty > heldQty) {
      await client.query("ROLLBACK");
      res.status(400).json({
        error: `You only hold ${heldQty} share${heldQty === 1 ? "" : "s"} of ${holding.stock_symbol}.`,
      });
      return;
    }

    const closesPosition = sellQty === heldQty;
    if (closesPosition) {
      await client.query("DELETE FROM watchlist WHERE id = $1", [id]);
    } else {
      await client.query("UPDATE watchlist SET quantity = quantity - $1 WHERE id = $2", [
        sellQty,
        id,
      ]);
    }

    await client.query(
      `INSERT INTO trade_notes (user_id, portfolio_id, stock_symbol, action, quantity, price, note, occurred_at)
       VALUES ($1, $2, $3, 'sell', $4, $5, $6, NOW())`,
      [userId, holding.portfolio_id, holding.stock_symbol, sellQty, salePrice, noteResult.note]
    );

    const proceeds = money(salePrice * sellQty);
    const updated = await client.query(
      "UPDATE portfolios SET cash = cash + $1 WHERE id = $2 RETURNING cash",
      [proceeds, holding.portfolio_id]
    );

    await client.query("COMMIT");

    res.json({
      message: `Sold ${sellQty} ${holding.stock_symbol} at ${salePrice}`,
      closed: closesPosition,
      remaining: closesPosition ? 0 : heldQty - sellQty,
      price: salePrice,
      proceeds,
      cash_remaining: parseFloat(updated.rows[0].cash),
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Error selling holding:", error);
    next(error);
  } finally {
    client.release();
  }
};

// REMOVE FROM WATCHLIST CONTROLLER
// Deletes a just-bought entry, together with the journal entry it created and
// the feed post that entry is, and refunds what it cost - because the trade
// never happened.
//
// Only available inside the removal window. Without that limit this was a way
// to quietly erase losing positions and keep only the winners, which made the
// leaderboard meaningless. After the window the only way out is a sale, which
// is recorded.
export const removeFromWatchlist: RequestHandler = async (req, res, next): Promise<void> => {
  const { id } = req.params;
  const userId = (req as any).user.id;
  if (!id) {
    res.status(400).json({ error: "Watchlist item id is required" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // The journal entry's created_at is when the buy was actually recorded,
    // which is what the window is measured from. FOR UPDATE OF w because the
    // nullable side of an outer join cannot be locked.
    const existing = await client.query(
      `SELECT w.id, w.added_at, w.trade_note_id, w.stock_symbol, w.portfolio_id,
              w.price_at_time, w.quantity, t.created_at AS recorded_at
       FROM watchlist w
       LEFT JOIN trade_notes t ON t.id = w.trade_note_id
       WHERE w.id = $1 AND w.user_id = $2
       FOR UPDATE OF w`,
      [id, userId]
    );
    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Watchlist item not found" });
      return;
    }

    const row = existing.rows[0];
    if (!withinRemovalWindow(row.recorded_at ?? row.added_at)) {
      await client.query("ROLLBACK");
      res.status(409).json({
        error: `${row.stock_symbol} can no longer be removed. A buy can be taken back for one minute; after that it is part of your public record. Sell the position instead - that is recorded honestly.`,
        code: "REMOVAL_WINDOW_CLOSED",
      });
      return;
    }

    await client.query("DELETE FROM watchlist WHERE id = $1", [id]);
    // Remove the buy entry too: this is "I typed this wrong", so the journal
    // should not keep claiming the trade happened.
    if (row.trade_note_id) {
      await client.query("DELETE FROM trade_notes WHERE id = $1 AND user_id = $2", [
        row.trade_note_id,
        userId,
      ]);
    }

    // Give the money back, at exactly what was taken.
    const refund = money(parseFloat(row.price_at_time) * Number(row.quantity));
    const updated = await client.query(
      "UPDATE portfolios SET cash = cash + $1 WHERE id = $2 RETURNING cash",
      [refund, row.portfolio_id]
    );

    await client.query("COMMIT");
    res.json({
      message: "The purchase has been taken back, and the cash returned.",
      refund,
      cash_remaining: updated.rows[0] ? parseFloat(updated.rows[0].cash) : undefined,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Error removing from watchlist:", error);
    next(error);
  } finally {
    client.release();
  }
};

// There is deliberately no update controller.
//
// Editing a holding used to be possible inside a correction window, which also
// rewrote the matching journal entry. It has been removed: a position now
// changes only through a buy or a sell, both of which are recorded with their
// date, time and reasoning, and both of which move the portfolio's cash.
