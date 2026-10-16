/* ===========================================================================
   Calendar dates in the platform's time zone.
   ---------------------------------------------------------------------------
   A moment in time falls on different calendar days in different places:
   21:30 UTC on 30 September is already 1 October in Israel. Month-based
   figures must therefore date every value in one agreed time zone before
   comparing dates, and that zone is MONTH_TIME_ZONE.

   These are the only functions in the engine that read a time zone; the
   rest work on the "YYYY-MM-DD" strings they produce.
   =========================================================================== */

import { MONTH_TIME_ZONE } from "./config";

// en-CA formats as YYYY-MM-DD, which sorts and compares correctly as text.
const formatters = new Map<string, Intl.DateTimeFormat>();
const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    formatters.set(timeZone, f);
  }
  return f;
};

// The calendar date of a moment in the given zone, as "2026-10-01".
export const localDate = (at: Date, timeZone = MONTH_TIME_ZONE): string => {
  if (Number.isNaN(at.getTime())) throw new RangeError("Invalid date");
  return formatterFor(timeZone).format(at);
};

// The calendar month of a moment in the given zone, as "2026-10".
export const localMonth = (at: Date, timeZone = MONTH_TIME_ZONE): string => localDate(at, timeZone).slice(0, 7);
