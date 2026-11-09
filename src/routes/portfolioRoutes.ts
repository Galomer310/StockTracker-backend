import express from "express";                 // Import express
import { listPortfolios, createPortfolio } from "../controllers/portfolioController";
import { authenticateUser } from "../middleware/authMiddleware"; // Authentication middleware
import { watchlistLimiter } from "../middleware/rateLimiter";    // Per-user limit
import { ComparisonError, portfolioHistory, portfolioIndexComparison, portfolioInsights, portfolioProfile } from "../performance/service"; // Rebuilt daily values, Modules 3 and 5, index comparison
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

// GET /portfolios/:id/profile - Module 3, Investment Profile: Risk,
// Volatility, Diversification, Horizon and Turnover, each a 0-100 meter
// with its parts. The owner's own portfolio only.
router.get("/:id/profile", async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid portfolio id" });
    return;
  }
  try {
    const profile = await portfolioProfile(id, (req as any).user.id);
    if (!profile) {
      res.status(404).json({ error: "Portfolio not found" });
      return;
    }
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

// GET /portfolios/:id/compare-index?index=dow&from=YYYY-MM-DD&to=YYYY-MM-DD
// The portfolio against one market index (S&P 500, Nasdaq Composite, Dow
// Jones, Russell 2000) over the same dates, rebased to 100. A comparison
// only: it never changes Beat the Market eligibility. Owner only.
router.get("/:id/compare-index", async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid portfolio id" });
    return;
  }
  try {
    const result = await portfolioIndexComparison(id, (req as any).user.id, req.query);
    if (!result) {
      res.status(404).json({ error: "Portfolio not found" });
      return;
    }
    res.json(result);
  } catch (error) {
    if (error instanceof ComparisonError) {
      res.status(400).json({ error: "This comparison is not valid.", code: error.code });
      return;
    }
    next(error);
  }
});

// There is no delete route yet. Deleting a portfolio would erase its trade
// history from the public record, which is the one thing the removal window on
// a single buy exists to prevent - so it needs a rule of its own first.

export default router;                         // Export the router
