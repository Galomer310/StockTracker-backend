import { RequestHandler } from "express";
import pool from "../config/db";
import { localDate } from "../metrics/calendar";
import { allocationSlices, weightedAverageBuyPrice } from "../metrics/portfolio";
import { compositionEvents } from "../performance/composition";
import { PricePoint } from "../performance/history";
import { valuePortfolio } from "./portfolioController";

/* ===========================================================================
   The Portfolio Dashboard (spec Part 1, Module 1 and Portfolio History).
   ---------------------------------------------------------------------------
   GET /portfolios/:id/allocation   the composition now, for the chart, the
                                    holding panel and the expanded dashboard
   GET /portfolios/:id/composition  the composition at every change, for
                                    Portfolio History (and Module 2 later)

   Both are the owner's own for now: who else may see a portfolio is the
   subscription system's decision, which does not exist yet.
   =========================================================================== */

const owned = async (portfolioId: number, userId: number) =>
  (
    await pool.query(
      `SELECT id, name, status, starting_balance, COALESCE(capital_base, starting_balance) AS capital_base, cash, created_at
       FROM portfolios WHERE id = $1 AND user_id = $2`,
      [portfolioId, userId]
    )
  ).rows[0] ?? null;

// A DATE column as "YYYY-MM-DD" (node-postgres reads DATE as local midnight).
export const dateText = (d: Date | string): string => {
  if (typeof d === "string") return d.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const idParam = (raw: unknown): number | null => {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
};

// GET /portfolios/:id/allocation
export const getAllocation: RequestHandler = async (req, res, next) => {
  const id = idParam(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid portfolio id" });
    return;
  }
  try {
    const p = await owned(id, (req as any).user.id);
    if (!p) {
      res.status(404).json({ error: "Portfolio not found" });
      return;
    }
    const [lotsR, earnedR] = await Promise.all([
      pool.query(
        `SELECT w.stock_symbol, w.price_at_time, w.quantity, w.added_at, w.industry, s.last_price, s.updated_at
         FROM watchlist w LEFT JOIN stocks s ON s.stock_symbol = w.stock_symbol
         WHERE w.portfolio_id = $1 ORDER BY w.added_at, w.id`,
        [id]
      ),
      pool.query(
        `SELECT COALESCE(SUM(cash_after - cash_before), 0) AS earned, COUNT(*)::int AS rewards
         FROM capital_adjustments WHERE portfolio_id = $1`,
        [id]
      ),
    ]);

    // Lots of the same symbol make one position.
    const bySymbol = new Map<string, any[]>();
    for (const lot of lotsR.rows) bySymbol.set(lot.stock_symbol, [...(bySymbol.get(lot.stock_symbol) ?? []), lot]);

    const positions = [...bySymbol.entries()].map(([symbol, lots]) => {
      const shares = lots.reduce((s, l) => s + Number(l.quantity), 0);
      const avg = weightedAverageBuyPrice(lots.map((l) => ({ quantity: Number(l.quantity), price: Number(l.price_at_time) })));
      // As every screen values it: the cached close, or what was paid.
      const priced = lots.find((l) => l.last_price !== null);
      const priceNow = priced ? Number(priced.last_price) : avg ?? 0;
      // The sector recorded with the most recent lot that has one.
      const sector = [...lots].reverse().find((l) => l.industry)?.industry ?? null;
      return {
        symbol,
        shares,
        market_value: shares * priceNow,
        added_at: lots[0].added_at,
        avg_buy_price: avg,
        price_now: priceNow,
        price_is_estimate: !priced,
        gain_pct: avg ? (priceNow / avg - 1) * 100 : null,
        sector,
      };
    });

    const summary = valuePortfolio({
      ...p,
      positions_value: positions.reduce((s, x) => s + x.market_value, 0),
      holdings_count: positions.length,
    });
    const equity = summary.equity;
    const slices = allocationSlices(
      positions.map((x) => ({ symbol: x.symbol, market_value: x.market_value })),
      Number(p.cash)
    );

    res.json({
      portfolio: { id: p.id, name: p.name, status: p.status, created_at: p.created_at },
      summary: {
        starting_capital: summary.starting_balance,
        capital_base: summary.capital_base,
        capital_earned: Number(earnedR.rows[0].earned),
        capital_rewards: earnedR.rows[0].rewards,
        return_pct: summary.return_pct,
        cash_pct: equity > 0 ? (summary.cash / equity) * 100 : 0,
      },
      slices: (slices ?? []).map((s) => ({ ...s, weight_pct: s.weight * 100 })),
      holdings: positions
        .map((x) => ({
          symbol: x.symbol,
          exposure_pct: equity > 0 ? (x.market_value / equity) * 100 : 0,
          added_at: x.added_at,
          avg_buy_price: x.avg_buy_price,
          price_now: x.price_now,
          price_is_estimate: x.price_is_estimate,
          gain_pct: x.gain_pct,
          sector: x.sector,
        }))
        .sort((a, b) => b.exposure_pct - a.exposure_pct || a.symbol.localeCompare(b.symbol)),
    });
  } catch (error) {
    next(error);
  }
};

// GET /portfolios/:id/composition
export const getComposition: RequestHandler = async (req, res, next) => {
  const id = idParam(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid portfolio id" });
    return;
  }
  try {
    const p = await owned(id, (req as any).user.id);
    if (!p) {
      res.status(404).json({ error: "Portfolio not found" });
      return;
    }
    const [tradesR, flowsR] = await Promise.all([
      // Dated by execution, like the portfolio history (src/performance).
      pool.query(
        `SELECT id, created_at, stock_symbol, action, quantity, price, note
         FROM trade_notes WHERE portfolio_id = $1 ORDER BY created_at, id`,
        [id]
      ),
      pool.query("SELECT applied_at, cash_after - cash_before AS amount FROM capital_adjustments WHERE portfolio_id = $1", [id]),
    ]);
    const symbols = [...new Set(tradesR.rows.map((t) => t.stock_symbol as string))];
    const closesR = symbols.length
      ? await pool.query("SELECT symbol, date, close FROM daily_prices WHERE symbol = ANY($1::text[]) ORDER BY symbol, date", [symbols])
      : { rows: [] as any[] };
    const closes: Record<string, PricePoint[]> = {};
    for (const r of closesR.rows) {
      (closes[r.symbol] ??= []).push({ date: dateText(r.date), close: Number(r.close) });
    }
    const notes = new Map(tradesR.rows.map((t) => [t.id, t.note]));
    const events = compositionEvents({
      startingBalance: Number(p.starting_balance),
      trades: tradesR.rows.map((t) => ({
        id: t.id,
        at: new Date(t.created_at).toISOString(),
        date: localDate(new Date(t.created_at)),
        symbol: t.stock_symbol,
        action: t.action,
        quantity: Number(t.quantity),
        price: Number(t.price),
      })),
      flows: flowsR.rows.map((f) => ({ at: new Date(f.applied_at).toISOString(), amount: Number(f.amount) })),
      closes,
    });

    // Newest first, as the spec lays the history out.
    res.json({
      portfolio: { id: p.id, name: p.name },
      symbols: symbols.sort(),
      events: events.reverse().map((e) => ({ ...e, note: notes.get(e.trade_id) ?? null })),
    });
  } catch (error) {
    next(error);
  }
};
