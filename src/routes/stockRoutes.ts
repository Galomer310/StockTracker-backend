import express from "express";
import { getStockData } from "../controllers/stockController";

const router = express.Router();

// Fetch stock data
router.get("/:ticker", getStockData);

export default router;
