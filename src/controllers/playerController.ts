import { RequestHandler } from "express";      // Express handler type
import pool from "../config/db";                // Shared PostgreSQL pool
import { POSITION_VALUES, valuePortfolio } from "./portfolioController"; // One shared valuation
import { buildPlayerCard } from "../services/playerCard";
import { validateProfileUpdate } from "../services/playerProfile";

/* ===========================================================================
   Players.
   ---------------------------------------------------------------------------
   The Player Card: who the player is and how they are doing across all of
   their portfolios. What each figure means, and why some are withheld, is
   in src/services/playerCard.ts; this file only loads the rows.
   =========================================================================== */

// GET /players/me/card
// The signed-in player's own card. Other players' cards come later, behind
// the subscription rules that decide what a viewer may see.
export const getMyPlayerCard: RequestHandler = async (req, res, next) => {
  const userId = (req as any).user.id;
  try {
    const [user, portfolios] = await Promise.all([
      pool.query("SELECT nickname, first_name, avatar_url, bio FROM users WHERE id = $1", [userId]),
      pool.query(
        `SELECT p.id, p.name, p.status, p.starting_balance, p.cash, p.created_at,
                COALESCE(v.positions_value, 0) AS positions_value,
                COALESCE(v.holdings_count, 0)  AS holdings_count
         FROM portfolios p
         LEFT JOIN (${POSITION_VALUES}) v ON v.portfolio_id = p.id
         WHERE p.user_id = $1
         ORDER BY p.created_at ASC, p.id ASC`,
        [userId]
      ),
    ]);

    // A valid token for an account that has since been deleted.
    if (user.rows.length === 0) {
      res.status(404).json({ error: "Player not found." });
      return;
    }

    const rows = portfolios.rows.map((row) => ({ ...valuePortfolio(row), status: row.status }));
    res.json(buildPlayerCard(user.rows[0], rows, new Date()));
  } catch (error) {
    console.error("Error building player card:", error);
    next(error);
  }
};

// PATCH /players/me
// Changes the signed-in player's bio and/or first name. What may be edited,
// and why the nickname and picture may not yet, is in
// src/services/playerProfile.ts. Answers with the player's identity as it
// now stands, in the same shape as the card's `player`.
export const updateMyProfile: RequestHandler = async (req, res, next) => {
  const userId = (req as any).user.id;
  const result = validateProfileUpdate(req.body);
  if (!result.ok) {
    res.status(400).json({ error: result.error, code: result.code, field: result.field });
    return;
  }

  // Column names come from the validated update's keys, which can only be
  // bio and first_name; the values are always parameters.
  const entries = Object.entries(result.update);
  const assignments = entries.map(([column], i) => `${column} = $${i + 1}`).join(", ");
  try {
    const updated = await pool.query(
      `UPDATE users SET ${assignments} WHERE id = $${entries.length + 1}
       RETURNING nickname, first_name, avatar_url, bio`,
      [...entries.map(([, value]) => value), userId]
    );
    if (updated.rows.length === 0) {
      res.status(404).json({ error: "Player not found." });
      return;
    }
    res.json({ player: updated.rows[0] });
  } catch (error) {
    console.error("Error updating player profile:", error);
    next(error);
  }
};
