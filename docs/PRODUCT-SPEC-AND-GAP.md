# Investments — Product Spec & Gap Analysis

Spec first captured 2026-08-28 (truncated). Full spec received 2026-10-14 and
recorded below in place of the truncated copy. Gap analysis revised the same
day against the code on `main` plus the trade-integrity branches
(`api-sell-at-market-price`, `ui-sell-at-market-price`).

A separate, more detailed Player Card spec (Hebrew) was received 2026-10-16.
It is recorded verbatim in Part 3, summarised in English with its own gap
analysis in Part 4, and the Part 2 items it answers are marked there.

Parked for future work; not being implemented yet. Parts 2 and 4 list the
rulings and the market-data decision needed before most of it can start.

---

# PART 1 — THE SPEC (as provided)

> **Transcription note.** The spec arrived as pasted text in which the `+`
> signs of two weighted formulas (Risk Score, Concentration Score) had been
> turned into list bullets. They are restored as `+` below; the weights and
> terms are unchanged. Everything else is as received, with markdown
> formatting only.

You are helping build a premium social-investing web platform where users
create virtual model portfolios, build a player reputation, gain followers and
paid subscribers, participate in competitions, earn achievements, and share
portfolio activity.

The product should feel like a combination of a premium financial terminal, a
social creator platform, and a competitive game.

The UI language must be English.

The design direction is:

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

Do not alter the business rules below without explicitly flagging the proposed
change.

## PRODUCT ARCHITECTURE

There are two completely separate dashboard layers.

### Dashboard 1 — Player Card

This dashboard represents the PLAYER, not an individual portfolio.

Display:

- Profile Picture
- Name
- Nickname
- Player Level
- Best Portfolio Gain
- Followers
- Subscribers
- Professional Medals
- Game Achievements
- Average Return Across All Portfolios
- Competition Participation
- Game Progress
- Player Description
- View Portfolios button

Followers and Subscribers belong ONLY to the Player.

They must never be displayed as portfolio-level metrics.

Only a subscribed user can access the player's full portfolio dashboard through
View Portfolios.

### Dashboard 2 — Player Portfolios

At the top, create a horizontally scrollable Portfolio Carousel.

Each portfolio card should display:

- Portfolio Name
- All-Time Return
- Risk Level
- Portfolio Age
- Active / Closed / Archived status
- Portfolio Category / Style
- Last Updated
- Small performance sparkline

Do NOT display Followers or Subscribers on individual portfolio cards.

Clicking a portfolio must update all lower dashboard modules without
navigating away from the page.

## MODULE 1 — PORTFOLIO ALLOCATION

Purpose: Show the current model-portfolio composition as percentages.

Every portfolio begins with: Starting Capital = $10,000 virtual capital.

A player may earn additional virtual investment capital through game
achievements, levels or competitions.

Game-earned capital must NEVER be treated as investment performance.

### Main Allocation Chart

Use a donut / pie chart.

Display:

- Top 5 largest holdings
- Other
- Cash Available

The chart must always total 100%.

Example:

```
META 31%
NVDA 22%
AMZN 17%
SOFI 11%
PLTR 7%
Other 5%
Cash 7%
```

There is NO concept of Target Weight.

All displayed weights represent Current Portfolio Exposure based on current
market values.

### Calculation

```
Current Exposure = Current Position Market Value / Current Portfolio Market Value
```

Cash is included in total portfolio value.

### Clicking a holding

Open a side panel displaying, in exactly this order:

1. Portfolio Exposure
2. Added to Portfolio
3. AVG Buy Price
4. Price Now
5. Gain/Loss Since Inclusion
6. Sector

Gain/Loss must be displayed as a percentage, not a dollar profit.

AVG Buy Price must be the weighted average purchase price across all purchases
of the active position.

### Clicking the entire Portfolio Allocation module

Open a larger Portfolio Allocation Dashboard.

Display:

- Starting Capital
- Capital Gain / Loss as a percentage
- Capital Earn / Capital Achievements Earned
- Full current holdings
- Portfolio Exposure %
- Added Date
- AVG Buy Price
- Current Price
- Gain/Loss %
- Sector

Do not show absolute portfolio investment profit in dollars.

From this dashboard provide: View Portfolio History

This opens another dashboard showing the exact historical portfolio
composition and full portfolio evolution over time.

## MODULE 2 — PORTFOLIO ACTIVITY

The compact Portfolio Activity module remains simple.

Display chronological activity from newest to oldest.

Each activity can be:

- Added
- Increased
- Reduced
- Removed

When expanded, provide TWO viewing modes.

### View A — Detailed Activity

For each action display:

- Date
- Exact Time
- Ticker
- Action
- Previous Exposure
- New Exposure
- Buy / Sell Price
- Player Rationale

When a player changes a portfolio, allow the player to enter a free-text
explanation of why the action was made.

The original rationale must be immutable after publication.

If the player wants to add further information later, create a new dated
follow-up rather than modifying the original explanation.

Each portfolio action should automatically create a feed event / discussion
thread.

#### Permission logic

Non-subscriber: Can only see that the player made a portfolio action.

They must NOT see:

- ticker
- action type
- weights
- price
- rationale

Subscriber: Can see the complete action details.

### View B — Portfolio Composition Table

Create a matrix.

Y-axis: Stocks / tickers.

X-axis: Every portfolio-change event.

The NEWEST event must be on the LEFT.

Older events continue toward the RIGHT.

Each cell contains ONLY the holding percentage at that moment.

If two changes occurred on the same calendar day, display them as two
different columns using time.

Example:

```
26 Aug 18:30
26 Aug 09:15
21 Aug
12 Aug
```

The table must support:

- long horizontal scrolling
- many stocks
- many historical portfolio events
- sticky ticker column where useful
- separate events on the same day

## MODULE 3 — INVESTMENT PROFILE

Display only these five dimensions:

1. Risk
2. Portfolio Volatility
3. Diversification
4. Investment Horizon
5. Portfolio Turnover

Each should be displayed using an elegant horizontal meter plus a numerical or
categorical result.

Every metric must have an info icon and an expandable explanation.

### RISK SCORE

Risk Score range: 0–100

Classification:

```
0–20   = Very Low
21–40  = Low
41–60  = Medium
61–80  = High
81–100 = Very High
```

Formula:

```
Risk Score =
    30% Volatility Score
  + 25% Max Drawdown Score
  + 20% Concentration Score
  + 15% Liquidity Risk Score
  + 10% Turnover Risk Score
```

All sub-metrics must first be normalized to a 0–100 scale.

### PORTFOLIO VOLATILITY

Calculate daily portfolio returns.

```
Daily Return = NAV(today) / NAV(previous trading day) - 1
```

Volatility must include BOTH positive and negative daily moves.

Use: Rolling 90 trading days.

Calculate daily standard deviation and optionally annualize:

```
Annualized Volatility = Daily Standard Deviation × sqrt(252)
```

Also store:

- Average Positive Day
- Average Negative Day
- Maximum Daily Gain
- Maximum Daily Loss

Do not treat game-earned capital as a daily return.

### MAX DRAWDOWN

Max Drawdown is NOT the worst daily return.

It represents the largest decline from a portfolio peak to a subsequent
trough.

For each date:

```
Drawdown = (Current NAV - Previous Peak NAV) / Previous Peak NAV
```

Max Drawdown = largest negative drawdown in the selected history.

### CONCENTRATION SCORE

Concentration must measure both stock-level and sector-level concentration.

Formula:

```
Concentration Score =
    40% Effective Holdings Risk
  + 25% Largest Position Risk
  + 15% Top 3 Holdings Risk
  + 20% Sector Concentration Risk
```

#### Effective Holdings

```
Effective Holdings = 1 / Σ(weight²)
```

Use invested holdings for this calculation rather than counting cash as a
company.

#### Largest Position

Measure the exposure to the single largest holding.

#### Top 3

Measure combined exposure to the three largest holdings.

#### Sector Concentration

Measure concentration across sectors using both:

- Largest Sector Exposure
- Sector HHI

```
Sector HHI = Σ(sector weight²)
```

A portfolio containing 20 stocks primarily in the same sector must still be
considered concentrated.

#### ETFs

Do not treat a broad-market ETF as equivalent to one concentrated stock.

MVP classification:

```
Broad Market ETF                                  → Low concentration
Sector ETF                                        → Medium
Thematic ETF                                      → Medium / High
Single-stock or highly concentrated leveraged ETF → High / Very High
```

Design the data model so ETF look-through can be added later.

### DIVERSIFICATION

Do not build a competing independent methodology.

Use:

```
Diversification Score = 100 - Concentration Score
```

This guarantees that Concentration and Diversification remain logically
consistent.

### PORTFOLIO TURNOVER

Measure how much of the portfolio composition has been replaced.

For each portfolio-change event:

```
Turnover Event = 0.5 × Σ |Weight After - Weight Before|
```

Use Rolling 90-Day Turnover for the dashboard.

Turnover is:

- displayed independently in Investment Profile
- also used as 10% of Risk Score

### INVESTMENT HORIZON

Measure actual player behavior, not a self-declared investing style.

Use actual holding periods.

Prefer median or weighted-median holding days instead of a simple average to
reduce distortion from extreme positions.

Display categories such as:

- Very Short
- Short
- Medium
- Long
- Very Long

Store the underlying number of holding days.

## MODULE 4 — EXPOSURE & CHARACTERISTICS

Use horizontal percentage bars.

Display the percentage number directly next to every bar.

Current dimensions:

- Micro Cap Exposure
- Small Cap Exposure
- Low Volume Exposure
- Tech Exposure
- Momentum Exposure
- Dividend Exposure
- Profitability Exposure

### MICRO CAP EXPOSURE

Definition: Market Cap < $100M

Micro Cap Exposure = sum of current portfolio weights belonging to companies
below $100M market cap.

Micro Cap and Small Cap must NOT overlap.

### SMALL CAP EXPOSURE

Definition: Market Cap from $100M up to $1B.

Small Cap Exposure = sum of portfolio weights in companies with:

```
$100M ≤ Market Cap < $1B
```

Micro Cap is excluded.

### LOW VOLUME EXPOSURE

Use dollar liquidity rather than share volume.

```
Average Daily Dollar Volume = 20-Day Average Price × 20-Day Average Share Volume
```

Low Volume Exposure: sum of portfolio weights classified as low liquidity.

Build the liquidity threshold as a configurable system parameter because the
exact MVP threshold may be adjusted later.

Suggested initial value: Average Daily Dollar Volume < $5M.

### TECH EXPOSURE

Do not rely only on official GICS Information Technology sector.

Companies such as large internet platforms may be technology-oriented while
belonging to another official sector.

Create a deterministic internal Tech Classification Mapping based on industry
/ business classification.

Possible Tech-oriented categories include:

- Software
- Semiconductors
- AI
- Cloud
- Cybersecurity
- Internet Platforms
- Digital Advertising Technology
- Fintech
- E-commerce Technology

Every security receives: Tech Oriented = TRUE / FALSE

Tech Exposure: sum of current portfolio weights where Tech Oriented = TRUE.

Do NOT let generative AI dynamically decide this classification at runtime.

Use a controlled mapping table.

### MOMENTUM EXPOSURE

Momentum belongs under Exposure & Characteristics, so it should NOT duplicate
historical Performance Insights.

It should represent: What percentage of the current portfolio is invested in
stocks currently showing positive price momentum?

Suggested Positive Momentum definition:

- Current Price > 50-Day Moving Average
- Current Price > 200-Day Moving Average
- 50-Day Moving Average > 200-Day Moving Average

A security satisfying the platform's positive-momentum rule is flagged:
Positive Momentum = TRUE.

Momentum Exposure: sum of current portfolio weights of Positive Momentum
securities.

Display: Momentum Exposure — XX%

## MODULE 5 — PERFORMANCE INSIGHTS

Keep this module relatively simple and modular so metrics can be modified
later.

Include:

- Total Return
- Average Monthly Return
- Best Month
- Worst Month
- Max Drawdown
- Maximum Daily Gain
- Maximum Daily Loss
- Positive Months
- Portfolio Age
- Performance vs Benchmark

### Maximum Daily Loss

Minimum daily portfolio return. Also display the date.

### Maximum Daily Gain

Maximum daily portfolio return. Also display the date.

### PERFORMANCE VS BENCHMARK

Always compare against:

- S&P 500
- NASDAQ-100

If the portfolio contains securities traded on the Tel Aviv Stock Exchange,
also add:

- TA-35
- TA-125

All portfolio and benchmark results must use exactly the same start and end
dates.

For example: If portfolio inception is 15 Aug 2026, every benchmark comparison
must also begin on 15 Aug 2026.

Calculate:

```
Excess Return = Portfolio Return - Benchmark Return
```

For charts normalize every series to: 100 at the beginning of the comparison
period.

Ensure that portfolio and benchmark methodology is consistent regarding:

- dividends / total return
- currency
- corporate actions

The portfolio base currency is USD, so Israeli benchmarks require a clearly
defined FX methodology.

## USER EDUCATION / METRIC EXPLANATIONS

Every metric that can open an expanded window must contain educational
explanation.

Use three levels:

### What this shows

Explain the metric in simple language.

### How it is measured

Explain the logic without overwhelming the user with mathematics.

### How to read it

Explain what low / medium / high or the percentage means.

In the compact dashboard use: ⓘ tooltip

In the expanded dashboard use: About this metric

This is mandatory for new-user usability.

## DATA SOURCES

Design the application so every displayed metric knows its source.

### Internal Portfolio Database

Contains:

- portfolio holdings
- cash
- action history
- buy / sell history
- portfolio composition snapshots
- NAV history
- position lots
- dates and timestamps

### Market Data API

Contains:

- current price
- historical price
- volume
- historical volume
- moving averages
- corporate actions where supported

### Fundamentals / Security Master API

Contains:

- market cap
- sector
- industry
- country
- dividend information
- profitability data
- security classification

### Internal Game Engine

Contains:

- $10,000 starting capital
- earned virtual capital
- achievements
- player level
- competitions
- game rewards

### Community / Subscription System

Contains:

- Followers
- Subscribers
- feed events
- comments
- discussion threads
- access permissions

Clearly identify any component that combines MULTIPLE APIs / systems.

## IMPORTANT FINANCIAL LOGIC

Game-earned virtual capital must be treated as an external portfolio cash
flow.

It must NEVER increase investment return.

Example:

- Starting Capital = $10,000
- Portfolio earns +10% through investments.
- Portfolio then receives a $1,000 game achievement reward.
- Investment Return must remain: +10%, not +20%.

Maintain a capital ledger distinguishing:

- Starting Capital
- Investment Performance
- Game Capital Earned

## DEVELOPMENT REQUIREMENTS

Build the application in modular components.

Separate:

- UI components
- metric calculation engine
- portfolio calculation engine
- permissions
- external API adapters
- internal data models

Do not hardcode financial calculations inside visual components.

Create reusable pure calculation functions for all metrics.

Every metric should include:

- metric ID
- metric version
- raw value
- normalized score where relevant
- display classification
- calculation date
- required data sources
- explanation text

Version formulas, for example:

- risk_model_v1
- concentration_model_v1
- momentum_model_v1

Historical calculated results must remain traceable if formulas change in the
future.

## EXPECTED OUTPUT FROM YOU

Before coding, provide:

1. Component architecture.
2. Data model / TypeScript interfaces.
3. API dependency map.
4. Metric-calculation functions.
5. Permission model.
6. Interaction map.
7. Edge cases.
8. Mock dataset.
9. Then implement the UI.
10. Add unit tests for every financial formula.

Do not invent missing financial rules.

If a threshold or definition is marked configurable, expose it as a
configuration constant rather than embedding it throughout the application.

Preserve all business logic above exactly unless explicitly instructed
otherwise.

---

# PART 2 — GAP ANALYSIS (revised 2026-10-14)

Assessed against: `schema.sql`, the backend route files and controllers, the
frontend pages and components, design tokens, chart layer.

## Already built, and consistent with the spec

| Spec requirement | Status |
|---|---|
| Dark luxury / navy / gold / rounded / clean type | Done. `style.css`: `--bg-base: #080B11`, `--gold: #D6A344`, Inter, radius tokens, light variant |
| $10,000 starting capital | Done. `STARTING_CASH` in `config/portfolio.ts` |
| Allocation = positions + cash = 100%, current market values | Done. `StockDistributionPieChart`. Uses Top 6 + Other; spec wants Top 5 |
| No target weight concept | Already true |
| Rationale immutable after publication | Enforced — no edit path. But see the 60-second undo under "Clashes" |
| Each action creates a feed event | Already true. Feed *is* `trade_notes` |
| Weighted AVG buy price | Derivable — one `watchlist` row per purchase (lots) |
| Portfolio Age, Last Updated | Derivable from `created_at` / `trade_notes` |
| Trades execute at a real quoted price | Done on the trade-integrity branches: buys and sells use the server quote; manual entry is refused |
| A single gate for portfolio visibility | `canViewPortfolio` in `leaderboardController.ts` exists, but always returns true |

## Absent entirely (zero code)

- **Player layer.** `users` is only id/email/password/display_name/created_at.
  No avatar, nickname, level, description, medals, achievements.
- **Social graph.** No followers, subscribers, subscriptions, or payments.
- **Portfolio metadata.** No risk level, category/style, status, sparkline.
- **History.** No composition snapshots and no daily NAV history. `stocks`
  keeps one row per symbol, overwritten, so neither can be reconstructed
  after the fact. Volatility, drawdown, monthly returns, benchmarks,
  sparklines, View B and View Portfolio History all depend on this.
- **Capital ledger.** No record of starting capital vs. earned capital vs.
  performance.
- **Activity granularity.** Only buy/sell. Spec wants
  Added/Increased/Reduced/Removed plus Previous → New Exposure per action.
- **Follow-up notes.** No table for dated addenda.
- **Metric engine.** No metric IDs, versions, stored results, or explanation
  text. No test framework in either repository.
- **Security master.** No market cap, sector, country, ETF classification,
  tech mapping, or momentum data.
- **Scheduled jobs.** Nothing runs on a timer; a daily NAV snapshot needs one.
- **Competitions and achievements.** Nothing.

## Conflicts — where they stand

1. **Feed privacy — the spec rules: gate everything.** Non-subscribers see
   only that an action occurred; subscribers see everything. The current feed
   is a public square carrying action, ticker and note to everyone
   (`feedController.ts`). This must be reversed unless a change to the rule is
   explicitly flagged and agreed.
2. **Game-earned capital — the spec rules: external cash flow.** Earned
   capital never counts as return, and a capital ledger separates it. The
   current formula, `(equity − starting_balance) / starting_balance` in
   `portfolioController.ts`, would report the spec's own example as +20%
   instead of +10%. A cash-flow-adjusted return needs portfolio value at the
   moment of each inflow, so it depends on NAV history. Still undecided:
   leaderboard or competition fairness when players hold different deployable
   capital.
3. **Paid subscriptions — partly answered by the Player Card spec (Part 4).**
   $3/month, granting access to the creator's portfolios and holdings;
   following is free and grants none of it. Still undefined: who receives the
   money, billing, refunds. The Player Card spec also adds paid portfolio
   tiers and paid-entry competitions with prize pools — see the legal note in
   Part 4. Stripe, webhooks and entitlement checks on every gated route remain
   a separately scoped commercial and legal piece.

## Rules the spec leaves undefined

The spec forbids inventing financial rules, so each of these needs a ruling
before the dependent metric can be built.

1. **Normalization to 0–100.** Required for every sub-score, defined for none:
   - Risk Score inputs: Volatility, Max Drawdown, Liquidity Risk, Turnover
     Risk. (Concentration is itself a 0–100 composite.)
   - Concentration inputs: Effective Holdings Risk, Largest Position Risk,
     Top 3 Holdings Risk, Sector Concentration Risk — and how Largest Sector
     Exposure and Sector HHI combine into the last one.
   - ETF classes map to labels (Low … Very High), not numbers.
   - Liquidity Risk Score has no definition at all; Low Volume Exposure is the
     natural input but the spec does not say so.

   Until these exist, Risk, Concentration and Diversification cannot be
   computed. **This is the largest gap.**
2. **Dividend Exposure and Profitability Exposure** are listed in Module 4 but
   never defined.
3. **Investment Horizon.** Day thresholds for Very Short … Very Long; median
   or weighted median, and weighted by what; whether open positions count,
   and if so to which date.
4. **Turnover and cash.** Whether cash is one of the weights. It changes the
   result: from 50% AAPL / 50% cash, buying 25% MSFT is 25% turnover with
   cash counted and ≈33% without. Also whether the 90-day figure is a sum of
   events.
5. **Short histories and windows.** What to show for portfolios under 90
   trading days and securities under 200 days (momentum); the window for
   "selected history" in Max Drawdown, and which window feeds the Risk Score;
   whether volatility is annualized ("optionally").
6. **Monthly statistics.** Arithmetic or compounded average monthly return;
   treatment of the partial first and current month.
7. **Benchmark methodology.**
   - Virtual portfolios receive no dividends today. Either dividends are
     credited to virtual cash (needs dividend data), or benchmarks use price
     return. The spec requires consistency but does not choose.
   - TASE securities trade in ILS, quoted in agorot. The spec defines FX only
     for benchmarks, not for buying, valuing or selling those securities.
   - "Contains TASE securities" — currently, or at any point in the
     comparison period.
8. **Player and game.** Level, Game Progress, medals vs. achievements,
   competitions, reward amounts, and which portfolio earned capital lands in.
   "Best Portfolio Gain" and "Average Return Across All Portfolios": whether
   closed or archived portfolios count, and how portfolios of very different
   ages are weighted. *Partly answered in Part 4:* both averages and the best
   portfolio use active portfolios only, equally weighted, with no
   adjustment for age; medals and achievements are two separate banks. XP,
   levels, titles and both banks' contents are explicitly deferred.
9. **Portfolio status and labels.** What Active / Closed / Archived each
   allow; whether Risk Level on the card is the Risk Score classification;
   whether Category / Style is player-chosen or derived.
10. **Permissions.** View Portfolios is subscriber-only, yet Module 2 defines
    what non-subscribers see — where do they see it (the feed)? Who sees
    follow-up notes? *Answered in Part 4:* following grants no access to
    holdings or subscriber content.

## Clashes with the current code

- **Leaderboard.** Not mentioned in the main spec. *Answered in Part 4:* it
  stays — the Player Card spec names it as how users discover players to
  follow.
- **60-second undo.** Deleting a buy inside the window removes its journal
  entry and feed post. Defensible as "the trade never happened", but it does
  remove a published rationale. Needs a ruling against the immutability rule.
- **Sector source.** `watchlist.industry` is supplied by the client in the buy
  request. The spec requires it from a security master.
- **Corporate actions.** No split handling: a 10-for-1 split would read as a
  90% loss. The spec requires consistency on corporate actions.
- **Allocation chart.** Top 6 + Other; spec says Top 5.
- **Action types.** buy/sell only; spec wants Added/Increased/Reduced/Removed,
  derivable from position state before and after each trade.

## Hard blocker: market data

Alpha Vantage at 25 requests/day could not support the truncated spec. The
full spec needs, for every held security and every trading day:

- daily close (NAV history, volatility, drawdown, monthly returns)
- 200 days of history (50/200-day moving averages)
- 20-day price and volume (dollar liquidity)

plus a security master (market cap, sector, industry, country, dividends,
profitability, ETF classification), index levels for S&P 500, NASDAQ-100,
TA-35 and TA-125 — ideally total-return series — USD/ILS rates, and split and
dividend events.

The provider chosen in phase 0 must cover TASE listings and fundamentals, not
only US prices. The tech mapping and ETF classification are internal,
controlled tables either way.

**Status 2026-10-20:** replaced with Massive (formerly Polygon.io) on its free
Basic plan; see Decided. That removes the 25-a-day ceiling (now 5 a minute, no
daily cap, two years of daily history) but not the blocker: still no TASE, no
fundamentals, no intraday, and prices are end of day.

## Rough sizing

Dependency-ordered. ±50%. Phases 0–10 carried over from 2026-08-28; 11–16
added for the full spec. Phases 9–10 and the rulings above are rule-design
problems more than coding problems.

| # | Phase | Size |
|---|---|---|
| 0 | Market data + security master provider swap | 2–4d |
| 1 | Player identity (avatar, nickname, description, level scaffold) | 2–3d |
| 2 | Two-dashboard restructure + portfolio carousel | 2–3d |
| 3 | Portfolio metadata + sparklines | 3–4d |
| 4 | Allocation deep-dive (side panel, expanded dashboard) | 3–4d |
| 5 | Composition snapshots, daily NAV job, capital ledger, flow-adjusted return | 5–7d |
| 6 | Activity rework (4 action types, exposure deltas, follow-ups, View B matrix) | 5–7d |
| 7 | Followers | 1–2d |
| 8 | Subscriptions + payments + gating (incl. feed reversal) | 5–8d |
| 9 | Achievements, medals, earned capital | 5–7d |
| 10 | Competitions | 5–8d |
| 11 | Metric engine: pure functions, versioned results, unit tests | 4–6d |
| 12 | Module 3 Investment Profile (needs normalization rulings) | 3–5d |
| 13 | Module 4 Exposures (needs security master, tech + ETF tables) | 4–6d |
| 14 | Module 5 Performance Insights + benchmarks (needs index + FX data) | 4–6d |
| 15 | Metric explanations (three levels, tooltip + About this metric) | 2–3d |
| 16 | Corporate actions (splits, dividends if credited) | 2–4d |

**Total ≈ 55–87 focused days.** Existing code covers well under a quarter of
the full spec's surface, but it remains the foundational part — trades,
cash, journal, feed, valuation — built on principles the spec agrees with.
Build outward, not rewrite.

## Recommended starting point

1. Answer the open rulings, normalization first; choose the market-data
   provider.
2. Meanwhile, phase 11 with the formulas that are already fully defined —
   effective holdings, top-N exposure, sector HHI, drawdown, daily
   volatility, per-event turnover, cap buckets, momentum flags,
   flow-adjusted return — as pure, versioned, unit-tested functions on mock
   data. Needs neither a provider nor a ruling.
3. Phases 1–2 remain self-contained and make the product look like the spec
   without touching the trade path.

## Open questions

1. The rulings listed under "Rules the spec leaves undefined".
2. Payments scope (conflict 3), and leaderboard fairness under earned
   capital (conflict 2).
3. The 60-second undo (see "Clashes").
4. Market data and security master provider for phase 0.
5. The Player Card questions in Part 4. The UI language and the reference
   image were settled 2026-10-16; see "Decided" there.

---

# PART 3 — PLAYER CARD SPEC (as provided, Hebrew)

> **Transcription note.** Received 2026-10-16 as pasted text, in Hebrew. It is
> reproduced verbatim except that every heading is one level lower (`#`
> became `##`, and so on), so its sections nest under this part instead of
> colliding with the document's own. The reference image it calls the
> mandatory basis for the design was received later the same day; it is not
> stored in this repository (see "Decided" in Part 4).

<div dir="rtl">

## PLAYER CARD – COMPLETE DESIGN & FUNCTIONAL SPECIFICATION

### 1. מטרת המשימה

בנה כרטיס שחקן (Player Card) עבור פלטפורמת השקעות חברתית המשלבת ניהול תיקי השקעות וירטואליים, תחרויות, הישגים מקצועיים, קהילה ומנגנון התקדמות במשחק (Gamification).

כרטיס השחקן הוא עמוד הפרופיל המרכזי של כל משתמש בפלטפורמה. הוא מציג את זהותו, ביצועיו, הישגיו, פעילותו החברתית והתקדמותו במשחק.

**תמונת הייחוס המצורפת היא הבסיס המחייב לעיצוב.**

יש לשחזר את החלק המרכזי והימני בלבד בתמונה.

יש להתעלם לחלוטין מהעמודה השמאלית הכוללת את התיבות "סיכום האפיון" ו"מרכיבי הכרטיס". עמודה זו אינה חלק מהאתר ואסור ליצור אותה.

אין להוסיף רכיבים חדשים שלא הוגדרו באפיון, ואין לשנות את השפה העיצובית של הכרטיס.

הכרטיס חייב להיות דינמי, מבוסס נתוני משתמש אמיתיים ומוכן לחיבור למנגנונים העתידיים של הפלטפורמה.

---

## 2. שפה עיצובית כללית – DESIGN SYSTEM

### סגנון

Dark Luxury Gaming Dashboard.

העיצוב צריך לשלב תחושה של פלטפורמת השקעות מקצועית עם חוויית משחק יוקרתית, בדומה למערכות דירוג, הישגים ופרסים במשחקי פרימיום.

### צבעים

- רקע ראשי: שחור עמוק (#08090B בקירוב).
- רקע כרטיסיות: שחור עם גוונים כהים של אפור.
- גבולות כרטיסיות: זהב מתכתי.
- כותרות: זהב בהיר.
- מספרים רגילים: זהב.
- תשואה חיובית: ירוק.
- תשואה שלילית: אדום.
- נקודות XP: סגול וזהב.
- טקסט משני: אפור בהיר או שמנת.

יש להשתמש בזהב בצורה אלגנטית, עם אפקט Glow עדין ולא מוגזם.

### מאפיינים ויזואליים

- מסגרות זהב דקות וזוהרות.
- פינות מעוגלות.
- צללים עדינים.
- אייקונים מעוצבים בסגנון משחקי.
- מדליות בעלות עומק חזותי.
- טיפוגרפיה יוקרתית וברורה.
- הפרדה חזותית בין האזורים.
- אנימציות Hover עדינות בלבד.

### פריסה

העמוד יהיה בעברית ובכיווניות RTL.

יש לשמור על המבנה הבא בגרסת Desktop:

1. כותרת ראשית וכרטיס פרופיל רחב.
2. שורה של שש כרטיסיות מדדים.
3. שורה של שלושה אזורים:
   - בצד ימין: השתתפות בתחרויות.
   - במרכז: הישגים במשחק.
   - בצד שמאל: מדליות מקצועיות.
4. שורה תחתונה:
   - בצד ימין: התקדמות במשחק.
   - בצד שמאל: ביצועי שחקן.

יש לשמור על פרופורציות דומות ככל האפשר לתמונת הייחוס.

במסכים קטנים יש להתאים את הפריסה באופן רספונסיבי בלי לפגוע בקריאות הנתונים ובלי להסתיר מדדים.

---

## 3. אזור ראשון – PLAYER HEADER

### מבנה חזותי

בראש העמוד תופיע הכותרת:

"כרטיס שחקן"

מתחת לכותרת יוצג כרטיס פרופיל אופקי רחב.

הכרטיס יחולק לשלושה חלקים:

- שמאל: תמונת פרופיל.
- מרכז: זהות השחקן, דרגה ותואר.
- ימין: תיאור אישי (Bio).

יש להפריד בין אזור הפרטים לבין ה-Bio באמצעות קו אנכי מוזהב, כפי שמופיע בתמונה.

### 3.1 תמונת פרופיל

השחקן יוכל:

- להעלות תמונת פרופיל מהמכשיר שלו.
- לבחור אווטאר מתוך גלריה שהפלטפורמה מספקת.
- לבחור מתוך תמונות פרופיל ייחודיות ומעוצבות שהפלטפורמה מציעה.

התמונה תוצג בעיגול גדול עם מסגרת זהב זוהרת.

יש להגדיר תמונת ברירת מחדל למשתמש שלא בחר תמונה.

### 3.2 זהות השחקן

הזהות המרכזית היא כינוי המשחק (Username).

הכינוי יוצג בגופן הגדול והבולט ביותר.

לדוגמה:

@growthhunter

מתחת לכינוי ניתן להציג שם פרטי, אם המשתמש בחר להוסיף אותו.

שם פרטי אינו חובה.

כינוי המשחק הוא חובה.

כל כינוי חייב להיות ייחודי במערכת, ואין לאפשר שני משתמשים בעלי אותו כינוי.

בעת בחירת הכינוי יש לבצע בדיקת זמינות מול מאגר המשתמשים.

הכינוי יהיה הזהות הראשית של השחקן בכל חלקי הפלטפורמה.

### 3.3 דרגת שחקן – LEVEL

מתחת לשם יופיע תג המציג את דרגת השחקן.

דוגמה:

Level 27

הדרגה נקבעת אוטומטית לפי נקודות XP שהשחקן צבר.

לא ניתן להזין או לערוך דרגה באופן ידני.

נקודות XP יכולות להתקבל בעקבות:

- התקדמות במשחק.
- רווחיות וביצועי השקעות.
- פעילות וניהול תיקי השקעות.
- כמות תיקים.
- עוקבים ומנויים.
- מדליות מקצועיות.
- הישגים במשחק.

מנגנון הניקוד המדויק יוגדר בהמשך.

### 3.4 תואר שחקן – PLAYER TITLE

לצד הדרגה יוצג התואר של השחקן.

דוגמה:

Elite Investor

התואר ייקבע אוטומטית באמצעות בנק תארים מרכזי.

כל תואר יהיה משויך לרמה מסוימת או לטווח רמות.

המערכת תשלוף את התואר המתאים בהתאם לרמת השחקן.

יש להציג את התואר בתוך תג מעוצב עם אייקון, למשל כתר.

אין לאפשר בחירה חופשית של תואר שאינו תואם את הדרגה.

בנק התארים והשיוך לרמות יוגדרו בנפרד.

### 3.5 תיאור אישי – BIO

בצד ימין יוצג אזור בשם:

"תיאור השחקן"

המשתמש יוכל להזין תיאור אישי חופשי.

מגבלת אורך: 100 תווים.

יש להציג מונה תווים בזמן עריכה.

ה-Bio אינו קשור לתואר שהמערכת מעניקה לשחקן.

יש לאפשר למשתמש לערוך את הפרטים האישיים שלו, אך לא את הדרגה, התואר או ה-XP.

---

## 4. אזור שני – SIX MAIN STATISTICS

מתחת לכרטיס הפרופיל יש להציג שש כרטיסיות בהתאם לתמונת הייחוס.

כל כרטיסייה תכלול:

- כותרת.
- אייקון מתאים.
- נתון מספרי בולט.
- Tooltip המסביר את משמעות המדד.

סדר הכרטיסיות מימין לשמאל:

### 4.1 אחוז תשואה ממוצעת של כלל התיקים הפעילים

המדד יציג את ממוצע אחוזי התשואה של כל תיקי ההשקעות הפעילים של השחקן.

כל תיק בפלטפורמה מתחיל עם הון וירטואלי של $10,000.

החישוב יהיה ממוצע חשבוני פשוט של אחוזי התשואה.

לכל תיק יהיה משקל זהה.

תשואת כל תיק נמדדת ממועד פתיחתו ועד למועד המדידה.

אין לנרמל את התיקים לתקופה אחידה ואין לבצע התאמה למשך חיי התיק. עיתוי הכניסה להשקעה הוא חלק מביצועי השחקן.

תיקים סגורים אינם נכללים בחישוב.

**תנאי הצגה:**

המדד ייפתח רק כאשר לשחקן יש לפחות שני תיקים פעילים.

כאשר יש פחות משני תיקים פעילים, הכרטיסייה תישאר במקומה ותציג מנעול עם ההסבר:

"נפתח מ־2 תיקים פעילים".

### 4.2 הישגים במשחק – GAME ACHIEVEMENTS

הצג את מספר ההישגים שהשחקן צבר במשחק.

הישגים אלו יכולים להתקבל באמצעות:

- תחרויות.
- משימות חודשיות.
- אתגרים.
- פעילות במשחק.
- פעילות חברתית.

המדד יציג את מספר ההישגים הכולל, ללא קשר למספר ההישגים המוצגים בהמשך הכרטיס.

### 4.3 מדליות מקצועיות – PROFESSIONAL MEDALS

הצג את מספר המדליות המקצועיות שהשחקן קיבל.

מדליות מקצועיות מתקבלות בעקבות השגת יעדים מקצועיים בתחום ההשקעות.

יש לשמור על הפרדה בין מדליות מקצועיות לבין הישגים במשחק.

### 4.4 מנויים – PAID SUBSCRIBERS

הצג את מספר המנויים המשלמים הפעילים של השחקן.

מחיר המנוי הוא $3 לחודש.

מנוי משלם מקבל גישה לתיקי ההשקעות של היוצר ולמבנה האחזקות שלהם.

רק משתמש בעל מנוי פעיל רשאי לגשת למידע המוגן של תיקי היוצר.

יש לנהל את הרשאות הגישה בהתאם לסטטוס המנוי.

מספר המנויים הוא נתון ברמת השחקן, ולא ברמת תיק בודד.

### 4.5 עוקבים – FOLLOWERS

הצג את מספר המשתמשים שעוקבים אחר השחקן בחינם.

משתמש יכול לגלות תיק של שחקן דרך ה-Leaderboard, להתעניין ביוצר שלו ולבחור לעקוב אחריו.

מעקב בחינם אינו מעניק גישה למבנה האחזקות או לתוכן התיקים המוגן למנויים.

מספר העוקבים הוא נתון ברמת השחקן, ולא ברמת תיק.

### 4.6 התיק המוביל – BEST PORTFOLIO GAIN

הצג את אחוז התשואה המצטברת של התיק הפעיל בעל הביצועים הגבוהים ביותר של השחקן.

יש לבחור את התיק בעל התשואה הגבוהה ביותר מתוך התיקים הפעילים בלבד.

המדד יוצג רק כאשר קיימים לפחות שני תיקים פעילים.

כאשר יש פחות משני תיקים פעילים, הצג מנעול והסבר:

"נפתח מ־2 תיקים פעילים".

אין להחיל על המדד הזה את סף 20% השייך למדד התיק המצטיין באזור ביצועי השחקן.

### כללי תצוגה משותפים

- שש הכרטיסיות תמיד יישארו גלויות.
- נעילת מדד לא תשנה את סדר הכרטיסיות או את ממדיהן.
- ערכים חיוביים יוצגו בירוק.
- ערכים שליליים יוצגו באדום.
- לכל מדד יהיה Tooltip קצר ונגיש.
- הנתונים יתעדכנו אוטומטית מהמערכת.

---

## 5. מערכת תיקי ההשקעות – PORTFOLIO RULES

יש לתכנן את הנתונים בכרטיס כך שיתמכו במודל הבא.

כל תיק נפתח עם $10,000 וירטואליים.

לכל משתמש חדש ניתנת הרשאה לניהול של עד שלושה תיקים.

התיק הראשון ניתן בחינם.

פתיחת תיק נוסף כרוכה בתשלום של $10–15, כאשר המחיר הסופי ייקבע בהמשך.

### מסלולי הרשאה

**Basic:**
- הרשאה לניהול עד 3 תיקים.
- תיק ראשון בחינם.
- פתיחת תיקים נוספים בתשלום.

**Advanced:**
- תשלום של $50 עבור הרחבת ההרשאה לעד 10 תיקים.
- התשלום מעניק מכסת תיקים, אך אינו כולל פתיחת תיקים נוספים בחינם.
- כל פתיחת תיק נוסף כרוכה בתשלום נפרד.

**Unlimited:**
- תשלום של $100 עבור הרשאה למספר בלתי מוגבל של תיקים.
- מנגנון חיוב פתיחת התיקים פועל בנפרד מהרשאת המסלול, בהתאם למחיר שייקבע.

יש להפריד במבנה הנתונים בין סוג המסלול, מספר התיקים שנפתחו, מספר התיקים הפעילים והרשאות המשתמש.

אין צורך להוסיף אזור תמחור לכרטיס השחקן בתמונה. המידע הזה מגדיר את לוגיקת הפלטפורמה בלבד.

---

## 6. אזור שלישי – PROFESSIONAL MEDALS

### מטרה

להציג את ארבע המדליות המקצועיות המשמעותיות והיוקרתיות ביותר שהשחקן השיג.

### עיצוב

בהתאם לתמונת הייחוס, יש להציג ארבע מדליות מעוצבות בשורה בתוך מסגרת כהה ומוזהבת.

כל מדליה תכלול:

- אייקון או סמל ייחודי.
- שם המדליה.
- עיצוב המשקף את רמת היוקרה והחשיבות שלה.

המדליות יהיו בעלות מראה יוקרתי, עם אפשרות לצבעי זהב, כסף, ארד, אבני חן וסמלים מקצועיים.

### לוגיקה

יש ליצור מבנה נתונים עבור בנק מדליות מקצועיות (Professional Medals Bank).

לכל מדליה יהיו:

- מזהה ייחודי.
- שם.
- תיאור.
- אייקון.
- תנאי קבלה.
- רמת יוקרה או חשיבות.
- ניקוד XP שיוענק בעת השגתה.

האזור יציג רק מדליות שהשחקן קיבל בפועל.

מתוך כלל המדליות יוצגו ארבע המדליות היוקרתיות ביותר, לפי מנגנון דירוג שיוגדר בהמשך.

לחיצה על מדליה תפתח חלונית עם מידע על המדליה ותנאי קבלתה.

אין להמציא בשלב הנוכחי בנק מדליות סופי או תנאי קבלה.

---

## 7. אזור רביעי – GAME ACHIEVEMENTS

### מטרה

להציג את ארבעת הישגי המשחק הבולטים ביותר של השחקן.

ההישגים נועדו להגדיל את המעורבות, התחרותיות וההנאה בפלטפורמה.

### עיצוב

הצג ארבעה סמלי הישגים בהתאם לתמונת הייחוס.

העיצוב צריך להיות מעט יותר משחקי, צבעוני ויצירתי ממדליות מקצועיות.

יש לשמור על מסגרת הכרטיס השחורה והמוזהבת.

### לוגיקה

יש ליצור בנק הישגים במשחק (Game Achievements Bank), נפרד מבנק המדליות המקצועיות.

הישגים יכולים להתקבל באמצעות:

- השתתפות בתחרויות.
- השלמת משימות חודשיות.
- השלמת אתגרים.
- התקדמות במשחק.
- פעילות קהילתית.

לכל הישג יהיו:

- מזהה ייחודי.
- שם.
- תיאור.
- אייקון.
- תנאי קבלה.
- רמת חשיבות.
- כמות XP.

יש להציג את ארבעת ההישגים הבולטים ביותר שהשחקן קיבל בפועל.

לחיצה על הישג תציג הסבר על ההישג ועל הדרך שבה התקבל.

בנק ההישגים עצמו יוגדר בהמשך.

---

## 8. אזור חמישי – COMPETITION STATISTICS

שם האזור:

"השתתפות בתחרויות"

מערכת התחרויות היא אחד ממנועי המעורבות המרכזיים של הפלטפורמה.

יש לשחזר את מבנה הכרטיס בתמונת הייחוס: מסגרת כהה ומוזהבת וטבלה קומפקטית בת ארבע שורות.

### 8.1 השתתפויות

מספר התחרויות שבהן השחקן השתתף בפועל.

כל תחרות תיספר פעם אחת.

### 8.2 זכיות

מספר התחרויות שבהן השחקן זכה בפרס.

זכייה אינה בהכרח זהה לסיום באחד משלושת המקומות הראשונים.

הגדרת הפרסים, תנאי הזכייה וחלוקתם ייקבעו בהמשך.

### 8.3 TOP 3

מספר התחרויות שבהן השחקן סיים באחד משלושת המקומות הראשונים.

סיום במקום ראשון נכלל גם בספירת Top 3.

### 8.4 מקום 1

מספר התחרויות שבהן השחקן סיים במקום הראשון.

### מנגנון התחרויות

המערכת תתמוך בתחרויות מתמשכות מסוגים שונים.

דוגמאות:

- תחרות התשואה הגבוהה ביותר בספטמבר 2026.
- תחרות התשואה הגבוהה ביותר ברבעון השלישי של 2026.
- תחרויות נוספות לפי תקופות ומדדי השקעה.

כל תחרות יכולה לכלול דמי השתתפות וקופת פרסים (Prize Pool).

קופת הפרסים תגדל בהתאם למספר המשתתפים.

פרטי התמחור, שיעור ההפרשה לקופה וחלוקת הפרסים יוגדרו בהמשך.

### ניהול נתונים

יש לשמור לכל תחרות:

- מזהה.
- שם.
- תקופת התחרות.
- דמי השתתפות.
- משתתפים.
- קופת פרסים.
- קריטריון דירוג.
- תוצאות.
- מיקום השחקן.
- סטטוס זכייה בפרס.

יש להבחין בין תחרויות פעילות לבין תחרויות שהסתיימו.

מיקום סופי וזכייה בפרס ייספרו רק לאחר אישור התוצאות.

הנתונים בכרטיס השחקן יתעדכנו אוטומטית.

לכל מדד תתווסף חלונית הסבר קצרה.

אין צורך לבנות את מנגנון התחרויות המלא במסגרת כרטיס השחקן. נדרש להכין את הרכיב לחיבור אליו בעתיד.

---

## 9. אזור שישי – PLAYER PERFORMANCE

שם האזור:

"ביצועי שחקן"

יש לשמור על העיצוב הקיים בתמונת הייחוס, אך להחליף את הנתונים בשישה המדדים הבאים.

העיצוב יהיה טבלה קומפקטית עם שמות המדדים מצד אחד והערכים מהצד השני.

### 9.1 סה"כ תיקים

מספר כל התיקים שהשחקן פתח מאז שהצטרף לפלטפורמה.

כולל תיקים פעילים ותיקים שנסגרו.

### 9.2 תיקים פעילים

מספר התיקים שמוגדרים Active במועד הצפייה.

### 9.3 תשואה ממוצעת

ממוצע אחוזי התשואה של כל התיקים הפעילים.

החישוב חייב להיות זהה לחישוב של המדד הראשון בשורת שש הכרטיסיות.

יש להשתמש באותו מקור נתונים ובאותו מנוע חישוב.

המדד זמין רק כאשר לשחקן יש לפחות שני תיקים פעילים.

### 9.4 תשואה חודשית ממוצעת

הצג את ממוצע אחוזי התשואה של כלל התיקים הפעילים בחודש הקלנדרי הנוכחי.

החישוב:

1. חשב את תשואת כל תיק פעיל מתחילת החודש ועד למועד המדידה.
2. עבור תיק שנפתח במהלך החודש, חשב את תשואתו ממועד הפתיחה.
3. חשב ממוצע חשבוני פשוט של תשואות התיקים הפעילים.
4. כל תיק יקבל משקל שווה, ללא קשר לשווי הנוכחי שלו.
5. תיקים סגורים לא ייכללו בחישוב.

בתחילת כל חודש תתחיל תקופת מדידה חדשה.

המדד יציג את התשואה החודשית הממוצעת, ולא את שיעור החודשים שבהם השחקן היה רווחי.

### 9.5 תיק מצטיין – שם התיק

הצג את שם התיק הפעיל בעל התשואה המצטברת הגבוהה ביותר, בתנאי שתשואתו גבוהה מ־20%.

אם אין לשחקן תיק פעיל בעל תשואה גבוהה מ־20%, הצג את המדד כנעול.

אין להציג שם תיק במקרה כזה.

### 9.6 תשואת תיק מצטיין

הצג את אחוז התשואה המצטברת של התיק שנבחר במדד הקודם.

גם מדד זה זמין רק כאשר קיים תיק פעיל בעל תשואה גבוהה מ־20%.

כאשר התנאי אינו מתקיים, הצג מנעול.

שני מדדי התיק המצטיין חייבים להתייחס לאותו תיק ולהיפתח ולהינעל יחד.

### עיצוב נעילה

במצב נעול יש להציג אייקון מנעול מוזהב או אפור עם הסבר קצר.

כל שש השורות יישארו במקומן גם כאשר חלק מהן נעולות.

---

## 10. אזור שביעי – PLAYER PROGRESSION & XP

שם האזור:

"התקדמות במשחק"

יש לשחזר את מבנה האזור בהתאם לתמונת הייחוס.

### מבנה

הצג:

- סמל דרגה מעוצב.
- מספר Level נוכחי.
- מספר נקודות XP שנצברו.
- מספר נקודות XP הדרושות לרמה הבאה.
- פס התקדמות אופקי.
- הרמה הבאה.
- התואר הבא מתוך בנק התארים.

פס ההתקדמות יהיה בצבעי זהב וסגול בהתאם לשפה העיצובית.

### מערכת XP

השחקן צובר XP כתוצאה מפעילות, הישגים והתקדמות בפלטפורמה.

מקורות הצבירה כוללים:

- ביצועי השקעות.
- רווחיות.
- פעילות וניהול תיקים.
- מספר תיקים.
- עוקבים.
- מנויים.
- מדליות מקצועיות.
- הישגים במשחק.

**מדליות מקצועיות יעניקו בדרך כלל יותר XP מהישגי משחק רגילים**, בהתאם למנגנון הניקוד שיוגדר בהמשך.

יש לשמור על מנגנון XP מרכזי אחד.

הדרגה שמופיעה באזור זה חייבת להיות זהה לדרגה שמופיעה בכותרת הפרופיל.

### תארים

יש להשתמש באותו בנק תארים שהוגדר באזור הראשון.

המערכת תזהה מהו התואר הנוכחי ומהו התואר הבא בהתאם להתקדמות השחקן.

מנגנון ספי ה-XP, מעבר הרמות ותנאי התארים יוגדר בנפרד.

אין להמציא בשלב זה טבלת XP או תארים סופית.

---

## 11. כללי אינטראקציה – UX

יש לאפשר אינטראקציות עדינות ואחידות בכרטיס.

### חלוניות מידע

לכל מדד מספרי משמעותי תופיע אפשרות לפתוח הסבר קצר.

במחשב באמצעות Hover או לחיצה על אייקון מידע.

בטלפון באמצעות לחיצה.

ההסבר יציג מה המדד מודד, ללא מידע טכני מיותר.

### מדליות והישגים

לחיצה על מדליה או הישג תפתח חלונית המציגה את השם, התיאור, משמעות ההישג ותנאי קבלתו.

### מצבי נעילה

מדדים נעולים חייבים להישאר גלויים במקומם.

הנעילה תוצג בצורה ברורה אך אלגנטית.

כל מצב נעילה יכלול הסבר על התנאי הדרוש לפתיחתו.

### מידע אישי

רק בעל החשבון רשאי לערוך את תמונת הפרופיל, השם הפרטי, הכינוי וה-Bio, בכפוף לכללי המערכת.

דרגות, תארים, XP, מדליות, הישגים, תשואות ונתוני תחרויות נקבעים ומעודכנים על ידי המערכת בלבד.

---

## 12. מבנה נתונים וחיבור למערכת

יש לבנות רכיבים דינמיים ומודולריים.

מבנה הנתונים צריך לתמוך לפחות בישויות הבאות:

**Player**
- מזהה שחקן.
- כינוי ייחודי.
- שם פרטי אופציונלי.
- תמונת פרופיל.
- Bio.
- Level.
- XP.
- תואר נוכחי.

**Portfolio**
- מזהה תיק.
- בעל התיק.
- שם תיק.
- תאריך פתיחה.
- תאריך סגירה, אם רלוונטי.
- סטטוס.
- הון התחלתי של $10,000.
- שווי נוכחי.
- תשואה מצטברת.
- תשואה חודשית.

**Player Social Stats**
- מספר עוקבים.
- מספר מנויים משלמים פעילים.
- הרשאות צפייה בתיקים.

**Professional Medals**
- בנק מדליות.
- מדליות שהוענקו לשחקן.
- דרגת יוקרה.
- XP.

**Game Achievements**
- בנק הישגים.
- הישגי השחקן.
- XP.

**Competitions**
- פרטי תחרות.
- השתתפויות.
- דירוגים.
- תוצאות סופיות.
- זכיות בפרסים.

**Progression**
- XP נוכחי.
- Level.
- דרישות הרמה הבאה.
- בנק תארים.

אין צורך לבנות את כל מנגנוני הפלטפורמה בשלב זה, אך מבנה כרטיס השחקן צריך להיות מוכן לחיבור אליהם.

אם עדיין אין Backend או נתוני אמת, השתמש בנתוני Demo מופרדים מהלוגיקה, שניתן להחליף בקלות במידע אמיתי.

אין לקבע את ערכי הדוגמה שבתמונת הייחוס בתוך הרכיבים.

---

## 13. דרישות איכות ופיתוח

- תמיכה מלאה ב-RTL.
- עיצוב רספונסיבי.
- שמירה על עקביות בעיצוב.
- רכיבים מודולריים.
- הפרדה בין נתונים, חישובים ותצוגה.
- מניעת כפילות של חישובי תשואה או XP.
- חיבור משותף למקורות נתונים כאשר אותו נתון מופיע במספר אזורים.
- הצגת מצבים תקינים של נתון חסר, אפס, נעול או לא זמין.
- טיפול בטקסטים ארוכים בלי לפגוע בפריסת הכרטיס.
- תמיכה נכונה בשילוב עברית ואנגלית.

יש להימנע מהוספת רכיבים, כפתורים, מנגנונים או מדדים שלא אושרו במסגרת האפיון.

---

## 14. קריטריונים להשלמת המשימה

המשימה תיחשב כמושלמת כאשר:

1. כרטיס השחקן משחזר את הסגנון והפריסה של תמונת הייחוס ללא העמודה השמאלית.
2. שבעת האזורים קיימים וממוקמים בהתאם לאפיון.
3. ששת המדדים המרכזיים פועלים בהתאם להגדרות ולתנאי הנעילה.
4. מדדי הביצועים מחושבים לפי התיקים הפעילים והתקופות שהוגדרו.
5. מדליות מקצועיות והישגי משחק מנוהלים כשתי מערכות נפרדות.
6. אזור התחרויות מציג את ארבעת המדדים הנדרשים.
7. Level, XP והתארים מחוברים למערכת התקדמות אחידה.
8. כל חלוניות המידע והאינטראקציות פועלות.
9. העיצוב מתאים גם למחשב וגם לטלפון.
10. רכיבים שטרם הוגדרה עבורם לוגיקה עסקית סופית מוכנים להרחבה עתידית, ללא המצאת חוקים.

### הנחיית ביצוע סופית

אל תעצב את כרטיס השחקן מחדש.

השתמש בתמונת הייחוס כדי לשחזר את השפה הגרפית, מבנה הרכיבים, סדר התצוגה, האייקונים, הפרופורציות והאווירה הכללית.

התייחס לאפיון הטקסטואלי כמקור האמת להגדרת הנתונים, המדדים, תנאי ההצגה והאינטראקציות, במיוחד במקרים שבהם שינינו את התוכן המופיע בתמונת המקור.

המטרה היא ליצור כרטיס שחקן מרשים, מקצועי, משחקי ודינמי, שנראה קרוב ככל האפשר לתמונה המקורית וניתן להרחבה בהמשך פיתוח הפלטפורמה.

</div>

---

# PART 4 — PLAYER CARD: RULES SUMMARY AND GAP (2026-10-16)

An English summary of the rules in Part 3, for reference only. **Part 3 is
the source of truth**; where this summary and Part 3 differ, Part 3 wins.
Section numbers refer to Part 3.

## Rules summary

**Layout (2).** Hebrew, right-to-left. Desktop rows: page title and a wide
profile card; six stat cards; Competitions (right), Game Achievements
(centre), Professional Medals (left); Game Progress (right), Player
Performance (left). Responsive on small screens without hiding any metric.
The reference image is the binding design basis, excluding its left column.

**Header (3).**
- Profile picture: upload, platform avatar gallery, or special platform
  images; a default when none is chosen; large circle with a glowing gold
  border.
- Nickname: mandatory, unique, availability checked on selection, the
  player's primary identity everywhere. First name optional.
- Level: derived from XP only, never entered or edited.
- Title: looked up from a central title bank by level or level range; never
  freely chosen.
- Bio, labelled "Player Description": free text, at most 100 characters, with
  a live counter; independent of the title.

**Six stat cards (4)**, always visible, order and size unchanged when locked,
green for positive and red for negative values, each with a tooltip:

| # | Card | Rule | Lock |
|---|---|---|---|
| 4.1 | Average return, active portfolios | Simple arithmetic mean of each active portfolio's return since it opened; equal weights; no period normalisation; closed portfolios excluded | Locked below 2 active portfolios: "נפתח מ־2 תיקים פעילים" |
| 4.2 | Game achievements | Total count earned, regardless of how many the card displays | — |
| 4.3 | Professional medals | Total count earned; kept separate from achievements | — |
| 4.4 | Paid subscribers | Active paid subscribers; $3/month; grants access to the creator's portfolios and holdings; player-level | — |
| 4.5 | Followers | Free followers; discovery is via the Leaderboard; grants no access to holdings or subscriber content; player-level | — |
| 4.6 | Best portfolio gain | Highest cumulative return among active portfolios; the 20% threshold of 9.5 does **not** apply | Locked below 2 active portfolios |

**Portfolio plans (5)** — platform logic, not shown on the card:
- Every portfolio opens with $10,000 virtual.
- Basic: up to 3 portfolios; the first is free; each further opening costs
  $10–15 (final price TBD).
- Advanced: $50 raises the allowance to 10; openings are still paid
  separately.
- Unlimited: $100 for no limit; openings are still paid separately.
- The data model separates plan type, portfolios opened, portfolios active,
  and permissions.

**Professional medals (6)** and **game achievements (7):** two separate
banks. Each entry: unique ID, name, description, icon, earning condition,
prestige/importance, XP. The card shows the player's top 4 of each, earned
only, by a ranking to be defined. Clicking one opens its details and
condition. The banks' contents are deliberately not defined yet.

**Competitions (8):** four counts — participations (each competition once),
prize wins (not necessarily top 3), top 3 (includes 1st), 1st place. Final
placing and prizes count only once results are confirmed. Per competition:
ID, name, period, entry fee, participants, prize pool, ranking criterion,
results, the player's placing, prize status; active vs. ended. Entry fees and
a prize pool that grows with participants; pricing, pool share and
distribution TBD. Only the card's component is in scope, not the full
competition system.

**Player performance (9)** — six rows, always in place:

| # | Row | Rule | Lock |
|---|---|---|---|
| 9.1 | Total portfolios | Every portfolio ever opened, active and closed | — |
| 9.2 | Active portfolios | Count with status Active at view time | — |
| 9.3 | Average return | Identical to 4.1: same data source and same engine | Locked below 2 active |
| 9.4 | Average monthly return | Mean over active portfolios of each one's return from the start of the current calendar month (or from opening, if opened this month) to now; equal weights; closed excluded; resets each month. Not the share of profitable months | None stated |
| 9.5 | Top portfolio — name | Active portfolio with the highest cumulative return, only if above 20% | Locked otherwise; no name shown |
| 9.6 | Top portfolio — return | The cumulative return of the portfolio in 9.5 | Locks and unlocks together with 9.5 |

**Progression (10):** rank emblem, current level, XP earned, XP needed for the
next level, a gold-and-purple progress bar, next level, next title. One
central XP system; the level here must equal the level in the header. XP
sources: investment performance, profitability, portfolio activity, number
of portfolios, followers, subscribers, medals, achievements; medals usually
give more XP than ordinary achievements. Thresholds, level transitions and
title conditions are deliberately not defined yet.

**Interaction (11):** a short explanation for every significant figure
(hover or info icon on desktop, tap on mobile); a details panel for medals
and achievements; locked metrics stay visible with the unlock condition.
Only the owner edits picture, first name, nickname and bio, subject to system
rules. Level, title, XP, medals, achievements, returns and competition data
are set by the system only.

**Data and quality (12–13):** entities Player, Portfolio, Player Social
Stats, Professional Medals, Game Achievements, Competitions, Progression.
Separate data, calculations and display; no duplicated return or XP
calculation; shared data sources where a figure appears in several places;
proper missing / zero / locked / unavailable states; long text must not break
the layout; correct mixed Hebrew and English. Nothing may be added that the
spec does not approve. Demo data, if used, stays separate from logic and
must not hard-code the reference image's sample values.

## Conflicts with the main spec (Part 1)

1. **UI language.** Part 1: "The UI language must be English." Part 3: Hebrew,
   RTL. *Decided 2026-10-16:* both, switchable — see "Decided" below.
2. **View Portfolios button.** Part 1 lists it on the Player Card as the
   subscriber's route into Dashboard 2. Part 3 does not include it and forbids
   adding components it does not define, which as written leaves no route
   from the card to the portfolios.
3. **"Average monthly return" names two different metrics.** Part 3 §9.4 is a
   player-level month-to-date average across active portfolios. Part 1
   Module 5 is a per-portfolio statistic over its whole history. They need
   different metric IDs and probably different labels.
4. **Visual direction.** Part 3's "Dark Luxury Gaming Dashboard", game-style
   icons, purple XP accent and `#08090B` background sit uneasily with Part
   1's restrained gold and "avoid a casino-like visual style", and differ from
   the current `--bg-base: #080B11`.
5. **Portfolio status.** Part 3 uses Active and Closed; Part 1 adds Archived,
   still undefined.
6. **"Average Return Across All Portfolios"** in Part 1 becomes "active
   portfolios" in Part 3. Treated as a refinement, not a conflict.

## Clashes with the current code

- **Portfolio allowance.** Every account currently gets 3 free portfolios
  (`FREE_TIER_PORTFOLIO_LIMIT`); Part 3 makes only the first free.
  `portfolioLimitFor()` is the existing hook for plans.
- **No closing.** Portfolios have no status or close date, yet 4.1, 4.6 and
  9.1–9.6 all depend on Active vs. Closed.
- **Nickname.** `users.display_name` is nullable, not unique, and falls back
  to the email local-part. A unique nickname needs a migration and a rule for
  existing accounts.
- **9.4 needs NAV history.** Month-to-date return needs each portfolio's value
  at the start of the month, which only the phase 5 snapshots will provide.

## Undefined in Part 3

- **Payments.** Who receives the $3 subscription (creator, platform, split);
  whether the $50 / $100 plans are one-time or recurring; the final price of
  an extra portfolio opening.
- **Rankings and scoring.** How the "top 4" medals and achievements are
  ranked; XP amounts; level thresholds; the title bank. All deliberately
  deferred.
- **Nickname rules.** Case sensitivity, allowed characters and length, and
  whether and how often it can be changed ("subject to system rules").
- **Lock for 9.4.** No minimum-portfolios condition is stated, unlike 9.3. Is
  that intended?
- **Which return.** Part 3 says "return" without qualification; Part 1
  requires game-earned capital never to count as return, so these should be
  the flow-adjusted returns from the metric engine.

## Legal note — before building anything that takes money

Part 3 adds real-money pricing in three places: subscriptions apparently paid
to creators, paid portfolio plans, and competitions with entry fees and a
prize pool that grows with participants. Paid-entry contests with prizes can
fall under gambling or lottery law — short-period stock returns carry a large
element of chance, and Israel's rules (Penal Law §§224–235) are strict. Paying
creators adds KYC, tax reporting and marketplace terms. Get a lawyer's view
before building prize pools or creator payouts; the non-monetary parts do not
depend on it.

## Buildable now

Defined well enough to implement without inventing rules:

- In the metric engine: average active-portfolio return with the 2-portfolio
  lock (4.1 / 9.3, one function for both); best active portfolio with the
  lock (4.6); top portfolio above 20%, name and return as one locked unit
  (9.5 / 9.6); total and active counts (9.1 / 9.2); the 9.4 average given
  each portfolio's month-to-date return, and month-to-date return itself
  from a NAV series; the four competition counts from confirmed results.
- In the data model: Player identity fields, the medal and achievement banks
  and awards, competitions and entries, progression — as empty structures,
  with no invented values.

Blocked: 9.4 in production on NAV history; XP, levels and titles on the
deferred scoring rules; anything taking money on the legal review. The UI is
no longer blocked: the reference image arrived and the language is decided.

## Decided (2026-10-16)

- **UI language: Hebrew and English, switchable.** Hebrew is right-to-left
  and English left-to-right, with every string in translation files. This
  overrides Part 1's English-only rule and satisfies Part 3's Hebrew RTL.
- **Reference image received.** It matches Part 3's layout. Where it differs,
  Part 3's text decides the data, as Part 3 itself instructs:
  - Name: the image shows a full name above the nickname; the text makes the
    nickname the largest, with an optional first name below.
  - Competitions, last row: the image shows "highest rank"; the text counts
    first-place finishes.
  - Player Performance: the image has five rows including "monthly profit
    rate"; the text has six, with average monthly return and the top
    portfolio's return.
  - Game Progress: the text also requires the current level number.
  - The subtitle under the page title appears only in the image and is left
    out.

  The image is not stored in this repository: it contains a photograph of a
  person, and the repository may be public.
- **Month boundary for 9.4: Israel time** (`Asia/Jerusalem`), implemented in
  the metric engine as `MONTH_TIME_ZONE`.
- **Ties for 4.6 / 9.5: the portfolio opened first**, then the lower id.
- **Market data provider: Massive, free Basic plan** (2026-10-20). Alpha
  Vantage is removed. Checked against the live API with the account's key:
  daily bars for two years, ticker overview, news with per-ticker sentiment,
  ticker search, dividends and market status are included; snapshots, last
  trade, intraday bars, fundamentals (P/E, statements) and any non-US exchange
  are not. Consequence accepted knowingly: **trades execute at the latest
  daily close**, so a player can buy during a session at yesterday's price
  after seeing today's move. Upgrading the plan closes that gap; the code
  needs only `MASSIVE_REQUESTS_PER_MINUTE` and `MASSIVE_INTRADAY` changed, plus
  a snapshot-based quote.

---

# PART 5 — PLAYER TITLES, GAME ACHIEVEMENTS AND XP (2026-10-24)

Two specs supplied in chat on 2026-10-24: **"Luxury Player Title System"** and
**"BEAT THE MARKET — Game Achievements & XP Progression System, v1.2"**, with a
reference image of the title screen. Their data is reproduced exactly in
`src/progression/catalog.json`, and `src/progression/catalog.test.ts` checks it
against the approved tables: 60 titles (20 tiers × Professional Path, Market
Legends, Capital Empire) and 62 game achievements in 7 categories, with both
languages, conditions and XP.

## What exists

- **XP ledger** (`xp_transactions`). Every grant from any source is one row
  with a unique idempotency key, so a replayed event grants nothing. A
  player's total is the sum of the rows. Sources supported: game
  achievements now; professional achievements, competitions and daily login
  write to the same ledger later (`awardXp`).
- **Levels 1–100** from `level_thresholds` (XP needed to reach each level).
  The thresholds are not decided, so the table **ships empty**: everyone is
  level 1 and the card says thresholds are not set, with no invented target.
  A gap stops progression at the last configured level. Rows carry an
  `is_provisional` flag, shown on the card while any is set.
- **Titles.** All three titles of a tier unlock together on the tier's first
  level (1, 6, 11 … 96) and are never removed. One active title; only owned,
  enabled titles can be activated, checked on the server. Special and store
  titles fit the same table (`source_type`, `rarity`, `unlock_condition`,
  `is_purchasable`, `price_cents`); none exist yet.
- **Unlock ceremony.** One per tier reached (`title_ceremonies`), shown until
  the player chooses a title or keeps the current one. A jump across several
  tiers grants every title and shows one ceremony with the highest tier's
  three; acknowledging it closes all pending ones.
- **Game achievements.** Evaluated by condition type (`evaluate.ts`) against
  the player's facts; one sync can unlock several, and achievement-count
  milestones resolve in repeated passes without looping. Unlocked
  achievements are permanent even if a count later falls. Each awards XP
  once; notices are shown once (`notified_at`).
- **When evaluation runs:** account creation, sign-in, portfolio creation,
  profile edit, title choice, every Player Card / collection / notification
  read, and a sweep of all players every `PROGRESSION_SWEEP_HOURS` (default 6)
  for time-based achievements.
- **Configurable without a deploy:** XP reward, target, params, enabled flag
  (table `achievements`); thresholds; `progression_settings`
  (`backfill_history`, `founding_period`, `xp_system_started_at`).
  `migrate.js` inserts catalog rows that are missing and never overwrites, so
  database edits survive redeploys.

## Decided (Gal, 2026-10-24)

- Thresholds: **option B, "balanced"** (decided 2026-10-24): XP to reach
  level L = 25 × (L − 1)², so level 6 at 625 XP, level 11 at 2,500, level 51
  at 62,500 and level 100 at 245,025. Chosen over 15× (new titles on day one)
  and 40× (second titles after about a year). All 62 game achievements
  (5,300 XP) reach level 15; levels beyond that are left to professional
  achievements, competitions and daily login, whose XP rates should be set
  against this curve. Easing the curve later moves nobody down a level;
  tightening it would. It is data, set on production directly and marked
  provisional:
  `INSERT INTO level_thresholds (level, xp_required, is_provisional) SELECT l, 25 * (l - 1) * (l - 1), true FROM generate_series(2, 100) AS l;`
  The schema still ships the table empty, so a fresh database has no curve
  until this is run.
- Existing players: **history counts** (`backfill_history = true`). The
  switch exists: with it off, an account older than `xp_system_started_at`
  has its past recorded as unlocked with 0 XP and no notice.
- Founding Member: **every account created on or before 2026-12-31**
  (inclusive, no start date). It is a database setting, not code, so it is
  set on production directly:
  `UPDATE progression_settings SET value = '{"start": null, "end": "2026-12-31"}' WHERE key = 'founding_period';`
  The schema's default stays empty, so a fresh database gives Founding
  Member to nobody until its own period is set.

## Decided while building (flag if wrong)

- **The Introduction** = first name and bio both filled in: the parts of the
  profile a player can edit today.
- **Portfolio age** counts until today, or until the day a portfolio closed.
  No trading is required.
- **Rarity** follows the XP tiers (25 basic, 50 advanced, 100 rare, 150 epic);
  The Powerhouse and The Market Mogul are "exceptional".
- **Ready, Set, Invest!** shows the dependencies of its unmet prerequisites
  (usernames, follows), so it never looks reachable when it is not.
- Title names and title category names stay **English in both languages**, as
  the reference image shows them; the category taglines are translated.
  Hebrew calls a title **כינוי** (as in the image), so the card's "no
  nickname" text now says **שם משתמש** to avoid two meanings of כינוי.
- The Player Card's existing black-and-gold styling is kept; the new title,
  ceremony and collection pieces use the specs' navy palette.

## Blocked by systems that do not exist yet

Today 29 of the 62 can be earned (15 before following existed), worth at
most 1,750 XP in all. 27 wait for a system that does not exist yet; they are in the catalog and in
the collection, marked with what they wait for:

| Waits for | Achievements |
|---|---|
| Choosing a username | Make Your Mark (and so Ready, Set, Invest!) |
| Subscriptions and payments | Golden Ticket, The Private List, Members Only, From Fan to Insider, paying-subscriber milestones (8), Inner Circle Regular, The Annual Pass, Both Sides of the Market |
| Competitions | The Arena (9), The Full Experience |

The evaluators are written and tested with sample facts; when a system ships,
its loader fills the fact in `loadFacts` (service.ts) and those achievements
start working. Also unreachable today: High Five, The Portfolio Vault, The
Portfolio Baron and The Portfolio Empire (above the 3-portfolio limit), and
Hall of Fame (30 achievements) and The Grand Tour (all six other categories),
which need achievements from the blocked systems.

## Still open

- When the curve stops being provisional (`UPDATE level_thresholds SET is_provisional = false;`).
- XP values beyond the proposed ones; Daily Login amounts; professional
  achievements and medals; competition rewards.

## Following (2026-10-24)

Built after Part 5, with Gal's two decisions: **one click, no approval**, and
**counts public, lists only to the player**. Table `follows` (one row per
pair, no self-follow). Endpoints: `GET/PUT/DELETE /players/:id/follow` and
`GET /players/me/followers`, `GET /players/me/following`. A follow syncs both
players' progression, so First Connection, the five follow milestones, The
First Fan and the seven follower milestones now unlock; achievements stay when
someone unfollows, and following again grants nothing new. The Player Card's
follower count is real. The Follow button is on another player's portfolio
page; the lists open from the Followers figure on your own card. From Fan to
Insider now waits only for subscriptions, and Ready, Set, Invest! only for
usernames.

## Avatar gallery (2026-10-24)

The first part of spec 3.1's "platform avatar gallery". Gal approved the
style from a five-avatar study (flat illustrated portraits on a jewel-tone
ground inside a champagne-gold ring) and plans 25 in all. The first five:
businessperson, warrior, entrepreneur, investor, freelancer.

The artwork ships with the frontend as SVG; the database stores only the
chosen id, in `users.avatar_id` (null = the default picture, the nickname's
initial). `PATCH /players/me` accepts `avatar_id`, one of `AVATAR_IDS` in
`src/services/playerProfile.ts` or null; anything else is refused with
`INVALID_AVATAR`. The list lives in code rather than a CHECK so the gallery
can grow without a migration; ids are never renamed or removed once
offered. The player picks one in the Player Card's edit mode. Uploads
(`avatar_url`) and special platform images are still not built.
