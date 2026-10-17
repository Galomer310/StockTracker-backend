import express from "express";                 // Import express
import { getMyPlayerCard, updateMyProfile } from "../controllers/playerController";
import { authenticateUser } from "../middleware/authMiddleware"; // Authentication middleware
import { socialLimiter } from "../middleware/rateLimiter";       // Per-user limit

const router = express.Router();               // Create a new router instance

// A player's own card needs a valid token. authenticateUser runs first so the
// limiter can key on the user id. The card reads only the database and cached
// prices, never market data, so it does not carry the market data limiter.
router.use(authenticateUser, socialLimiter);

// GET /players/me/card - the signed-in player's Player Card
router.get("/me/card", getMyPlayerCard);

// PATCH /players/me - change your own bio and first name
router.patch("/me", updateMyProfile);

export default router;                         // Export the router
