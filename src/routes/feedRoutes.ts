import express from "express";                 // Import express
import { getFeed, setReaction, addComment, deleteComment } from "../controllers/feedController";
import { authenticateUser } from "../middleware/authMiddleware"; // Authentication middleware
import { feedLimiter } from "../middleware/rateLimiter";         // Per-user limit

const router = express.Router();               // Create a new router instance

// The feed is everyone's trades, so a valid token is required to read it as
// well as to post to it. authenticateUser runs first so the limiter can key on
// the user id.
router.use(authenticateUser, feedLimiter);

// GET /feed - the shared timeline, newest trade first
router.get("/", getFeed);

// POST /feed/:id/reactions - like, dislike or an emoji. Sending the reaction
// you already hold removes it, so one endpoint covers both directions.
router.post("/:id/reactions", setReaction);

// POST /feed/:id/comments - reply to a post
router.post("/:id/comments", addComment);

// DELETE /feed/comments/:commentId - remove your own reply.
//
// Declared before any other /:id route would match it. Express takes the first
// matching handler, so "comments" must be claimed by this literal path rather
// than being read as an id by a later parameterised one.
router.delete("/comments/:commentId", deleteComment);

export default router;                         // Export the router
