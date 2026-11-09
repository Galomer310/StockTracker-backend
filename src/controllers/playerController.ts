import { RequestHandler } from "express";      // Express handler type
import pool from "../config/db";                // Shared PostgreSQL pool
import { POSITION_VALUES, valuePortfolio } from "./portfolioController"; // One shared valuation
import { Award, buildPlayerCard } from "../services/playerCard";
import { displayedMedals, medalAward } from "../professional/service";
import { validateProfileUpdate } from "../services/playerProfile";
import { holdCutoff, nextNicknameChangeAt, nicknameKey, validateNickname } from "../services/nickname";
import { cardProgression, syncProgression, syncProgressionSafely } from "../progression/service";

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
      pool.query("SELECT nickname, nickname_changed_at, first_name, avatar_url, avatar_id, bio FROM users WHERE id = $1", [userId]),
      pool.query(
        `SELECT p.id, p.name, p.status, p.starting_balance, COALESCE(p.capital_base, p.starting_balance) AS capital_base, p.cash, p.created_at,
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

    // Progression is synced first so the card includes anything that became
    // due since the last event. If it fails, the card still loads and says
    // progression is unavailable.
    let progression = null;
    try {
      await syncProgression(userId);
      progression = await cardProgression(userId);
    } catch (error) {
      console.error("Error loading progression for the player card:", error);
    }

    const followers = await pool.query("SELECT COUNT(*)::int AS n FROM follows WHERE followee_id = $1", [userId]);

    // The professional medals the player shows (their choice, or the
    // automatic order). A failure leaves the panel empty, not the card.
    let medals = { total: 0, top: [] as Award[] };
    try {
      const shown = await displayedMedals(userId);
      const total = (await pool.query("SELECT COUNT(*)::int AS n FROM player_medals WHERE user_id = $1", [userId])).rows[0].n;
      medals = { total, top: shown.shown.map(medalAward) };
    } catch (error) {
      console.error("Error loading medals for the player card:", error);
    }

    const rows = portfolios.rows.map((row) => ({ ...valuePortfolio(row), status: row.status }));
    res.json(buildPlayerCard(user.rows[0], rows, new Date(), progression, followers.rows[0].n, medals));
  } catch (error) {
    console.error("Error building player card:", error);
    next(error);
  }
};

// Whether another player has a username, or holds it because they gave it
// up in the last 30 days. A name the player themselves holds is theirs to
// take back.
type Db = Pick<typeof pool, "query">;
const nicknameTaken = async (db: Db, key: string, userId: number, now: Date): Promise<boolean> => {
  const r = await db.query(
    `SELECT EXISTS (SELECT 1 FROM users WHERE lower(nickname) = $1 AND id <> $2)
         OR EXISTS (SELECT 1 FROM nickname_holds WHERE nickname_key = $1 AND user_id <> $2 AND released_at > $3)
         AS taken`,
    [key, userId, holdCutoff(now)]
  );
  return r.rows[0].taken;
};

// The player's identity as the card shows it, from a users row.
const identity = (row: any, now: Date) => {
  const next = nextNicknameChangeAt(row.nickname_changed_at, now);
  return {
    nickname: row.nickname,
    nickname_next_change_at: next ? next.toISOString() : null,
    first_name: row.first_name,
    avatar_url: row.avatar_url,
    avatar_id: row.avatar_id,
    bio: row.bio,
  };
};

const IDENTITY_COLUMNS = "nickname, nickname_changed_at, first_name, avatar_url, avatar_id, bio";

// PATCH /players/me
// Changes the signed-in player's bio, first name, avatar and/or username.
// What may be edited, and why an uploaded picture may not yet, is in
// src/services/playerProfile.ts; the username's rules are in
// src/services/nickname.ts. Answers with the player's identity as it now
// stands, in the same shape as the card's `player`.
//
// A username is taken inside a transaction that locks the player's row, so
// two quick saves cannot both pass the 30-day check. Two players racing for
// the same name are settled by the unique index on lower(nickname): the
// loser gets NICKNAME_TAKEN, as if it had been taken a moment earlier.
export const updateMyProfile: RequestHandler = async (req, res, next) => {
  const userId = (req as any).user.id;
  const result = validateProfileUpdate(req.body);
  if (!result.ok) {
    res.status(400).json({ error: result.error, code: result.code, field: result.field });
    return;
  }

  const { nickname, ...rest } = result.update;
  // Column names come from the validated update's keys, which can only be
  // bio, first_name, avatar_id and nickname; the values are always parameters.
  const entries: [string, unknown][] = Object.entries(rest);
  const now = new Date();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(`SELECT ${IDENTITY_COLUMNS} FROM users WHERE id = $1 FOR UPDATE`, [userId]);
    if (current.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Player not found." });
      return;
    }
    const before = current.rows[0];

    // The same username, character for character, is not a change.
    if (nickname !== undefined && nickname !== before.nickname) {
      const nextChange = nextNicknameChangeAt(before.nickname_changed_at, now);
      if (nextChange) {
        await client.query("ROLLBACK");
        res.status(409).json({
          error: `You can change your username again on ${nextChange.toISOString().slice(0, 10)}.`,
          code: "NICKNAME_CHANGE_TOO_SOON",
          field: "nickname",
          next_change_at: nextChange.toISOString(),
        });
        return;
      }
      const key = nicknameKey(nickname);
      if (await nicknameTaken(client, key, userId, now)) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "That username is taken.", code: "NICKNAME_TAKEN", field: "nickname" });
        return;
      }
      entries.push(["nickname", nickname], ["nickname_changed_at", now]);
      // Taking back a name this player held: the hold has done its job.
      await client.query("DELETE FROM nickname_holds WHERE nickname_key = $1", [key]);
      // Giving up a different name: hold it for this player for 30 days.
      if (before.nickname && nicknameKey(before.nickname) !== key) {
        await client.query(
          `INSERT INTO nickname_holds (nickname_key, user_id, released_at) VALUES ($1, $2, $3)
           ON CONFLICT (nickname_key) DO UPDATE SET user_id = EXCLUDED.user_id, released_at = EXCLUDED.released_at`,
          [nicknameKey(before.nickname), userId, now]
        );
      }
    }

    let row = before;
    if (entries.length > 0) {
      const assignments = entries.map(([column], i) => `${column} = $${i + 1}`).join(", ");
      const updated = await client.query(
        `UPDATE users SET ${assignments} WHERE id = $${entries.length + 1} RETURNING ${IDENTITY_COLUMNS}`,
        [...entries.map(([, value]) => value), userId]
      );
      row = updated.rows[0];
    }
    await client.query("COMMIT");
    await syncProgressionSafely(userId); // The Introduction, Make Your Mark
    res.json({ player: identity(row, now) });
  } catch (error: any) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error?.code === "23505" && error?.constraint === "users_nickname_lower_key") {
      res.status(409).json({ error: "That username is taken.", code: "NICKNAME_TAKEN", field: "nickname" });
      return;
    }
    console.error("Error updating player profile:", error);
    next(error);
  } finally {
    client.release();
  }
};

// GET /players/nickname-availability?nickname=...
// Whether a username could be chosen right now, for the check while the
// player types (spec 3.2). Answers 200 either way, with the reason when not:
// one of the rule codes from src/services/nickname.ts, or NICKNAME_TAKEN.
// It does not check the player's 30-day limit; the card shows that, and
// PATCH /players/me enforces it.
export const checkNicknameAvailability: RequestHandler = async (req, res, next) => {
  const userId = (req as any).user.id;
  const checked = validateNickname(req.query.nickname);
  if (!checked.ok) {
    res.json({ available: false, code: checked.code });
    return;
  }
  try {
    const mine = await pool.query("SELECT nickname FROM users WHERE id = $1", [userId]);
    const current = mine.rows[0]?.nickname as string | null | undefined;
    if (current && nicknameKey(current) === checked.key) {
      res.json({ available: true, nickname: checked.nickname, is_current: true });
      return;
    }
    const taken = await nicknameTaken(pool, checked.key, userId, new Date());
    res.json(taken ? { available: false, code: "NICKNAME_TAKEN" } : { available: true, nickname: checked.nickname });
  } catch (error) {
    next(error);
  }
};
