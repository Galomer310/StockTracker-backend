import { RequestHandler } from "express";
import pool from "../config/db";
import { syncProgressionSafely } from "../progression/service";

/* ===========================================================================
   Following.
   ---------------------------------------------------------------------------
   Free and one-click: following needs no approval, reveals no holdings, and
   can be undone at any time. A player's follower and following COUNTS are
   public; the LISTS of who those people are are shown only to the player
   themselves (decided 2026-10-24).

   Following feeds the game achievements (First Connection, the follow and
   follower milestones), so each change syncs both players' progression.
   Achievements once earned stay earned when someone unfollows.
   =========================================================================== */

// The other player's id from the path, or null when it is not a valid one.
const targetOf = (raw: unknown): number | null => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const followState = async (viewerId: number, targetId: number) => {
  const r = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM follows WHERE followee_id = $2) AS followers,
       EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2) AS following`,
    [viewerId, targetId]
  );
  return { followers: r.rows[0].followers as number, following: r.rows[0].following as boolean };
};

const playerExists = async (id: number): Promise<boolean> =>
  (await pool.query("SELECT 1 FROM users WHERE id = $1", [id])).rows.length > 0;

// GET /players/:id/follow
// Whether you follow this player, and how many people do.
export const getFollowState: RequestHandler = async (req, res, next) => {
  const viewerId = (req as any).user.id;
  const targetId = targetOf(req.params.id);
  if (targetId === null) {
    res.status(400).json({ error: "Invalid player id", code: "INVALID_PLAYER" });
    return;
  }
  try {
    if (!(await playerExists(targetId))) {
      res.status(404).json({ error: "Player not found.", code: "PLAYER_NOT_FOUND" });
      return;
    }
    res.json({ ...(await followState(viewerId, targetId)), is_self: viewerId === targetId });
  } catch (error) {
    next(error);
  }
};

// PUT /players/:id/follow - follow. Idempotent: following twice is one follow.
export const followPlayer: RequestHandler = async (req, res, next) => {
  const viewerId = (req as any).user.id;
  const targetId = targetOf(req.params.id);
  if (targetId === null) {
    res.status(400).json({ error: "Invalid player id", code: "INVALID_PLAYER" });
    return;
  }
  if (targetId === viewerId) {
    res.status(400).json({ error: "You cannot follow yourself.", code: "CANNOT_FOLLOW_SELF" });
    return;
  }
  try {
    const inserted = await pool.query(
      `INSERT INTO follows (follower_id, followee_id)
       SELECT $1, id FROM users WHERE id = $2
       ON CONFLICT DO NOTHING RETURNING followee_id`,
      [viewerId, targetId]
    );
    if (inserted.rows.length === 0 && !(await playerExists(targetId))) {
      res.status(404).json({ error: "Player not found.", code: "PLAYER_NOT_FOUND" });
      return;
    }
    if (inserted.rows.length > 0) {
      // First Connection and the follow milestones for you; The First Fan and
      // the follower milestones for them.
      await Promise.all([syncProgressionSafely(viewerId), syncProgressionSafely(targetId)]);
    }
    res.json({ ...(await followState(viewerId, targetId)), is_self: false });
  } catch (error) {
    next(error);
  }
};

// DELETE /players/:id/follow - unfollow. Unfollowing someone you do not
// follow is not an error; the answer is the same either way.
export const unfollowPlayer: RequestHandler = async (req, res, next) => {
  const viewerId = (req as any).user.id;
  const targetId = targetOf(req.params.id);
  if (targetId === null) {
    res.status(400).json({ error: "Invalid player id", code: "INVALID_PLAYER" });
    return;
  }
  try {
    await pool.query("DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2", [viewerId, targetId]);
    res.json({ ...(await followState(viewerId, targetId)), is_self: viewerId === targetId });
  } catch (error) {
    next(error);
  }
};

// The people on one side of your follows, newest first. Only ever your own.
const listOf = (direction: "following" | "followers"): RequestHandler => async (req, res, next) => {
  const userId = (req as any).user.id;
  const [mine, theirs] = direction === "following" ? ["follower_id", "followee_id"] : ["followee_id", "follower_id"];
  try {
    const r = await pool.query(
      `SELECT u.id, COALESCE(u.display_name, 'Investor #' || u.id) AS display_name, u.nickname, f.created_at AS since,
              EXISTS (SELECT 1 FROM follows b WHERE b.follower_id = $1 AND b.followee_id = u.id) AS you_follow
       FROM follows f JOIN users u ON u.id = f.${theirs}
       WHERE f.${mine} = $1
       ORDER BY f.created_at DESC, u.id
       LIMIT 500`,
      [userId]
    );
    res.json({ players: r.rows });
  } catch (error) {
    next(error);
  }
};

// GET /players/me/following and GET /players/me/followers
export const getMyFollowing = listOf("following");
export const getMyFollowers = listOf("followers");
