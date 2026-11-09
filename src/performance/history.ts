/* ===========================================================================
   A portfolio's value on every calendar day, rebuilt from its record.
   ---------------------------------------------------------------------------
   Professional achievements (Beat the Market, return milestones, Green
   Months, recoveries) are measured on a portfolio's history, which the
   database never stored: only the current cash and holdings. Everything
   needed to rebuild it is on record, though:

     - the opening balance and date,
     - every buy and sell (trade_notes), with quantity and price,
     - every capital growth reward (capital_adjustments), an external flow,
     - each symbol's daily close (daily_prices).

   For each calendar date D, after applying everything that happened on D:

     cash(D)      = opening balance - buys + sells + capital added, to date
     positions(D) = sum over symbols of shares held x the last close on or
                    before D (a weekend or holiday keeps Friday's close)
     nav(D)       = cash(D) + positions(D)

   Rules:
   - A trade is dated by when it was EXECUTED (created_at), not the date the
     player wrote on it (occurred_at, which may be backdated). Every trade
     executes at the current price, so dating a buy in the past would make
     up a return that never happened.
   - Cash moves exactly as the trade code moves it: price x quantity,
     rounded to the cent.
   - A symbol with no close yet on or before D is valued at the price of
     its latest trade, as every screen does (POSITION_VALUES), and the day
     says so (estimated_symbols), so nothing is awarded on a guess.
   - Closes are UNADJUSTED: holdings are never adjusted for splits, so a
     split-adjusted close would misvalue shares bought before a split.
     Splits and dividends remain an open decision (spec, section 31).
   - Capital growth arrives at the END of its day, like every flow in the
     metric engine (src/metrics/returns.ts), so it never reads as return.

   Pure: the database side is in ./service.ts.
   =========================================================================== */

/**
 * The last US trading date whose close is final at `now`: today's once it
 * is well past the 16:00 New York close (20:00, leaving time for the data to
 * settle), otherwise yesterday's.
 */
export const lastFinalSession = (now: Date): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  return Number(get("hour")) >= 20 ? date : addDays(date, -1);
};

export interface TradeEvent {
  /** Calendar date (platform zone) the trade was executed. */
  date: string;
  symbol: string;
  action: "buy" | "sell";
  quantity: number;
  price: number;
}

export interface FlowEvent {
  /** Calendar date the capital arrived. */
  date: string;
  /** Cash added; positive. */
  amount: number;
}

export interface PricePoint {
  /** US trading date of the close. */
  date: string;
  close: number;
}

export interface DayValue {
  date: string;
  cash: number;
  positions_value: number;
  nav: number;
  /** Capital added on this date (already in cash and nav). */
  external_flow: number;
  /** Shares held at the end of the day, by symbol. */
  holdings: Record<string, number>;
  /** Symbols valued at a trade price because no close was available. */
  estimated_symbols: string[];
}

const cents = (x: number) => Math.round(x * 100) / 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export const addDays = (date: string, n: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** The last close on or before `date`, from an ascending series. */
export const closeOn = (series: PricePoint[] | undefined, date: string): number | null => {
  if (!series || series.length === 0) return null;
  let lo = 0;
  let hi = series.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].date <= date) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found >= 0 ? series[found].close : null;
};

export const reconstructDailyValues = (input: {
  startingBalance: number;
  openedOn: string;
  through: string;
  trades: TradeEvent[];
  flows: FlowEvent[];
  closes: Record<string, PricePoint[]>;
}): DayValue[] => {
  const { startingBalance, openedOn, through } = input;
  if (through < openedOn) return [];

  const byDate = <T extends { date: string }>(items: T[]) => {
    const map = new Map<string, T[]>();
    for (const item of items) {
      // Anything dated before the opening counts on the opening day.
      const date = item.date < openedOn ? openedOn : item.date;
      const list = map.get(date) ?? [];
      list.push(item);
      map.set(date, list);
    }
    return map;
  };
  const tradesOn = byDate(input.trades);
  const flowsOn = byDate(input.flows);

  let cash = startingBalance;
  const shares: Record<string, number> = {};
  const lastTradePrice: Record<string, number> = {};
  const out: DayValue[] = [];

  for (let date = openedOn; date <= through; date = addDays(date, 1)) {
    for (const t of tradesOn.get(date) ?? []) {
      const amount = cents(t.price * t.quantity);
      if (t.action === "buy") {
        cash -= amount;
        shares[t.symbol] = (shares[t.symbol] ?? 0) + t.quantity;
      } else {
        cash += amount;
        shares[t.symbol] = (shares[t.symbol] ?? 0) - t.quantity;
      }
      lastTradePrice[t.symbol] = t.price;
    }
    let flow = 0;
    for (const f of flowsOn.get(date) ?? []) flow += f.amount;
    cash = cents(cash + flow);

    let positions = 0;
    const estimated: string[] = [];
    const holdings: Record<string, number> = {};
    for (const [symbol, qty] of Object.entries(shares)) {
      if (qty === 0) continue;
      holdings[symbol] = qty;
      const close = closeOn(input.closes[symbol], date);
      if (close !== null) {
        positions += qty * close;
      } else {
        positions += qty * lastTradePrice[symbol];
        estimated.push(symbol);
      }
    }
    out.push({
      date,
      cash,
      positions_value: positions,
      nav: cash + positions,
      external_flow: cents(flow),
      holdings,
      estimated_symbols: estimated.sort(),
    });
  }
  return out;
};

/**
 * The genuine performance index: 1 on the opening day, moved only by
 * investing. Capital growth is stripped out as a flow, so it neither lifts
 * the index nor counts as return. Stops (null) from the first day the NAV
 * is not positive, where a return is undefined.
 */
export const performanceIndexOf = (days: DayValue[]): (number | null)[] => {
  const out: (number | null)[] = [];
  let index: number | null = 1;
  for (let i = 0; i < days.length; i++) {
    if (i === 0) {
      out.push(days[0].nav > 0 ? 1 : null);
      if (!(days[0].nav > 0)) index = null;
      continue;
    }
    const prev = days[i - 1].nav;
    if (index === null || !(prev > 0) || !(days[i].nav > 0)) {
      index = null;
      out.push(null);
      continue;
    }
    index = index * ((days[i].nav - days[i].external_flow) / prev);
    out.push(index);
  }
  return out;
};

/**
 * Whether the rebuilt record ends where the live portfolio is. If the cash
 * or the shares differ, something happened that the record does not show,
 * and nothing should be awarded from this history.
 */
export const checkAgainstLive = (
  last: DayValue | undefined,
  live: { cash: number; holdings: Record<string, number> }
): { ok: true } | { ok: false; reason: string } => {
  if (!last) return { ok: false, reason: "no history" };
  if (Math.abs(last.cash - live.cash) > 0.011) {
    return { ok: false, reason: `cash ${last.cash.toFixed(2)} rebuilt vs ${live.cash.toFixed(2)} live` };
  }
  const symbols = new Set([...Object.keys(last.holdings), ...Object.keys(live.holdings)]);
  for (const s of symbols) {
    const a = last.holdings[s] ?? 0;
    const b = live.holdings[s] ?? 0;
    if (a !== b) return { ok: false, reason: `${s}: ${a} shares rebuilt vs ${b} live` };
  }
  return { ok: true };
};

/**
 * The last date up to which every day's value is final: the day is over
 * (no later than `yesterday`), and every symbol held THAT day has its closes
 * complete through it (`coverage`). A day only depends on what was held on
 * it, so a stock bought today cannot hold back two months of history. Null
 * when not even the first day is final.
 */
export const finalThrough = (
  days: DayValue[],
  coverage: Record<string, string | null | undefined>,
  yesterday: string
): string | null => {
  let last: string | null = null;
  for (const day of days) {
    if (day.date > yesterday || day.estimated_symbols.length > 0) break;
    const ready = Object.keys(day.holdings).every((s) => {
      const c = coverage[s];
      return !!c && c >= day.date;
    });
    if (!ready) break;
    last = day.date;
  }
  return last;
};
