/* ===========================================================================
   Metric engine - shared types.
   ---------------------------------------------------------------------------
   Every number the dashboards show is produced by a pure function in this
   folder and wrapped in a MetricResult, so that what was shown can always be
   traced back to the formula version and the data that produced it. When a
   formula changes it gets a new version string; results stored under the old
   one keep meaning what they meant.

   Weights and returns are fractions throughout (0.25 = 25%). Converting to a
   percentage is a display concern and happens in the UI, never here.
   =========================================================================== */

// The systems a metric can draw on, as the spec names them. A metric listing
// more than one combines systems, which the spec asks to be identifiable.
export type DataSource =
  | "internal_portfolio_db"
  | "market_data_api"
  | "fundamentals_api"
  | "game_engine"
  | "community_system";

export interface MetricExplanation {
  what_this_shows: string;
  how_it_is_measured: string;
  how_to_read_it: string;
}

export interface MetricDefinition {
  id: string;
  /** Formula version, e.g. "risk_model_v1". Bump it whenever the formula changes. */
  version: string;
  sources: readonly DataSource[];
  /** Written in the metric explanations phase; null until then. */
  explanation: MetricExplanation | null;
}

export interface MetricResult<T = number> {
  metric_id: string;
  metric_version: string;
  /** null when the inputs are insufficient to calculate it. */
  raw_value: T | null;
  normalized_score: number | null;
  classification: string | null;
  /** ISO timestamp. */
  calculated_at: string;
  data_sources: DataSource[];
  explanation: MetricExplanation | null;
}

// A value on a date, the shape of every series in the engine. Dates are ISO
// calendar dates ("2026-08-26") or full timestamps, ordered oldest first.
export interface DatedValue {
  date: string;
  value: number;
}

// The time of calculation is passed in rather than read from the clock, so
// the same inputs always produce the same result - including in tests.
export const toResult = <T>(
  def: MetricDefinition,
  raw: T | null,
  opts: { calculatedAt: Date; normalized?: number | null; classification?: string | null }
): MetricResult<T> => ({
  metric_id: def.id,
  metric_version: def.version,
  raw_value: raw,
  normalized_score: opts.normalized ?? null,
  classification: opts.classification ?? null,
  calculated_at: opts.calculatedAt.toISOString(),
  data_sources: [...def.sources],
  explanation: def.explanation,
});
