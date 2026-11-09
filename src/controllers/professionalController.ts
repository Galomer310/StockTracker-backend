import { RequestHandler } from "express";
import {
  acknowledgeProfessional,
  MedalDisplayError,
  professionalNotifications,
  professionalView,
  setMedalDisplay,
} from "../professional/service";

/* ===========================================================================
   Professional achievements and medals (spec v1.0, stage 2), the signed-in
   player's own:
     GET  /players/me/professional                     collection, medals, progress
     PUT  /players/me/medals/display                   { automatic } or { selected }
     GET  /players/me/professional/notifications       unseen unlocks and upgrades
     POST /players/me/professional/acknowledge         { achievement_ids, medal_event_ids }
   Evaluation itself runs with the valuation job, never from a request.
   =========================================================================== */

export const getMyProfessional: RequestHandler = async (req, res, next) => {
  try {
    res.json(await professionalView((req as any).user.id));
  } catch (error) {
    next(error);
  }
};

export const putMyMedalDisplay: RequestHandler = async (req, res, next) => {
  try {
    const d = await setMedalDisplay((req as any).user.id, req.body ?? {});
    res.json({ automatic: d.automatic, shown: d.shown.map((m) => ({ medal_id: m.medal_id, period_key: m.period_key })) });
  } catch (error) {
    if (error instanceof MedalDisplayError) {
      res.status(400).json({ error: "This medal selection is not valid.", code: error.code });
      return;
    }
    next(error);
  }
};

export const getMyProfessionalNotifications: RequestHandler = async (req, res, next) => {
  try {
    res.json(await professionalNotifications((req as any).user.id));
  } catch (error) {
    next(error);
  }
};

const intList = (v: unknown) =>
  Array.isArray(v) && v.length <= 500 && v.every((x) => Number.isInteger(x) && x > 0) ? (v as number[]) : null;

export const postMyProfessionalAcknowledge: RequestHandler = async (req, res, next) => {
  const a = intList(req.body?.achievement_ids ?? []);
  const m = intList(req.body?.medal_event_ids ?? []);
  if (!a || !m) {
    res.status(400).json({ error: "Nothing valid to acknowledge.", code: "INVALID_ACKNOWLEDGEMENT" });
    return;
  }
  try {
    await acknowledgeProfessional((req as any).user.id, { achievement_ids: a, medal_event_ids: m });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};
