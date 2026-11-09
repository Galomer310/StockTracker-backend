import express from "express";                 // Import express
import { listPortfolios, createPortfolio } from "../controllers/portfolioController";
import { authenticateUser } from "../middleware/authMiddleware"; // Authentication middleware
import { watchlistLimiter } from "../middleware/rateLimiter";    // Per-user limit
import { portfolioHistory, portfolioInsights } from "../performance/service"; // Rebuilt daily values, Module 5
import { getAllocation, getComposition } from "../controllers/portfolioDashboardController";

const router = express.Router();               // Create a new router instance

// These are the caller's own portfolios, so a valid token is required.
// authenticateUser runs first so the limiter can key on the user id.
router.use(authenticateUser, watchlistLimiter);

// GET /portfolios - every portfolio the caller owns, valued
router.get("/", listPortfolios);

// POST /portfolios - open a new one, up to the account's limit
router.post("/", createPortfolio);

// GET /portfolios/:id/allocation - holdings, exposures and capital (owner)
router.get("/:id/allocation", getAllocation);

// GET /portfolios/:id/composition - the composition at every change (owner)
router.get("/:id/composition", getComposition);

// GET /portfolios/:id/history - the owner's portfolio value on every date
// since it opened, rebuilt from its record (src/performance). Contains money,
// so only ever the caller's own portfolio.
router.get("/:id/history", async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid portfolio id" });
    return;
  }
  try {
    const history = await portfolioHistory(id, (req as any).user.id);
    if (!history) {
      res.status(404).json({ error: "Portfolio not found" });
      return;
    }
    res.json(history);
  } catch (error) {
    next(error);
  }
});

// GET /portfolios/:id/insights - Module 5, Performance Insights: returns,
// months, drawdown, best and worst days, and the same-dates comparison with
// the S&P 500 and NASDAQ-100 stand-ins. The owner's own portfolio only.
router.get("/:id/insights", async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid portfolio id" });
    return;
  }
  try {
    const insights = await portfolioInsights(id, (req as any).user.id);
    if (!insights) {
      res.status(404).json({ error: "Portfolio not found" });
      return;
    }
    res.json(insights);
  } catch (error) {
    next(error);
  }
});

// There is no delete route yet. Deleting a portfolio would erase its trade
// history from the public record, which is the one thing the removal window on
// a single buy exists to prevent - so it needs a rule of its own first.

export default router;                         // Export the router
