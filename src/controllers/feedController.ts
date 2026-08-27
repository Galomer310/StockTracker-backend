import { RequestHandler } from "express";      // Express handler type
import pool from "../config/db";                // Shared PostgreSQL pool

/* ===========================================================================
   The feed.
   ---------------------------------------------------------------------------
   Every buy and every sell becomes a post the moment it is recorded, shared
   with everyone. Other users can react to it and reply to it.

   A post is not a stored row: it IS the trade, read straight out of
   trade_notes. Nothing has to be published, nothing can fall out of step with
   the journal, and a mistyped trade removed inside its 60 second window takes
   its post with it (the reaction and comment tables cascade from the same id).

   The privacy rule from leaderboardController holds here too, and matters more
   because the audience is everyone: a post carries the action, the ticker, the
   reasoning, the timestamp, and how the stock has moved since - never the
   price paid or the number of shares. That applies to your own posts as well.
   The feed is a public square; your prices live on your dashboard.
   =========================================================================== */

// What may be attached to a post. An allowlist rather than free text, so the
// column holds a small closed set that the client can render and count on,
// instead of arbitrary strings pasted through the API.
export const ALLOWED_REACTIONS = [
  "like",
  "dislike",
  "🚀",
  "🔥",
  "💎",
  "😂",
  "😮",
  "😢",
] as const;

const MAX_COMMENT_LENGTH = 500;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;

// See moveSince in leaderboardController: percentage move since the trade,
// null when the symbol has no cached quote.
const moveSince = (tradePrice: number, latestPrice: number | null): number | null => {
  if (latestPrice === null || !Number.isFinite(latestPrice)) return null;
  if (!Number.isFinite(tradePrice) || tradePrice <= 0) return null;
  return ((latestPrice - tradePrice) / tradePrice) * 100;
};

// GET /feed
// The shared timeline, newest trade first.
export const getFeed: RequestHandler = async (req, res, next) => {
  const viewerId = (req as any).user.id;

  const limit = Math.min(
    Math.max(parseInt(String(req.query.limit ?? DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE
  );
  const offset = Math.max(parseInt(String(req.query.offset ?? 0), 10) || 0, 0);

  try {
    // t.price is selected only to compute the percentage below; it is never
    // placed on the response.
    const postsResult = await pool.query(
      `SELECT t.id, t.user_id, t.stock_symbol, t.action, t.note, t.price,
              t.occurred_at, t.created_at,
              u.display_name,
              p.id AS portfolio_id, p.name AS portfolio_name,
              s.last_price
       FROM trade_notes t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN portfolios p ON p.id = t.portfolio_id
       LEFT JOIN stocks s ON s.stock_symbol = t.stock_symbol
       ORDER BY t.occurred_at DESC, t.id DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const ids = postsResult.rows.map((row) => row.id);

    // No posts yet: skip the follow-up queries rather than sending them an
    // empty array to match against.
    if (ids.length === 0) {
      res.json({ posts: [], has_more: false });
      return;
    }

    // Three small queries for the whole page instead of three per post.
    const [countsResult, mineResult, commentsResult] = await Promise.all([
      pool.query(
        `SELECT trade_note_id, reaction, COUNT(*)::int AS count
         FROM feed_reactions
         WHERE trade_note_id = ANY($1::int[])
         GROUP BY trade_note_id, reaction`,
        [ids]
      ),
      pool.query(
        `SELECT trade_note_id, reaction
         FROM feed_reactions
         WHERE user_id = $1 AND trade_note_id = ANY($2::int[])`,
        [viewerId, ids]
      ),
      pool.query(
        `SELECT c.id, c.trade_note_id, c.user_id, c.body, c.created_at,
                u.display_name
         FROM feed_comments c
         JOIN users u ON u.id = c.user_id
         WHERE c.trade_note_id = ANY($1::int[])
         ORDER BY c.created_at ASC, c.id ASC`,
        [ids]
      ),
    ]);

    const countsByPost = new Map<number, Record<string, number>>();
    for (const row of countsResult.rows) {
      const forPost = countsByPost.get(row.trade_note_id) ?? {};
      forPost[row.reaction] = row.count;
      countsByPost.set(row.trade_note_id, forPost);
    }

    const mineByPost = new Map<number, string>();
    for (const row of mineResult.rows) {
      mineByPost.set(row.trade_note_id, row.reaction);
    }

    const commentsByPost = new Map<number, unknown[]>();
    for (const row of commentsResult.rows) {
      const list = commentsByPost.get(row.trade_note_id) ?? [];
      list.push({
        id: row.id,
        user: {
          id: row.user_id,
          display_name: row.display_name || `Investor #${row.user_id}`,
        },
        body: row.body,
        created_at: row.created_at,
        is_mine: row.user_id === viewerId,
      });
      commentsByPost.set(row.trade_note_id, list);
    }

    const posts = postsResult.rows.map((row) => ({
      id: row.id,
      user: {
        id: row.user_id,
        display_name: row.display_name || `Investor #${row.user_id}`,
      },
      is_mine: row.user_id === viewerId,
      // Which book the trade was made in. A user runs up to three, and "bought
      // NVDA in Experimental" says something rather different from the same
      // trade in their main portfolio.
      portfolio: row.portfolio_id
        ? { id: row.portfolio_id, name: row.portfolio_name }
        : null,
      action: row.action as "buy" | "sell",
      stock_symbol: row.stock_symbol,
      note: row.note,
      // The date and time the action was taken, and when it was written up.
      occurred_at: row.occurred_at,
      created_at: row.created_at,
      backdated:
        Math.abs(
          new Date(row.created_at).getTime() - new Date(row.occurred_at).getTime()
        ) > 60 * 60 * 1000,
      change_pct_since: moveSince(
        parseFloat(row.price),
        row.last_price !== null ? parseFloat(row.last_price) : null
      ),
      reactions: countsByPost.get(row.id) ?? {},
      my_reaction: mineByPost.get(row.id) ?? null,
      comments: commentsByPost.get(row.id) ?? [],
    }));

    res.json({ posts, has_more: postsResult.rows.length === limit });
  } catch (error) {
    console.error("Error building feed:", error);
    next(error);
  }
};

// POST /feed/:id/reactions
// Sets your reaction to a post. Sending the one you already have clears it, so
// the same button both reacts and un-reacts.
export const setReaction: RequestHandler = async (req, res, next) => {
  const userId = (req as any).user.id;
  const postId = Number(req.params.id);
  const { reaction } = req.body ?? {};

  if (!Number.isInteger(postId)) {
    res.status(400).json({ error: "Invalid post id" });
    return;
  }

  if (!ALLOWED_REACTIONS.includes(reaction)) {
    res.status(400).json({ error: "Unsupported reaction" });
    return;
  }

  try {
    const post = await pool.query("SELECT id FROM trade_notes WHERE id = $1", [postId]);
    if (post.rows.length === 0) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    const existing = await pool.query(
      "SELECT reaction FROM feed_reactions WHERE trade_note_id = $1 AND user_id = $2",
      [postId, userId]
    );

    let myReaction: string | null = reaction;

    if (existing.rows.length > 0 && existing.rows[0].reaction === reaction) {
      // Same reaction again: take it back.
      await pool.query(
        "DELETE FROM feed_reactions WHERE trade_note_id = $1 AND user_id = $2",
        [postId, userId]
      );
      myReaction = null;
    } else {
      // First reaction, or a change of mind. The unique constraint on
      // (trade_note_id, user_id) turns the second case into an update, so one
      // person can never hold two reactions on one post.
      await pool.query(
        `INSERT INTO feed_reactions (trade_note_id, user_id, reaction)
         VALUES ($1, $2, $3)
         ON CONFLICT (trade_note_id, user_id)
         DO UPDATE SET reaction = $3, created_at = NOW()`,
        [postId, userId, reaction]
      );
    }

    // Return the fresh tally so the client renders the server's count rather
    // than guessing at it.
    const counts = await pool.query(
      `SELECT reaction, COUNT(*)::int AS count
       FROM feed_reactions WHERE trade_note_id = $1 GROUP BY reaction`,
      [postId]
    );

    const reactions: Record<string, number> = {};
    for (const row of counts.rows) reactions[row.reaction] = row.count;

    res.json({ reactions, my_reaction: myReaction });
  } catch (error) {
    console.error("Error saving reaction:", error);
    next(error);
  }
};

// POST /feed/:id/comments
// Replies to a post.
export const addComment: RequestHandler = async (req, res, next) => {
  const userId = (req as any).user.id;
  const postId = Number(req.params.id);
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";

  if (!Number.isInteger(postId)) {
    res.status(400).json({ error: "Invalid post id" });
    return;
  }
  if (!body) {
    res.status(400).json({ error: "A comment cannot be empty." });
    return;
  }
  if (body.length > MAX_COMMENT_LENGTH) {
    res.status(400).json({ error: `A comment must be ${MAX_COMMENT_LENGTH} characters or fewer.` });
    return;
  }

  try {
    const post = await pool.query("SELECT id FROM trade_notes WHERE id = $1", [postId]);
    if (post.rows.length === 0) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    const inserted = await pool.query(
      `INSERT INTO feed_comments (trade_note_id, user_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, body, created_at`,
      [postId, userId, body]
    );

    const author = await pool.query("SELECT display_name FROM users WHERE id = $1", [userId]);

    res.status(201).json({
      comment: {
        id: inserted.rows[0].id,
        user: {
          id: userId,
          display_name: author.rows[0]?.display_name || `Investor #${userId}`,
        },
        body: inserted.rows[0].body,
        created_at: inserted.rows[0].created_at,
        is_mine: true,
      },
    });
  } catch (error) {
    console.error("Error adding comment:", error);
    next(error);
  }
};

// DELETE /feed/comments/:commentId
// Deletes your own reply. The user_id in the WHERE clause is the authorisation
// check: someone else's comment simply does not match, and returns 404.
export const deleteComment: RequestHandler = async (req, res, next) => {
  const userId = (req as any).user.id;
  const commentId = Number(req.params.commentId);

  if (!Number.isInteger(commentId)) {
    res.status(400).json({ error: "Invalid comment id" });
    return;
  }

  try {
    const result = await pool.query(
      "DELETE FROM feed_comments WHERE id = $1 AND user_id = $2 RETURNING id",
      [commentId, userId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }
    res.json({ message: "Comment deleted" });
  } catch (error) {
    console.error("Error deleting comment:", error);
    next(error);
  }
};
