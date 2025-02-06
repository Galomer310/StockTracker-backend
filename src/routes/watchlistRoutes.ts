import express from "express";                 // Import express
import { getWatchlist, addToWatchlist, removeFromWatchlist, updateWatchlistItem } from "../controllers/watchlistController"; // Import controllers for watchlist actions
import { authenticateUser } from "../middleware/authMiddleware"; // Import authentication middleware

const router = express.Router();               // Create a new router instance

// GET route: fetch the authenticated user's watchlist
router.get("/", authenticateUser, getWatchlist);

// POST route: add a new stock to the watchlist (requires authentication)
router.post("/", authenticateUser, addToWatchlist);

// DELETE route: remove a watchlist item by id (requires authentication)
router.delete("/:id", authenticateUser, removeFromWatchlist);

// PUT route: update a watchlist item by id (requires authentication)
router.put("/:id", authenticateUser, updateWatchlistItem);

export default router;                         // Export the router
