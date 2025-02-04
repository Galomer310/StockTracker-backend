import { Request, Response } from "express";
import axios from "axios";
import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});


export const getStockData = async (req: Request, res: Response): Promise<void> => {
    const { ticker } = req.params;
    if (!ticker) {
        res.status(400).json({ error: "Stock ticker is required" });
        return;
    }

    try {
        // ✅ Check if stock data exists in DB and is recent (last 24 hours)
        const stockResult = await pool.query(
            "SELECT * FROM stocks WHERE stock_symbol = $1 AND updated_at > NOW() - INTERVAL '24 hours'",
            [ticker]
        );

        if (stockResult.rows.length > 0) {
            // ✅ Return cached stock data
            res.json({ stock_symbol: ticker, last_price: stockResult.rows[0].last_price, source: "cache" });
            return;
        }

        // 🔹 If data is old or missing, fetch fresh data from Polygon.io
        const response = await axios.get(
            `https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${POLYGON_API_KEY}`
        );

        const lastPrice = response.data.results?.[0]?.c;
        if (!lastPrice) throw new Error("Invalid stock data");

        // ✅ Update stock data in DB
        await pool.query(
            "INSERT INTO stocks (stock_symbol, last_price, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (stock_symbol) DO UPDATE SET last_price = $2, updated_at = NOW()",
            [ticker, lastPrice]
        );

        res.json({ stock_symbol: ticker, last_price: lastPrice, source: "polygon.io" });
    } catch (error: any) {
        console.error("Error fetching stock data:", error.message);
        res.status(500).json({ error: "Failed to fetch stock data", details: error.message });
    }
};
