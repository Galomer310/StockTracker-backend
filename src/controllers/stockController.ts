import { Request, Response } from "express";   // Import Express types for Request and Response
import axios from "axios";                       // Import axios for making HTTP requests
import dotenv from "dotenv";                     // Import dotenv for environment variables
import { Pool } from "pg";                       // Import Pool from pg for database queries

dotenv.config();                                 // Load environment variables

// Retrieve the Polygon API key from environment variables
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;

// Create a new PostgreSQL pool instance using the connection string
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// GET STOCK DATA CONTROLLER
export const getStockData = async (req: Request, res: Response): Promise<void> => {
    const { ticker } = req.params;              // Extract the ticker from URL parameters
    if (!ticker) {                              // If no ticker is provided, send a 400 error response
        res.status(400).json({ error: "Stock ticker is required" });
        return;
    }
    try {
        // Check if stock data exists in the database and is recent (updated within the last 24 hours)
        const stockResult = await pool.query(
            "SELECT * FROM stocks WHERE stock_symbol = $1 AND updated_at > NOW() - INTERVAL '24 hours'",
            [ticker]
        );
        if (stockResult.rows.length > 0) {
            // Return cached stock data from the database
            res.json({
              stock_symbol: ticker,
              last_price: stockResult.rows[0].last_price,
              source: "cache"
            });
            return;
        }
        // If no recent data is found, fetch fresh data from Polygon.io
        const response = await axios.get(
            `https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${POLYGON_API_KEY}`
        );
        // Extract the last price from the response data
        const lastPrice = response.data.results?.[0]?.c;
        if (!lastPrice) throw new Error("Invalid stock data"); // Throw an error if last price is missing
        
        // Update the database with the newly fetched stock data using an upsert
        await pool.query(
            "INSERT INTO stocks (stock_symbol, last_price, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (stock_symbol) DO UPDATE SET last_price = $2, updated_at = NOW()",
            [ticker, lastPrice]
        );
        // Return the fresh stock data with a source indicating it came from Polygon.io
        res.json({ stock_symbol: ticker, last_price: lastPrice, source: "polygon.io" });
    } catch (error: any) {
        console.error("Error fetching stock data:", error.message); // Log the error message
        res.status(500).json({ error: "Failed to fetch stock data", details: error.message }); // Return a 500 error response with details
    }
};
