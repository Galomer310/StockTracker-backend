import { addDays, closeOn, PricePoint } from "../performance/history";
import type { DayIndex, ProRecord } from "./engine";
import { monthEnd, monthStart, nextQuarter, quarterMonths, quarterOf } from "./periods";

/* ===========================================================================
   Professional achievements, stage 3: Risk & Discipline. Pure.
   ---------------------------------------------------------------------------
   Spec v1.0 sections 21-25. Same conventions as engine.ts (genuine index,
   SPY over identical dates, final days only, opening-date periods).

   "Downside from the opening baseline" (22): the lowest value in the period
   relative to the period's opening value, min(0, lowest / opening - 1) - NOT
   a peak-to-trough drawdown. "Better protection" means a less severe
   downside than the benchmark's over the same dates (strictly).

   Nothing here rewards a loss: the recovery achievements and the Phoenix
   medal fire only on a completed recovery, and a deeper fall earns nothing
   more (21, 25).

   Decided here where the spec is open (flagged in the docs):
   - Calm Under Fire, Capital Protector: quarters as for Beat the Market (a
     portfolio opened in the quarter's first two months is measured from its
     opening; the Capital Protector MEDAL needs the whole quarter).
   - Market Resilience: a calendar quarter in which the S&P 500 fell, the
     portfolio active the whole quarter, and its return above the benchmark's.
   - Back from the Edge / Phoenix Rise: every completed recovery is its own
     record (a new fall and a new recovery is a new event); one event is never
     rewarded twice.
   - Phoenix path: starts at a fall to -15% or lower and recovers at 0%; a new
     fall to -15% ends that path (its tiers stay) and starts the next one.
   =========================================================================== */

export interface RiskInput {
  openedOn: string;
  /** Final days only, ascending, from the opening date. */
  days: DayIndex[];
  benchmark: PricePoint[];
}

export interface RiskPeriod {
  period: string;
  start: string;
  end: string;
  from: string;
  portfolio_return: number;
  benchmark_return: number;
  portfolio_downside: number;
  benchmark_downside: number;
  partial: boolean;
}

export interface PhoenixPath {
  armed_on: string;
  recovered_on: string;
  /** Unlock dates, in order: The Comeback, The Recovery, Rising Phoenix, Phoenix Ascendant, The Immortal Phoenix. */
  tiers: string[];
}

export const BACK_FROM_EDGE_BELOW = -0.1;
export const PHOENIX_RISE_BELOW = -0.2;
export const PHOENIX_PATH_AT_OR_BELOW = -0.15;
export const PHOENIX_STABLE_DAYS = 30;

export const evaluateRisk = (input: RiskInput) => {
  const { openedOn, days, benchmark } = input;
  const records: ProRecord[] = [];
  const quarters: (RiskPeriod & { protector: boolean; medal_eligible: boolean })[] = [];
  const years: (RiskPeriod & { protected_win: boolean })[] = [];
  if (days.length === 0) return { records, quarters, years, phoenix: [] as PhoenixPath[] };
  const last = days[days.length - 1].date;
  const idx = new Map(days.map((d) => [d.date, d.index]));

  // A period's returns and downsides from its opening baseline, for both.
  const period = (name: string, start: string, end: string): RiskPeriod | null => {
    const from = openedOn >= start ? openedOn : addDays(start, -1);
    const p0 = idx.get(from);
    const b0 = closeOn(benchmark, from);
    if (p0 == null || b0 == null) return null;
    let pLow = 0;
    let bLow = 0;
    for (let d = addDays(from, 1); d <= end; d = addDays(d, 1)) {
      const p = idx.get(d);
      const b = closeOn(benchmark, d);
      if (p == null || b == null) return null;
      pLow = Math.min(pLow, p / p0 - 1);
      bLow = Math.min(bLow, b / b0 - 1);
    }
    const p1 = idx.get(end)!;
    const b1 = closeOn(benchmark, end)!;
    return {
      period: name, start, end, from,
      portfolio_return: p1 / p0 - 1,
      benchmark_return: b1 / b0 - 1,
      portfolio_downside: pLow,
      benchmark_downside: bLow,
      partial: openedOn >= start,
    };
  };
  const evidence = (r: RiskPeriod) => ({
    from: r.from, to: r.end, partial: r.partial,
    portfolio_downside: r.portfolio_downside, benchmark_downside: r.benchmark_downside,
  });

  // ---- Quarters: Calm Under Fire, Capital Protector, Market Resilience.
  const positiveQuarter = new Map<string, { positive: boolean; start: string; end: string }>();
  for (let q = quarterOf(openedOn); monthEnd(quarterMonths(q)[2]) <= last; q = nextQuarter(q)) {
    const [m1, m2, m3] = quarterMonths(q);
    const start = monthStart(m1);
    const end = monthEnd(m3);
    const opened = openedOn.slice(0, 7);
    if (openedOn >= start && opened !== m1 && opened !== m2) continue;
    const r = period(q, start, end);
    if (!r) break;
    const full = openedOn < start;
    if (full) positiveQuarter.set(q, { positive: r.portfolio_return > 0, start, end });
    const protector = r.portfolio_return > 0 && r.portfolio_downside > r.benchmark_downside;
    quarters.push({ ...r, protector, medal_eligible: full });
    const rec = (achievement_id: string, extra: Record<string, unknown> = {}) =>
      records.push({
        achievement_id, period_id: q, earned_on: end,
        qualifying_value: r.portfolio_return, benchmark_value: r.benchmark_return,
        outperformance: r.portfolio_return - r.benchmark_return,
        details: { ...evidence(r), ...extra },
      });
    if (r.portfolio_downside < 0 && r.portfolio_return > 0) rec("calm_under_fire");
    if (protector) rec("capital_protector", { medal_eligible: full });
    if (full && r.benchmark_return < 0 && r.portfolio_return > r.benchmark_return) rec("market_resilience");
  }

  // ---- Years: Steady Hands, Protected Upside (full calendar years only).
  for (let y = Number(openedOn.slice(0, 4)) + 1; `${y}-12-31` <= last; y++) {
    const r = period(String(y), `${y}-01-01`, `${y}-12-31`);
    if (!r) break;
    const better = r.portfolio_downside > r.benchmark_downside;
    const protected_win = r.portfolio_return > r.benchmark_return && better;
    years.push({ ...r, protected_win });
    const rec = (achievement_id: string) =>
      records.push({
        achievement_id, period_id: String(y), earned_on: r.end,
        qualifying_value: r.portfolio_return, benchmark_value: r.benchmark_return,
        outperformance: r.portfolio_return - r.benchmark_return, details: evidence(r),
      });
    if (r.portfolio_return > 0 && better) rec("steady_hands");
    if (protected_win) rec("protected_upside");
  }

  // ---- Recoveries: Back from the Edge, Phoenix Rise (23.1-23.2).
  const recoveries = (id: string, armBelow: number, recovered: (r: number) => boolean) => {
    let armed: { on: string; low: number } | null = null;
    for (const d of days) {
      if (d.index === null) break;
      const r = d.index - 1;
      if (!armed) {
        if (r < armBelow) armed = { on: d.date, low: r };
        continue;
      }
      armed.low = Math.min(armed.low, r);
      if (recovered(r)) {
        records.push({
          achievement_id: id, period_id: d.date, earned_on: d.date,
          qualifying_value: r, benchmark_value: null, outperformance: null,
          details: { fell_on: armed.on, low: armed.low },
        });
        armed = null;
      }
    }
  };
  recoveries("back_from_edge", BACK_FROM_EDGE_BELOW, (r) => r >= 0);
  recoveries("phoenix_rise", PHOENIX_RISE_BELOW, (r) => r > 0);

  // ---- Phoenix Recovery paths (25): sequential tiers along one path.
  const phoenix: PhoenixPath[] = [];
  const starts: { armed_on: string; recovered_on: string | null }[] = [];
  let open: { armed_on: string; recovered_on: string | null } | null = null;
  for (const d of days) {
    if (d.index === null) break;
    const r = d.index - 1;
    if (r <= PHOENIX_PATH_AT_OR_BELOW && (!open || open.recovered_on)) {
      open = { armed_on: d.date, recovered_on: null };
      starts.push(open);
    } else if (open && !open.recovered_on && r >= 0) {
      open.recovered_on = d.date;
    }
  }
  starts.forEach((s, i) => {
    const recovered = s.recovered_on;
    if (!recovered) return;
    // The path ends the day before the next fall to -15% begins.
    const pathEnd = starts[i + 1] ? addDays(starts[i + 1].armed_on, -1) : last;
    const tiers = [recovered];
    // Silver: 30 consecutive calendar days at or above 0% after the recovery.
    let run = 0;
    for (const d of days) {
      if (d.date < recovered || d.date > pathEnd) continue;
      run = d.index !== null && d.index - 1 >= 0 ? run + 1 : 0;
      if (run >= PHOENIX_STABLE_DAYS) {
        tiers.push(d.date);
        break;
      }
    }
    // Gold / Platinum: full positive quarters that start after the recovery.
    if (tiers.length === 2) {
      let q = quarterOf(addDays(recovered, 1));
      if (monthStart(quarterMonths(q)[0]) <= recovered) q = nextQuarter(q);
      let prevPositive = false;
      for (; positiveQuarter.has(q) && positiveQuarter.get(q)!.end <= pathEnd; q = nextQuarter(q)) {
        const pq = positiveQuarter.get(q)!;
        if (pq.positive && pq.end >= tiers[1]) {
          if (tiers.length === 2) tiers.push(pq.end);
          else if (tiers.length === 3 && prevPositive) {
            tiers.push(pq.end);
            break;
          }
        }
        prevPositive = pq.positive && pq.end >= tiers[1];
      }
    }
    // Sovereign: a full later calendar year beating the S&P 500 with less downside.
    if (tiers.length === 4) {
      const y = years.find((x) => x.start > recovered && x.end <= pathEnd && x.end >= tiers[3] && x.protected_win);
      if (y) tiers.push(y.end);
    }
    phoenix.push({ armed_on: s.armed_on, recovered_on: recovered, tiers });
  });

  return { records, quarters, years, phoenix };
};

export type RiskEvaluation = ReturnType<typeof evaluateRisk>;
