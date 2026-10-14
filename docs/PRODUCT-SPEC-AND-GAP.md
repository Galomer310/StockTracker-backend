# Investments — Product Spec & Gap Analysis

Spec first captured 2026-08-28 (truncated). Full spec received 2026-10-14 and
recorded below in place of the truncated copy. Gap analysis revised the same
day against the code on `main` plus the trade-integrity branches
(`api-sell-at-market-price`, `ui-sell-at-market-price`).

Parked for future work; not being implemented yet. Part 2 lists the rulings
and the market-data decision needed before most of it can start.

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
3. **Paid subscriptions — still open.** The spec says "paid subscribers" but
   defines no price, billing, refunds, or what a follower gets versus a
   subscriber. Stripe, webhooks and entitlement checks on every gated route
   remain a separately scoped commercial and legal piece.

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
   ages are weighted.
9. **Portfolio status and labels.** What Active / Closed / Archived each
   allow; whether Risk Level on the card is the Risk Score classification;
   whether Category / Style is player-chosen or derived.
10. **Permissions.** View Portfolios is subscriber-only, yet Module 2 defines
    what non-subscribers see — where do they see it (the feed)? What does
    following grant? Who sees follow-up notes?

## Clashes with the current code

- **Leaderboard.** Central to the current product; not mentioned in the spec.
  Keep alongside competitions, or retire?
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
3. Leaderboard and the 60-second undo (see "Clashes").
4. Market data and security master provider for phase 0.
