import { RequestHandler } from "express";      // Import Express types
import pool from "../config/db";                // Import the PostgreSQL pool from the config
import dotenv from "dotenv";                    // Import dotenv to load environment variables
import { fetchQuote } from "../services/alphaVantage"; // Market data client (budgeted + serialised)

dotenv.config();                                // Load environment variables

/* ===========================================================================
   Holdings and the trade journal.
   ---------------------------------------------------------------------------
   `watchlist` holds CURRENT positions. `trade_notes` records what was done and
   why, and outlives the position: selling shrinks or deletes the holding row,
   but the trade and its thesis stay readable by other users.

   Every buy and sell writes both tables in one transaction. A trade that
   appeared in the portfolio without its reasoning, or a thesis with no trade,
   would both be worse than failing the request outright.
   =========================================================================== */

// A thesis is required on every trade, so the public journal never has an
// entry with no reasoning behind it.
const MAX_NOTE_LENGTH = 2000;

const validateNote = (raw: unknown): { note: string } | { error: string } => {
  const note = typeof raw === "string" ? raw.trim() : "";
  if (!note) return { error: "A note is required. Explain your reasoning for this trade." };
  if (note.length > MAX_NOTE_LENGTH) {
    return { error: `Note must be ${MAX_NOTE_LENGTH} characters or fewer.` };
  }
  return { note };
};

// GET WATCHLIST CONTROLLER
// Retrieves all holdings for the authenticated user
export const getWatchlist: RequestHandler = async (req, res, next) => {
  try {
    const userId = (req as any).user.id;
    const result = await pool.query(
      "SELECT * FROM watchlist WHERE user_id = $1 ORDER BY added_at ASC",
      [userId]
    );
    const watchlist = result.rows;

    // Total invested across the portfolio
    const totalPrice = watchlist.reduce((sum: number, item: any) => {
      return sum + parseFloat(item.price_at_time) * Number(item.quantity);
    }, 0);

    res.json({ total: totalPrice, watchlist });
  } catch (error) {
    console.error("Error fetching watchlist:", error);
    next(error);
  }
};

// ADD TO WATCHLIST CONTROLLER
// Records a buy: creates the holding and its journal entry together.
export const addToWatchlist: RequestHandler = async (req, res, next): Promise<void> => {
  const { stock_symbol, quantity, industry, price_at_time, added_at, manual, note } = req.body;
  const userId = (req as any).user.id;

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

  const client = await pool.connect();
  try {
    let currentPrice: number;
    let timestamp: string;

    if (manual) {
      // Manual entry supplies its own price and (possibly backdated) date
      if (!price_at_time || !added_at) {
        res.status(400).json({ error: "Manual entry requires price and added_at date." });
        return;
      }
      currentPrice = parseFloat(price_at_time);
      timestamp = added_at;
    } else {
      // Use the cached price where possible; otherwise spend one request.
      const cached = await client.query(
        "SELECT last_price FROM stocks WHERE stock_symbol = $1 AND updated_at > NOW() - INTERVAL '24 hours'",
        [symbol]
      );
      if (cached.rows.length > 0) {
        currentPrice = parseFloat(cached.rows[0].last_price);
      } else {
        const quote = await fetchQuote(symbol);
        currentPrice = quote.price;
        if (!currentPrice) throw new Error("Invalid stock data");
        await client.query(
          `INSERT INTO stocks (stock_symbol, last_price, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (stock_symbol)
           DO UPDATE SET last_price = $2, updated_at = NOW()`,
          [symbol, currentPrice]
        );
      }
      timestamp = new Date().toISOString();
    }

    await client.query("BEGIN");

    await client.query(
      `INSERT INTO watchlist (user_id, stock_symbol, price_at_time, quantity, added_at, industry)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, symbol, currentPrice, qty, timestamp, industry || null]
    );

    await client.query(
      `INSERT INTO trade_notes (user_id, stock_symbol, action, quantity, price, note, occurred_at)
       VALUES ($1, $2, 'buy', $3, $4, $5, $6)`,
      [userId, symbol, qty, currentPrice, noteResult.note, timestamp]
    );

    await client.query("COMMIT");

    res.json({
      message: `Bought ${qty} ${symbol} at ${currentPrice}`,
      stock_symbol: symbol,
      quantity: qty,
      price: currentPrice,
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
// Records a sale: reduces or closes the position and writes the journal entry.
// Distinct from removeFromWatchlist, which deletes a mistyped row without
// claiming a trade happened.
export const sellHolding: RequestHandler = async (req, res, next): Promise<void> => {
  const { id } = req.params;
  const { quantity, price, note } = req.body;
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

  const salePrice = parseFloat(price);
  if (!Number.isFinite(salePrice) || salePrice <= 0) {
    res.status(400).json({ error: "A valid sale price is required" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the row so two concurrent sells cannot both pass the quantity check
    const held = await client.query(
      "SELECT id, stock_symbol, quantity FROM watchlist WHERE id = $1 AND user_id = $2 FOR UPDATE",
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
      `INSERT INTO trade_notes (user_id, stock_symbol, action, quantity, price, note, occurred_at)
       VALUES ($1, $2, 'sell', $3, $4, $5, NOW())`,
      [userId, holding.stock_symbol, sellQty, salePrice, noteResult.note]
    );

    await client.query("COMMIT");

    res.json({
      message: `Sold ${sellQty} ${holding.stock_symbol} at ${salePrice}`,
      closed: closesPosition,
      remaining: closesPosition ? 0 : heldQty - sellQty,
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
// Deletes a mistyped entry. Deliberately does NOT write a journal entry: this
// is "I typed this wrong", not "I sold this". Use sellHolding for a real exit.
export const removeFromWatchlist: RequestHandler = async (req, res, next): Promise<void> => {
  const { id } = req.params;
  const userId = (req as any).user.id;
  if (!id) {
    res.status(400).json({ error: "Watchlist item id is required" });
    return;
  }
  try {
    const result = await pool.query(
      "DELETE FROM watchlist WHERE id = $1 AND user_id = $2",
      [id, userId]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: `Watchlist item not found` });
      return;
    }
    res.json({ message: `Watchlist item removed` });
  } catch (error) {
    console.error("Error removing from watchlist:", error);
    next(error);
  }
};

// UPDATE WATCHLIST ITEM CONTROLLER
// Corrects the details of an existing holding.
export const updateWatchlistItem: RequestHandler = async (req, res, next): Promise<void> => {
  const { id } = req.params;
  const { quantity, price_at_time, added_at } = req.body;
  const userId = (req as any).user.id;
  try {
    const result = await pool.query(
      "SELECT * FROM watchlist WHERE id = $1 AND user_id = $2",
      [id, userId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Watchlist item not found" });
      return;
    }
    await pool.query(
      `UPDATE watchlist
       SET quantity = COALESCE($1, quantity),
           price_at_time = COALESCE($2, price_at_time),
           added_at = COALESCE($3, added_at)
       WHERE id = $4`,
      [quantity, price_at_time, added_at, id]
    );
    res.json({ message: "Watchlist item updated" });
  } catch (error) {
    console.error("Error updating watchlist item:", error);
    next(error);
  }
};
