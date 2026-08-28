# Investments — Product Spec & Gap Analysis

Captured 2026-08-28. Parked for future work; not being implemented yet.
Current priority is responsive/mobile adaptation of the shipped product.

---

# PART 1 — THE SPEC (as provided)

> **NOTE: This spec is truncated.** It cuts off mid-word at "Subscribe" in
> Module 2's permission logic. The subscriber half of that rule, and any
> Module 3 onward, have not been received.

A premium social-investing web platform where users create virtual model
portfolios, build a player reputation, gain followers and paid subscribers,
participate in competitions, earn achievements, and share portfolio activity.

The product should feel like a combination of a premium financial terminal, a
social creator platform, and a competitive game.

UI language: English.

## Design direction

- very premium
- dark luxury theme
- black / deep navy backgrounds
- restrained gold accents
- clean typography
- minimal visual noise
- rounded cards
- sophisticated financial dashboard aesthetic
- avoid a casino-like visual style
- data must remain the visual focus

Business rules below must not be altered without explicitly flagging the
proposed change.

## PRODUCT ARCHITECTURE

Two completely separate dashboard layers.

### Dashboard 1 — Player Card

Represents the PLAYER, not an individual portfolio.

Displays: Profile Picture, Name, Nickname, Player Level, Best Portfolio Gain,
Followers, Subscribers, Professional Medals, Game Achievements, Average Return
Across All Portfolios, Competition Participation, Game Progress, Player
Description, View Portfolios button.

Followers and Subscribers belong ONLY to the Player. They must never be
displayed as portfolio-level metrics.

Only a subscribed user can access the player's full portfolio dashboard
through View Portfolios.

### Dashboard 2 — Player Portfolios

Top: horizontally scrollable Portfolio Carousel.

Each portfolio card displays: Portfolio Name, All-Time Return, Risk Level,
Portfolio Age, Active/Closed/Archived status, Portfolio Category/Style, Last
Updated, small performance sparkline.

Do NOT display Followers or Subscribers on individual portfolio cards.

Clicking a portfolio updates all lower dashboard modules without navigating
away from the page.

## MODULE 1 — PORTFOLIO ALLOCATION

Show current model-portfolio composition as percentages.

Every portfolio begins with Starting Capital = $10,000 virtual capital.

A player may earn additional virtual investment capital through game
achievements, levels or competitions. **Game-earned capital must NEVER be
treated as investment performance.**

### Main Allocation Chart

Donut / pie chart displaying Top 5 largest holdings, Other, and Cash
Available. Must always total 100%.

Example: META 31%, NVDA 22%, AMZN 17%, SOFI 11%, PLTR 7%, Other 5%, Cash 7%.

There is NO concept of target weight. All displayed weights represent Current
Portfolio Exposure based on current market values.

### Calculation

Current Exposure = Current Position Market Value / Current Portfolio Market
Value. Cash is included in total portfolio value.

### Clicking a holding

Side panel, in exactly this order:

1. Portfolio Exposure
2. Added to Portfolio
3. AVG Buy Price
4. Price Now
5. Gain/Loss Since Inclusion
6. Sector

Gain/Loss displayed as a percentage, not a dollar profit. AVG Buy Price is the
weighted average purchase price across all purchases of the active position.

### Clicking the entire module

Larger Portfolio Allocation Dashboard displaying: Starting Capital, Capital
Gain/Loss as a percentage, Capital Earned / Capital Achievements Earned, full
current holdings, Portfolio Exposure %, Added date, AVG Buy Price, Current
Price, Gain/Loss %, Sector.

Do not show absolute portfolio investment profit in dollars.

Provides "View Portfolio History" — a dashboard showing exact historical
portfolio composition and full portfolio evolution over time.

## MODULE 2 — PORTFOLIO ACTIVITY

Compact module stays simple. Chronological, newest to oldest.

Each activity: Added, Increased, Reduced, Removed.

Expanded view provides TWO viewing modes.

### View A — Detailed Activity

Per action: Date, Exact Time, Ticker, Action, Previous Exposure, New Exposure,
Buy/Sell Price, Player Rationale.

When a player changes a portfolio, allow free-text explanation of why. The
original rationale is immutable after publication. Later additions create a
new dated follow-up rather than modifying the original.

Each portfolio action automatically creates a feed event / discussion thread.

### Permission logic

Non-subscriber: can only see THAT the player made a portfolio action. Must NOT
see ticker, action type, weights, price, or rationale.

*[SPEC TRUNCATED HERE — "Subscribe..." onward not received]*

---

# PART 2 — GAP ANALYSIS (as of 2026-08-28)

Assessed against: `schema.sql`, all 6 backend route files and controllers, 13
frontend pages, 11 components, design tokens, chart layer.

## Already built, and consistent with the spec

| Spec requirement | Status |
|---|---|
| Dark luxury / navy / gold / rounded / clean type | Done. `style.css`: `--bg-base: #080B11`, `--gold: #D6A344`, Inter, radius tokens, light variant |
| $10,000 starting capital | Done. `STARTING_CASH` in `config/portfolio.ts` |
| Allocation = positions + cash = 100%, current market values | Done. `StockDistributionPieChart`. Uses Top 6 + Other; spec wants Top 5 |
| No target weight concept | Already true |
| Rationale immutable after publication | Already enforced — no edit path, 60s removal window only |
| Each action creates a feed event | Already true. Feed *is* `trade_notes` |
| Weighted AVG buy price | Derivable — one `watchlist` row per purchase |
| Portfolio Age, Last Updated | Derivable from `created_at` / `trade_notes` |

## Absent entirely (zero code)

Grep returned no hits for: `follower`, `subscriber`, `achievement`, `medal`,
`competition`, `nickname`, `reputation`, `sparkline`, `archived`, `rationale`.

- **Player layer.** `users` is only id/email/password/display_name/created_at.
  No avatar, nickname, level, description, medals, achievements. Dashboard 1
  has no data behind it.
- **Social graph.** No followers, subscribers, subscriptions, or payments.
- **Portfolio metadata.** No risk level, category/style, status, sparkline.
- **Portfolio history.** No snapshots. Cannot be reconstructed — `stocks`
  keeps one row per symbol, overwritten, so historical prices are not retained.
- **Activity granularity.** Only buy/sell. Spec wants
  Added/Increased/Reduced/Removed plus Previous → New Exposure per action.
- **Follow-up notes.** No table for dated addenda.
- **Competitions and achievements.** Nothing.

## Three conflicts requiring a ruling

1. **Feed privacy is inverted.** `feedController.ts` states the current rule:
   the feed is a public square carrying action, ticker and note to everyone.
   The spec requires non-subscribers see only that an action occurred. This is
   a reversal, not an addition, and it removes the feed's discovery value.
   Decide: gate everything, or gate rationale/weights while leaving
   ticker+action public as the subscription hook?

2. **Game-earned capital vs. the return denominator.** `schema.sql`:
   `starting_balance` "never changes, so it is the honest denominator for
   return." The spec adds earned capital while demanding it never read as
   performance. Coexistence requires a new column separating contributed from
   starting capital, plus a decision on leaderboard fairness when players hold
   different deployable cash. **Highest-risk rule in the spec.**

3. **Paid subscribers means real payments.** Stripe, webhooks, entitlement
   checks on every gated route, plus tax, refunds, terms. Converts this into a
   commercial product with legal surface. Scope separately.

## Hard blocker

**Alpha Vantage's 25 requests/day cannot support this product.** Sparklines
per carousel card, historical composition, and a multi-user feed each multiply
quote lookups. The quota is exhausted by one user opening one dashboard. A
real market-data plan is prerequisite to everything else.

## Rough sizing

Dependency-ordered. ±50%; phases 9–10 are rule-design problems more than
coding problems.

| # | Phase | Size |
|---|---|---|
| 0 | Market data provider swap | 1–2d |
| 1 | Player identity (avatar, nickname, description, level scaffold) | 2–3d |
| 2 | Two-dashboard restructure + portfolio carousel | 2–3d |
| 3 | Portfolio metadata + sparklines | 3–4d |
| 4 | Allocation deep-dive (side panel, expanded dashboard) | 3–4d |
| 5 | Portfolio history + snapshots | 3–4d |
| 6 | Activity rework (4 action types, exposure deltas, follow-ups) | 4–5d |
| 7 | Followers | 1–2d |
| 8 | Subscriptions + payments + gating | 5–8d |
| 9 | Achievements, medals, earned capital | 5–7d |
| 10 | Competitions | 5–8d |

**Total ≈ 34–50 focused days.** Existing code covers roughly a quarter of the
spec's surface — but it is the foundational quarter, built on principles the
spec agrees with. Build outward, not rewrite.

## Recommended starting point

Phases 1–2. Self-contained, make the product look like the spec immediately,
and do not touch the trade path.

## Open questions

1. The rest of the spec, from "Subscribe" onward.
2. Rulings on the three conflicts, especially #2.
3. Market data decision for phase 0.
