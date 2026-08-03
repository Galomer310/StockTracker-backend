/* ===========================================================================
   US market open/closed, derived from the clock.
   ---------------------------------------------------------------------------
   Alpha Vantage does expose MARKET_STATUS, but the client polls this every 60
   seconds and the free budget is 25 requests A DAY - polling it would burn the
   entire allowance in under half an hour, leaving nothing for actual prices.
   The banner it drives is cosmetic, so it is computed locally for free.

   Known limitation: this does not know about market holidays, so on Christmas
   it will report "open" during what would be regular hours. Regular weekday
   and weekend behaviour is correct. If holiday accuracy matters later, either
   spend one cached MARKET_STATUS call per day or add a holiday table.
   =========================================================================== */

const OPEN_MINUTES = 9 * 60 + 30;  // 09:30 ET
const CLOSE_MINUTES = 16 * 60;     // 16:00 ET

export interface MarketStatus {
  status: "open" | "closed";
  is_open: boolean;
  region: string;
  local_open: string;
  local_close: string;
  local_time: string;
  reason: string;
  source: "clock";
}

// Read the current wall-clock time in New York, regardless of server timezone.
const nowInNewYork = () => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  // "24" is possible for midnight in some ICU versions; normalise it to 0.
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));

  return { weekday, hour, minute, minutes: hour * 60 + minute };
};

export const getMarketStatus = (): MarketStatus => {
  const { weekday, hour, minute, minutes } = nowInNewYork();
  const isWeekend = weekday === "Sat" || weekday === "Sun";
  const withinHours = minutes >= OPEN_MINUTES && minutes < CLOSE_MINUTES;
  const isOpen = !isWeekend && withinHours;

  let reason: string;
  if (isOpen) reason = "Regular trading hours";
  else if (isWeekend) reason = "Weekend";
  else if (minutes < OPEN_MINUTES) reason = "Before the opening bell";
  else reason = "After the closing bell";

  return {
    status: isOpen ? "open" : "closed",
    is_open: isOpen,
    region: "United States",
    local_open: "09:30",
    local_close: "16:00",
    local_time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    reason,
    source: "clock",
  };
};
