import express, { RequestHandler } from "express";
import { authenticateUser } from "../middleware/authMiddleware";
import { socialLimiter } from "../middleware/rateLimiter";
import {
  addXp,
  isTester,
  jumpToStreakDay,
  missADay,
  nextDay,
  raiseToLevel,
  replayAchievementNotices,
  replayCeremonies,
  resetAchievements,
  resetProgress,
  resetToNewPlayer,
  resetUsernameLock,
  runValuationNow,
  testerState,
  ToolError,
} from "../testTools/service";

/* ===========================================================================
   /test-tools - the test player's panel (src/testTools/service.ts).
   Only for accounts listed in TEST_PLAYER_EMAILS; everyone else gets 404
   from every route, so the tools do not exist for ordinary players. Not
   403: the client reads 403 as an expired token, refreshes it and, without
   a refresh token, signs the player out.
   =========================================================================== */

const router = express.Router();

const testerOnly: RequestHandler = async (req, res, next) => {
  try {
    if (await isTester((req as any).user.id)) return next();
    res.status(404).json({ error: "Not found", code: "NOT_A_TESTER" });
  } catch (error) {
    next(error);
  }
};

router.use(authenticateUser, socialLimiter, testerOnly);

// Runs a tool and answers with its result, or its refusal.
const tool =
  (run: (userId: number, body: any) => Promise<unknown>): RequestHandler =>
  async (req, res, next) => {
    try {
      res.json(await run((req as any).user.id, req.body ?? {}));
    } catch (error) {
      if (error instanceof ToolError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      next(error);
    }
  };

router.get("/state", tool((id) => testerState(id)));

router.post("/daily/next-day", tool((id) => nextDay(id)));
router.post("/daily/miss-day", tool((id) => missADay(id)));
router.post("/daily/jump", tool((id, body) => jumpToStreakDay(id, Number(body.day))));

router.post("/xp/add", tool((id, body) => addXp(id, Number(body.amount))));
router.post("/xp/level", tool((id, body) => raiseToLevel(id, Number(body.level))));
router.post("/titles/replay-ceremonies", tool((id) => replayCeremonies(id)));

router.post("/achievements/replay-notices", tool((id) => replayAchievementNotices(id)));
router.post("/achievements/reset", tool((id) => resetAchievements(id)));

router.post("/limits/reset-username-lock", tool((id) => resetUsernameLock(id)));
router.post("/limits/run-valuation", tool(() => runValuationNow()));
router.post("/reset/progress", tool((id) => resetProgress(id)));
router.post("/reset/new-player", tool((id) => resetToNewPlayer(id)));

export default router;
