import express from "express";                 // Import express
import { getStockData } from "../controllers/stockController"; // Import the getStockData controller

const router = express.Router();               // Create a new router instance

// Define a route to fetch stock data based on ticker (e.g., GET /stocks/AAPL)
router.get("/:ticker", getStockData);          // Attach the getStockData controller to handle GET requests

export default router;                         // Export the router
