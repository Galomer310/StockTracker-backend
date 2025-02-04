import express from "express";
import { getWatchlist, addToWatchlist, removeFromWatchlist } from "../controllers/watchlistController";
import { authenticateUser } from "../middleware/authMiddleware";
import { updateWatchlistItem } from "../controllers/watchlistController";

const router = express.Router();

router.get("/", authenticateUser, getWatchlist);
router.post("/", authenticateUser, addToWatchlist);
router.delete("/:id", authenticateUser, removeFromWatchlist);
router.put("/:id", authenticateUser, updateWatchlistItem);

export default router;
