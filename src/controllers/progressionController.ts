import { RequestHandler } from "express";
import {
  achievementsView,
  acknowledge,
  notificationsView,
  ProgressionError,
  selectTitle,
  syncProgression,
  titlesView,
} from "../progression/service";

/* ===========================================================================
   Progression: titles, game achievements and their notices.
   ---------------------------------------------------------------------------
   The signed-in player's own collections. Every read syncs first, so what is
   shown includes anything that became due since the last event (a portfolio
   passing 30 days, say). How grants work is in src/progression/service.ts.
   =========================================================================== */

const MAX_ID_LENGTH = 80;

// GET /players/me/titles
export const getMyTitles: RequestHandler = async (req, res, next) => {
  const userId = (req as any).user.id;
  try {
    await syncProgression(userId);
    res.json(await titlesView(userId));
  } catch (error) {
    next(error);
  }
};

// PUT /players/me/title  { title_id }
// Only an owned, enabled title can be made active.
export const setMyTitle: RequestHandler = async (req, res, next) => {
  const userId = (req as any).user.id;
  const titleId = req.body?.title_id;
  if (typeof titleId !== "string" || !titleId || titleId.length > MAX_ID_LENGTH) {
    res.status(400).json({ error: "Choose a title.", code: "TITLE_REQUIRED" });
    return;
  }
  try {
    await selectTitle(userId, titleId);
    res.json(await titlesView(userId));
  } catch (error) {
    if (error instanceof ProgressionError && error.code === "TITLE_NOT_OWNED") {
      res.status(403).json({ error: "That title is not unlocked yet.", code: "TITLE_NOT_OWNED" });
      return;
    }
    next(error);
  }
};

// GET /players/me/achievements
export const getMyAchievements: RequestHandler = async (req, res, next) => {
  const userId = (req as any).user.id;
  try {
    await syncProgression(userId);
    res.json(await achievementsView(userId));
  } catch (error) {
    next(error);
  }
};

// GET /players/me/progression/notifications
// Unlock notices not yet seen, and the pending title ceremony if any.
export const getMyNotifications: RequestHandler = async (req, res, next) => {
  const userId = (req as any).user.id;
  try {
    await syncProgression(userId);
    res.json(await notificationsView(userId));
  } catch (error) {
    next(error);
  }
};

// POST /players/me/progression/acknowledge  { achievement_ids?, ceremony_tier? }
// Marks notices as seen and closes the ceremony up to the given tier, so a
// refresh does not show them again.
export const acknowledgeMyNotifications: RequestHandler = async (req, res, next) => {
  const userId = (req as any).user.id;
  const ids = req.body?.achievement_ids ?? [];
  const tier = req.body?.ceremony_tier ?? null;
  const idsValid =
    Array.isArray(ids) && ids.length <= 100 && ids.every((id) => typeof id === "string" && id.length <= MAX_ID_LENGTH);
  const tierValid = tier === null || (Number.isInteger(tier) && tier >= 1 && tier <= 20);
  if (!idsValid || !tierValid) {
    res.status(400).json({ error: "Nothing valid to acknowledge.", code: "INVALID_ACKNOWLEDGEMENT" });
    return;
  }
  try {
    await acknowledge(userId, { achievement_ids: ids, ceremony_tier: tier });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};
