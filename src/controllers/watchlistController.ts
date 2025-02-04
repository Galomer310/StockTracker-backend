// backend/src/controllers/watchlistController.ts
import { Request, Response, NextFunction, RequestHandler } from "express";
import pool from "../config/db";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const POLYGON_API_KEY = process.env.POLYGON_API_KEY;

// Get all watchlist stocks for a user
export const getWatchlist: RequestHandler = async (req, res, next) => {
  try {
    const userId = (req as any).user.id;
    const result = await pool.query(
      "SELECT * FROM watchlist WHERE user_id = $1 ORDER BY added_at ASC",
      [userId]
    );
    const watchlist = result.rows;
    const totalPrice = watchlist.reduce((sum: number, item: any) => {
      return sum + parseFloat(item.price_at_time) * Number(item.quantity);
    }, 0);
    res.json({ total: totalPrice, watchlist });
  } catch (error) {
    console.error("Error fetching watchlist:", error);
    next(error);
  }
};

// Add a stock to the watchlist with automatic or manual data entry
export const addToWatchlist: RequestHandler = async (req, res, next): Promise<void> => {
  const { stock_symbol, quantity, industry, price_at_time, added_at, manual } = req.body;
  const userId = (req as any).user.id;
  if (!stock_symbol) {
    res.status(400).json({ error: "Stock symbol is required" });
    return;
  }
  const qty = quantity ? parseInt(quantity) : 1;

  try {
    let currentPrice: number;
    let timestamp: string;

    if (manual) {
      // Manual entry: use provided price and date
      if (!price_at_time || !added_at) {
        res.status(400).json({ error: "Manual entry requires price and added_at date." });
        return;
      }
      currentPrice = parseFloat(price_at_time);
      timestamp = added_at; // assume ISO format string
    } else {
      // Automatic mode: fetch current price from API
      const stockDataResult = await pool.query(
        "SELECT * FROM stocks WHERE stock_symbol = $1 AND updated_at > NOW() - INTERVAL '24 hours'",
        [stock_symbol]
      );
      if (stockDataResult.rows.length > 0) {
        currentPrice = parseFloat(stockDataResult.rows[0].last_price);
      } else {
        const response = await axios.get(
          `https://api.polygon.io/v2/aggs/ticker/${stock_symbol}/prev?adjusted=true&apiKey=${POLYGON_API_KEY}`
        );
        currentPrice = response.data.results?.[0]?.c;
        if (!currentPrice) throw new Error("Invalid stock data");
        await pool.query(
          `INSERT INTO stocks (stock_symbol, last_price, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (stock_symbol)
           DO UPDATE SET last_price = $2, updated_at = NOW()`,
          [stock_symbol, currentPrice]
        );
      }
      timestamp = new Date().toISOString();
    }

    await pool.query(
      `INSERT INTO watchlist (user_id, stock_symbol, price_at_time, quantity, added_at, industry)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, stock_symbol, currentPrice, qty, timestamp, industry || null]
    );
    res.json({ message: `Stock ${stock_symbol} added with price ${currentPrice} and quantity ${qty}` });
  } catch (error) {
    console.error("Error adding to watchlist:", error);
    next(error);
  }
};

// Remove a stock from the watchlist
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

// Update a watchlist item (edit quantity, price, or added_at date)
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
