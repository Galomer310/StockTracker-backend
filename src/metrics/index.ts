/* ===========================================================================
   Metric engine.
   ---------------------------------------------------------------------------
   Pure calculation functions for the metrics the product spec fully defines
   (docs/PRODUCT-SPEC-AND-GAP.md). No database, network, or clock access: the
   callers load data and decide when "now" is, and every function here can be
   tested with plain numbers.

   Formulas the spec leaves undefined are deliberately absent, or stop at the
   point where the definition runs out - see the header of each file.
   =========================================================================== */

export * from "./types";
export * from "./config";
export * from "./calendar";
export * from "./returns";
export * from "./volatility";
export * from "./drawdown";
export * from "./portfolio";
export * from "./concentration";
export * from "./risk";
export * from "./turnover";
export * from "./exposure";
export * from "./benchmark";
export * from "./player";
