import { Request, Response, NextFunction, RequestHandler } from "express"; // Import Express types
import pool from "../config/db";              // Import the PostgreSQL pool from the config
import axios from "axios";                    // Import axios for HTTP requests
import dotenv from "dotenv";                  // Import dotenv to load environment variables

dotenv.config();                              // Load environment variables

// Retrieve the Polygon API key from environment variables
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;

// GET WATCHLIST CONTROLLER
// Retrieves all watchlist stocks for the authenticated user
export const getWatchlist: RequestHandler = async (req, res, next) => {
  try {
    // Extract the user id from the request object (populated by authentication middleware)
    const userId = (req as any).user.id;
    // Query the database for watchlist items belonging to the user, sorted by date added (ascending)
    const result = await pool.query(
      "SELECT * FROM watchlist WHERE user_id = $1 ORDER BY added_at ASC",
      [userId]
    );
    const watchlist = result.rows;          // Get the watchlist items from the query result
    
    // Calculate the total invested price for the watchlist
    const totalPrice = watchlist.reduce((sum: number, item: any) => {
      return sum + parseFloat(item.price_at_time) * Number(item.quantity);
    }, 0);
    
    // Return the total price and the watchlist items in JSON format
    res.json({ total: totalPrice, watchlist });
  } catch (error) {
    console.error("Error fetching watchlist:", error); // Log any errors
    next(error);                            // Pass error to next middleware (error handler)
  }
};

// ADD TO WATCHLIST CONTROLLER
// Adds a new stock to the user's watchlist, either with manual data entry or automatic API fetch
export const addToWatchlist: RequestHandler = async (req, res, next): Promise<void> => {
  // Destructure required fields from request body
  const { stock_symbol, quantity, industry, price_at_time, added_at, manual } = req.body;
  const userId = (req as any).user.id;        // Get user id from the request object
  if (!stock_symbol) {                        // Ensure stock symbol is provided
    res.status(400).json({ error: "Stock symbol is required" });
    return;
  }
  // Convert quantity to an integer (default to 1 if not provided)
  const qty = quantity ? parseInt(quantity) : 1;
  try {
    let currentPrice: number;                 // Variable to hold the current price of the stock
    let timestamp: string;                    // Variable to hold the timestamp of the entry
    
    if (manual) {
      // If manual mode, use provided price and date
      if (!price_at_time || !added_at) {
        res.status(400).json({ error: "Manual entry requires price and added_at date." });
        return;
      }
      currentPrice = parseFloat(price_at_time); // Convert provided price to a number
      timestamp = added_at;                    // Use the provided timestamp (assumed to be an ISO string)
    } else {
      // Automatic mode: try to fetch current price from the stocks table if recent data exists
      const stockDataResult = await pool.query(
        "SELECT * FROM stocks WHERE stock_symbol = $1 AND updated_at > NOW() - INTERVAL '24 hours'",
        [stock_symbol]
      );
      if (stockDataResult.rows.length > 0) {
        // Use the cached price if available
        currentPrice = parseFloat(stockDataResult.rows[0].last_price);
      } else {
        // Fetch fresh data from Polygon.io if no recent data exists
        const response = await axios.get(
          `https://api.polygon.io/v2/aggs/ticker/${stock_symbol}/prev?adjusted=true&apiKey=${POLYGON_API_KEY}`
        );
        currentPrice = response.data.results?.[0]?.c;
        if (!currentPrice) throw new Error("Invalid stock data");
        // Upsert the fetched data into the stocks table
        await pool.query(
          `INSERT INTO stocks (stock_symbol, last_price, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (stock_symbol)
           DO UPDATE SET last_price = $2, updated_at = NOW()`,
          [stock_symbol, currentPrice]
        );
      }
      // Use the current time as the timestamp
      timestamp = new Date().toISOString();
    }
    
    // Insert the new watchlist entry into the database
    await pool.query(
      `INSERT INTO watchlist (user_id, stock_symbol, price_at_time, quantity, added_at, industry)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, stock_symbol, currentPrice, qty, timestamp, industry || null]
    );
    
    // Respond with a success message
    res.json({ message: `Stock ${stock_symbol} added with price ${currentPrice} and quantity ${qty}` });
  } catch (error) {
    console.error("Error adding to watchlist:", error); // Log any errors
    next(error);                           // Pass error to next middleware
  }
};

// REMOVE FROM WATCHLIST CONTROLLER
// Removes a watchlist item by its id for the authenticated user
export const removeFromWatchlist: RequestHandler = async (req, res, next): Promise<void> => {
  const { id } = req.params;                  // Extract the watchlist item id from URL parameters
  const userId = (req as any).user.id;          // Get the authenticated user id
  if (!id) {                                  // Ensure an id is provided
    res.status(400).json({ error: "Watchlist item id is required" });
    return;
  }
  try {
    // Delete the watchlist item where both id and user_id match
    const result = await pool.query(
      "DELETE FROM watchlist WHERE id = $1 AND user_id = $2",
      [id, userId]
    );
    if (result.rowCount === 0) {              // If no rows were deleted, the item was not found
      res.status(404).json({ error: `Watchlist item not found` });
      return;
    }
    // Respond with a success message
    res.json({ message: `Watchlist item removed` });
  } catch (error) {
    console.error("Error removing from watchlist:", error); // Log any errors
    next(error);                           // Pass error to next middleware
  }
};

// UPDATE WATCHLIST ITEM CONTROLLER
// Updates an existing watchlist item (e.g., quantity, price_at_time, or added_at)
export const updateWatchlistItem: RequestHandler = async (req, res, next): Promise<void> => {
  const { id } = req.params;                  // Extract the id of the watchlist item from URL parameters
  const { quantity, price_at_time, added_at } = req.body; // Destructure updated values from the request body
  const userId = (req as any).user.id;          // Get the authenticated user id
  try {
    // Verify that the watchlist item exists for the given user
    const result = await pool.query(
      "SELECT * FROM watchlist WHERE id = $1 AND user_id = $2",
      [id, userId]
    );
    if (result.rows.length === 0) {           // If not found, respond with a 404 error
      res.status(404).json({ error: "Watchlist item not found" });
      return;
    }
    // Update the watchlist item with new values using COALESCE to retain existing values if not provided
    await pool.query(
      `UPDATE watchlist 
       SET quantity = COALESCE($1, quantity),
           price_at_time = COALESCE($2, price_at_time),
           added_at = COALESCE($3, added_at)
       WHERE id = $4`,
      [quantity, price_at_time, added_at, id]
    );
    // Respond with a success message
    res.json({ message: "Watchlist item updated" });
  } catch (error) {
    console.error("Error updating watchlist item:", error); // Log any errors
    next(error);                           // Pass error to next middleware
  }
};
