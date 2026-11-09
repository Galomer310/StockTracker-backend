import { closeOn, PricePoint } from "./history";

/* ===========================================================================
   The portfolio's composition at every change (spec Module 1 "Portfolio
   History", Module 2 "Previous / New Exposure" and View B).
   ---------------------------------------------------------------------------
   Each trade is an event. For each one: the weights of every holding and of
   cash just before it and just after it, and what kind of change it was:

     Added      a buy into a symbol not held
     Increased  a buy into a symbol already held
     Reduced    a sale that leaves shares
     Removed    a sale of the last shares

   Weights are shares of the whole portfolio, cash included, exactly like
   the allocation chart (exposure weights), so "Previous Exposure 30% -> New
   Exposure 35%" means the same here as on the chart. At the moment of a
   trade, the traded symbol is valued at the trade's own price and every
   other holding at its last close on or before that date (or, with none,
   its last trade price), so the two sides of an event differ only by the
   trade itself. Capital rewards arrive at the moment they were applied.

   Pure: the database side is in the dashboard controller.
   =========================================================================== */

export interface TradeAt {
  id: number;
  /** ISO timestamp of execution. */
  at: string;
  /** Calendar date of execution (platform zone), for picking closes. */
  date: string;
  symbol: string;
  action: "buy" | "sell";
  quantity: number;
  price: number;
}

export interface FlowAt {
  at: string;
  amount: number;
}

export type ChangeKind = "added" | "increased" | "reduced" | "removed";

/** Weights by symbol, plus CASH. They total 1. */
export type EventWeights = Record<string, number>;

export interface CompositionEvent {
  trade_id: number;
  at: string;
  symbol: string;
  action: "buy" | "sell";
  kind: ChangeKind;
  quantity: number;
  price: number;
  before: EventWeights;
  after: EventWeights;
}

export const CASH = "CASH";

const cents = (x: number) => Math.round(x * 100) / 100;

const weightsOf = (
  shares: Record<string, number>,
  cash: number,
  priceOf: (symbol: string) => number
): EventWeights => {
  const values: Record<string, number> = {};
  let total = cash;
  for (const [s, q] of Object.entries(shares)) {
    if (q === 0) continue;
    values[s] = q * priceOf(s);
    total += values[s];
  }
  if (!(total > 0)) return {};
  const out: EventWeights = { [CASH]: cash / total };
  for (const [s, v] of Object.entries(values)) out[s] = v / total;
  return out;
};

export const changeKind = (action: "buy" | "sell", sharesBefore: number, sharesAfter: number): ChangeKind =>
  action === "buy" ? (sharesBefore > 0 ? "increased" : "added") : sharesAfter > 0 ? "reduced" : "removed";

export const compositionEvents = (input: {
  startingBalance: number;
  trades: TradeAt[];
  flows: FlowAt[];
  closes: Record<string, PricePoint[]>;
}): CompositionEvent[] => {
  const trades = [...input.trades].sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
  const flows = [...input.flows].sort((a, b) => a.at.localeCompare(b.at));
  let cash = input.startingBalance;
  let f = 0;
  const shares: Record<string, number> = {};
  const lastTrade: Record<string, number> = {};
  const out: CompositionEvent[] = [];

  for (const t of trades) {
    while (f < flows.length && flows[f].at <= t.at) cash = cents(cash + flows[f++].amount);
    const priceOf = (s: string) =>
      s === t.symbol ? t.price : closeOn(input.closes[s], t.date) ?? lastTrade[s] ?? t.price;

    const before = weightsOf(shares, cash, priceOf);
    const held = shares[t.symbol] ?? 0;
    const amount = cents(t.price * t.quantity);
    const heldAfter = t.action === "buy" ? held + t.quantity : held - t.quantity;
    cash = cents(t.action === "buy" ? cash - amount : cash + amount);
    shares[t.symbol] = heldAfter;
    lastTrade[t.symbol] = t.price;
    const after = weightsOf(shares, cash, priceOf);

    out.push({
      trade_id: t.id,
      at: t.at,
      symbol: t.symbol,
      action: t.action,
      kind: changeKind(t.action, held, heldAfter),
      quantity: t.quantity,
      price: t.price,
      before,
      after,
    });
  }
  return out;
};
