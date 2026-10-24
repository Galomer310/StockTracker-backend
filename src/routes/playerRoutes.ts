import express from "express";                 // Import express
import { getMyPlayerCard, updateMyProfile } from "../controllers/playerController";
import {
  acknowledgeMyNotifications,
  getMyAchievements,
  getMyNotifications,
  getMyTitles,
  setMyTitle,
} from "../controllers/progressionController";
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

// Player titles: the collection, and choosing the active one
router.get("/me/titles", getMyTitles);
router.put("/me/title", setMyTitle);

// Game achievements: the collection with each one's state and progress
router.get("/me/achievements", getMyAchievements);

// Unseen unlock notices and the pending title ceremony, and marking them seen
router.get("/me/progression/notifications", getMyNotifications);
router.post("/me/progression/acknowledge", acknowledgeMyNotifications);

export default router;                         // Export the router
