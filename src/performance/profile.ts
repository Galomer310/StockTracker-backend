import { CONCENTRATION_WEIGHTS, LOW_LIQUIDITY_DOLLAR_VOLUME_USD, RISK_BANDS, RISK_WEIGHTS, TRADING_DAYS_PER_YEAR, VOLATILITY_WINDOW_DAYS } from "../metrics/config";
import { effectiveHoldings, largestPosition, largestSectorWeight, sectorHHI, topHoldingsWeight } from "../metrics/concentration";
import { maxDrawdown } from "../metrics/drawdown";
import { turnoverEvent } from "../metrics/turnover";
import { dailyMoveStats, sampleStdDev } from "../metrics/volatility";
import { CASH, EventWeights } from "./composition";
import { SessionPoint } from "./insights";

/* ===========================================================================
   Module 3 - Investment Profile (spec Part 1). Pure; no database.
   ---------------------------------------------------------------------------
   Five dimensions, each a 0-100 meter with a result: Risk, Portfolio
   Volatility, Diversification, Investment Horizon, Portfolio Turnover.

   The spec gives the formulas (Risk = 30% volatility + 25% drawdown + 20%
   concentration + 15% liquidity + 10% turnover; Concentration = 40%
   effective holdings + 25% largest position + 15% top 3 + 20% sector;
   Diversification = 100 - Concentration) but not how a raw measure becomes
   0-100. Gal approved these scales on 2026-11-09, provisional and
   configurable (setting `risk_scales`): linear and clamped between the two
   ends, except effective holdings, on a log scale.

   Rules the spec leaves open, decided here and flagged for review:
   - Volatility: annualized, over the last 90 sessions; a younger portfolio
     is measured over what it has once it has MIN_VOLATILITY_SESSIONS.
   - Concentration uses invested weights (cash is not a company), as the
     spec requires for Effective Holdings; liquidity uses portfolio weights,
     like Module 4's Low Volume Exposure.
   - A holding with no recorded sector counts as a sector of its own.
   - Turnover counts invested weights (buying from a pile of cash replaces
     nothing); the 90-day figure is the sum of the events in 90 days.
   - Horizon: the median holding period weighted by the money put in, over
     every bought lot (sold first-in first-out; open lots count to today).
   =========================================================================== */

export interface LinearScale {
  /** Raw value scoring 0. */
  low: number;
  /** Raw value scoring 100. */
  high: number;
}

export interface ProfileScales {
  volatility: LinearScale;
  max_drawdown: LinearScale;
  liquidity: LinearScale;
  turnover: LinearScale;
  /** Effective holdings at or above this score 0; one holding scores 100. */
  effective_holdings_full: number;
  largest_position: LinearScale;
  top3: LinearScale;
  largest_sector: LinearScale;
  sector_hhi: LinearScale;
  low_liquidity_usd: number;
  /** Upper bounds in days: Very Short, Short, Medium, Long; above = Very Long. */
  horizon_days: [number, number, number, number];
}

export const DEFAULT_SCALES: ProfileScales = {
  volatility: { low: 0.05, high: 0.55 },
  max_drawdown: { low: 0, high: 0.5 },
  liquidity: { low: 0, high: 0.5 },
  turnover: { low: 0, high: 2 },
  effective_holdings_full: 20,
  largest_position: { low: 0.05, high: 0.5 },
  top3: { low: 0.15, high: 0.9 },
  largest_sector: { low: 0.2, high: 1 },
  sector_hhi: { low: 0.1, high: 1 },
  low_liquidity_usd: LOW_LIQUIDITY_DOLLAR_VOLUME_USD,
  horizon_days: [7, 30, 90, 365],
};

/** Fewer sessions than this and volatility (and so Risk) is not shown yet. */
export const MIN_VOLATILITY_SESSIONS = 20;
export const TURNOVER_WINDOW_DAYS = 90;

export const linearScore = (x: number, s: LinearScale): number => {
  const v = (100 * (x - s.low)) / (s.high - s.low);
  return Math.min(100, Math.max(0, v));
};

export const effectiveHoldingsScore = (n: number, full: number): number => {
  if (n >= full) return 0;
  if (n <= 1) return 100;
  return 100 * (1 - Math.log(n) / Math.log(full));
};

export type Band = (typeof RISK_BANDS)[number]["label"];
export const bandOf = (score: number): Band => RISK_BANDS.find((b) => score <= b.max)!.label;

const HORIZON = ["Very Short", "Short", "Medium", "Long", "Very Long"] as const;
export type HorizonCategory = (typeof HORIZON)[number];

export interface Holding {
  symbol: string;
  value: number;
  sector: string | null;
}

export interface LotTrade {
  date: string;
  symbol: string;
  action: "buy" | "sell";
  quantity: number;
  price: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** Weights of the holdings alone, cash left out, totalling 1 (empty when nothing is invested). */
export const investedOnly = (w: EventWeights): Record<string, number> => {
  const entries = Object.entries(w).filter(([k, v]) => k !== CASH && v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  return total > 0 ? Object.fromEntries(entries.map(([k, v]) => [k, v / total])) : {};
};

/** Holding periods of every bought lot, FIFO, with the money each put in. */
export const holdingPeriods = (trades: LotTrade[], today: string) => {
  const open = new Map<string, { date: string; qty: number; price: number }[]>();
  const pieces: { days: number; amount: number; open: boolean }[] = [];
  for (const t of trades) {
    const lots = open.get(t.symbol) ?? [];
    if (t.action === "buy") {
      lots.push({ date: t.date, qty: t.quantity, price: t.price });
      open.set(t.symbol, lots);
      continue;
    }
    let left = t.quantity;
    while (left > 0 && lots.length > 0) {
      const lot = lots[0];
      const used = Math.min(left, lot.qty);
      pieces.push({ days: daysBetween(lot.date, t.date), amount: used * lot.price, open: false });
      lot.qty -= used;
      left -= used;
      if (lot.qty === 0) lots.shift();
    }
  }
  for (const lots of open.values()) {
    for (const lot of lots) pieces.push({ days: daysBetween(lot.date, today), amount: lot.qty * lot.price, open: true });
  }
  return pieces;
};

export const weightedMedian = (items: { value: number; weight: number }[]): number | null => {
  const xs = items.filter((i) => i.weight > 0).sort((a, b) => a.value - b.value);
  const total = xs.reduce((s, i) => s + i.weight, 0);
  if (!(total > 0)) return null;
  let acc = 0;
  for (const i of xs) {
    acc += i.weight;
    if (acc >= total / 2) return i.value;
  }
  return xs[xs.length - 1].value;
};

export interface ProfileInput {
  today: string;
  /** From sessionPoints(): the index on the opening date and every session after it. */
  points: SessionPoint[] | null;
  holdings: Holding[];
  cash: number;
  /** Average daily dollar volume over the last 20 sessions, by symbol; null = no data. */
  dollarVolume: Record<string, number | null>;
  /** Composition events (exposure weights with CASH), oldest first, dated by calendar date. */
  events: { date: string; before: EventWeights; after: EventWeights }[];
  trades: LotTrade[];
  scales?: ProfileScales;
}

type Unavailable = { available: false; reason: "too_short" | "no_holdings" | "missing_data" };

export const computeProfile = (input: ProfileInput) => {
  const s = input.scales ?? DEFAULT_SCALES;
  const points = input.points ?? [];

  // ---- Volatility and drawdown, on the performance index, sessions only.
  const returns = points.slice(1).map((p, i) => ({ date: p.date, value: p.index / points[i].index - 1 }));
  const window = returns.slice(-VOLATILITY_WINDOW_DAYS);
  const dailySd = window.length >= MIN_VOLATILITY_SESSIONS ? sampleStdDev(window.map((r) => r.value)) : null;
  const moves = dailyMoveStats(window);
  const volatility =
    dailySd === null
      ? ({ available: false, reason: "too_short", sessions: returns.length, needed: MIN_VOLATILITY_SESSIONS } as const)
      : (() => {
          const annualized = dailySd * Math.sqrt(TRADING_DAYS_PER_YEAR);
          const score = linearScore(annualized, s.volatility);
          return {
            available: true as const,
            annualized,
            daily: dailySd,
            sessions: window.length,
            full_window: window.length >= VOLATILITY_WINDOW_DAYS,
            score,
            band: bandOf(score),
            average_positive_day: moves.average_positive_day,
            average_negative_day: moves.average_negative_day,
            max_daily_gain: moves.max_daily_gain,
            max_daily_loss: moves.max_daily_loss,
          };
        })();
  const dd = points.length >= 2 ? maxDrawdown(points.map((p) => ({ date: p.date, value: p.index })))! : null;
  const drawdown = dd ? { value: dd.value, peak_date: dd.peak_date, trough_date: dd.trough_date, score: linearScore(-dd.value, s.max_drawdown) } : null;

  // ---- Concentration and diversification, on invested weights.
  const invested = input.holdings.filter((h) => h.value > 0);
  const investedTotal = invested.reduce((t, h) => t + h.value, 0);
  const equity = investedTotal + input.cash;
  let concentration: { score: number; parts: Record<string, unknown> } | null = null;
  if (investedTotal > 0) {
    const w = Object.fromEntries(invested.map((h) => [h.symbol, h.value / investedTotal]));
    // A holding without a recorded sector is a sector of its own: nothing says it shares one.
    const sectors: Record<string, number> = {};
    const unclassified: string[] = [];
    for (const h of invested) {
      const key = h.sector ?? `unclassified:${h.symbol}`;
      if (!h.sector) unclassified.push(h.symbol);
      sectors[key] = (sectors[key] ?? 0) + h.value / investedTotal;
    }
    const n = effectiveHoldings(w)!;
    const largest = largestPosition(w)!;
    const top3 = topHoldingsWeight(w);
    const bigSector = largestSectorWeight(sectors);
    const bigSectorName = Object.entries(sectors).find(([, v]) => v === bigSector)![0];
    const hhi = sectorHHI(sectors);
    const sub = {
      effective_holdings: effectiveHoldingsScore(n, s.effective_holdings_full),
      largest_position: linearScore(largest.weight, s.largest_position),
      top_3_holdings: linearScore(top3, s.top3),
      sector_concentration: (linearScore(bigSector, s.largest_sector) + linearScore(hhi, s.sector_hhi)) / 2,
    };
    const score =
      CONCENTRATION_WEIGHTS.effective_holdings * sub.effective_holdings +
      CONCENTRATION_WEIGHTS.largest_position * sub.largest_position +
      CONCENTRATION_WEIGHTS.top_3_holdings * sub.top_3_holdings +
      CONCENTRATION_WEIGHTS.sector_concentration * sub.sector_concentration;
    concentration = {
      score,
      parts: {
        effective_holdings: { value: n, holdings: invested.length, score: sub.effective_holdings },
        largest_position: { symbol: largest.symbol, weight: largest.weight, score: sub.largest_position },
        top_3: { weight: top3, score: sub.top_3_holdings },
        sector: {
          largest: bigSectorName.startsWith("unclassified:") ? null : bigSectorName,
          largest_weight: bigSector,
          hhi,
          score: sub.sector_concentration,
          unclassified,
        },
      },
    };
  }
  const diversification = concentration
    ? { available: true as const, score: 100 - concentration.score, band: bandOf(100 - concentration.score), concentration: concentration.score, parts: concentration.parts }
    : ({ available: false, reason: "no_holdings" } as const);

  // ---- Liquidity: portfolio weight in low dollar-volume holdings.
  const unknown = invested.filter((h) => input.dollarVolume[h.symbol] == null).map((h) => h.symbol);
  const lowWeight =
    equity > 0
      ? invested.filter((h) => (input.dollarVolume[h.symbol] ?? Infinity) < s.low_liquidity_usd).reduce((t, h) => t + h.value / equity, 0)
      : 0;
  const liquidity =
    invested.length > 0 && unknown.length === invested.length
      ? null
      : { low_liquidity_weight: lowWeight, score: linearScore(lowWeight, s.liquidity), threshold_usd: s.low_liquidity_usd, unknown };

  // ---- Turnover over the last 90 days, invested weights.
  const since = new Date(Date.parse(`${input.today}T00:00:00Z`) - TURNOVER_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  let turnoverSum = 0;
  let turnoverEvents = 0;
  for (const e of input.events) {
    if (e.date <= since) continue;
    const before = investedOnly(e.before);
    const after = investedOnly(e.after);
    turnoverEvents++;
    if (Object.keys(before).length === 0 || Object.keys(after).length === 0) continue;
    turnoverSum += turnoverEvent(before, after);
  }
  const turnoverScore = linearScore(turnoverSum, s.turnover);
  const turnover = { value: turnoverSum, events: turnoverEvents, window_days: TURNOVER_WINDOW_DAYS, score: turnoverScore, band: bandOf(turnoverScore) };

  // ---- Horizon.
  const pieces = holdingPeriods(input.trades, input.today);
  const median = weightedMedian(pieces.map((p) => ({ value: p.days, weight: p.amount })));
  const horizon =
    median === null
      ? ({ available: false, reason: "no_holdings" } as const)
      : (() => {
          const i = s.horizon_days.findIndex((max) => median <= max);
          const idx = i === -1 ? 4 : i;
          return {
            available: true as const,
            median_days: median,
            category: HORIZON[idx],
            // Position on the meter: the five categories spread across 0-100.
            meter: idx * 25,
            lots: pieces.length,
            open_lots: pieces.filter((p) => p.open).length,
          };
        })();

  // ---- Risk.
  let risk: ({ available: true; score: number; band: Band; components: Record<string, number> }) | Unavailable;
  if (!volatility.available || !drawdown) risk = { available: false, reason: "too_short" };
  else if (invested.length > 0 && !liquidity) risk = { available: false, reason: "missing_data" };
  else {
    const components = {
      volatility: volatility.score,
      max_drawdown: drawdown.score,
      concentration: concentration?.score ?? 0,
      liquidity: liquidity?.score ?? 0,
      turnover: turnoverScore,
    };
    const score =
      RISK_WEIGHTS.volatility * components.volatility +
      RISK_WEIGHTS.max_drawdown * components.max_drawdown +
      RISK_WEIGHTS.concentration * components.concentration +
      RISK_WEIGHTS.liquidity * components.liquidity +
      RISK_WEIGHTS.turnover * components.turnover;
    risk = { available: true, score, band: bandOf(score), components };
  }

  return { risk, volatility, max_drawdown: drawdown, diversification, liquidity, turnover, horizon };
};

export type Profile = ReturnType<typeof computeProfile>;
