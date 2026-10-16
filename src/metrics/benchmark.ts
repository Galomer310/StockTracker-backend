/* ===========================================================================
   Performance vs benchmark.
   ---------------------------------------------------------------------------
   Every comparison uses exactly the same start and end dates for the
   portfolio and the benchmark; compareToBenchmark() refuses series that do
   not. The days in between may differ - Tel Aviv trades Sunday to Thursday,
   New York Monday to Friday - so only the two ends are checked.

   This file compares two series it is given. Making them comparable on
   dividends, currency and corporate actions happens before they get here,
   and those rules are not yet decided.
   =========================================================================== */

import { DatedValue, MetricDefinition } from "./types";

export const BENCHMARK_COMPARISON: MetricDefinition = {
  id: "performance_vs_benchmark",
  version: "benchmark_model_v1",
  sources: ["internal_portfolio_db", "market_data_api", "game_engine"],
  explanation: null,
};

// Rebases a series so it starts at 100, for charting several together.
export const normalizeTo100 = (series: DatedValue[]): DatedValue[] => {
  if (series.length === 0) return [];
  const first = series[0].value;
  if (!(first > 0)) throw new RangeError(`A series must start above zero to rebase; got ${first}`);
  return series.map(({ date, value }) => ({ date, value: (value / first) * 100 }));
};

export const periodReturn = (series: DatedValue[]): number | null =>
  series.length < 2 ? null : series[series.length - 1].value / series[0].value - 1;

export const excessReturn = (portfolio: number, benchmark: number): number => portfolio - benchmark;

export interface BenchmarkComparison {
  start: string;
  end: string;
  portfolio_return: number;
  benchmark_return: number;
  excess_return: number;
}

// `portfolio` should be the flow-free performance index from returns.ts, so
// game capital never counts as outperformance.
export const compareToBenchmark = (portfolio: DatedValue[], benchmark: DatedValue[]): BenchmarkComparison => {
  if (portfolio.length < 2 || benchmark.length < 2) {
    throw new RangeError("Both series need at least a start and an end point");
  }
  const start = portfolio[0].date;
  const end = portfolio[portfolio.length - 1].date;
  if (benchmark[0].date !== start || benchmark[benchmark.length - 1].date !== end) {
    throw new RangeError(
      `Benchmark must cover exactly ${start} to ${end}; got ${benchmark[0].date} to ${benchmark[benchmark.length - 1].date}`
    );
  }
  const p = periodReturn(portfolio)!;
  const b = periodReturn(benchmark)!;
  return { start, end, portfolio_return: p, benchmark_return: b, excess_return: excessReturn(p, b) };
};
