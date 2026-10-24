# Investments — backend

The API behind **Investments** (formerly StockTrack): a social investing game
where every player runs virtual model portfolios that start with $10,000,
trades at real quoted prices, explains each trade, and is ranked on a
leaderboard and seen in a shared feed.

The frontend lives in
[StockTrack-frontend](https://github.com/Galomer310/StockTrack-frontend).

---

## What it does

- **Accounts.** Registration and login with short-lived access tokens and
  refresh tokens. Passwords need at least 12 characters and are checked
  against common passwords; login answers the same way whether or not the
  email exists.
- **Portfolios.** Up to three per account, each opening with $10,000 of
  virtual cash. Cash can never go negative, so every position is a real share
  of a real book.
- **Trades at market prices.** Buys and sells execute at the server's own
  quote; any price a client sends is ignored, and manual entry of a past trade
  is refused. A buy can be taken back within 60 seconds; after that the only
  way out is a sale.
- **Trade journal.** Every buy and sell carries the player's reasoning, kept
  even after the position is closed.
- **Leaderboard and public portfolios.** Ranked by percentage return against
  the starting $10,000. Other players see percentages only, never money.
- **Feed.** Every trade by every player, with reactions and replies.
- **Market data.** A proxy in front of Massive (formerly Polygon.io), with
  caching and a per-minute request budget shared across the server. On the
  free plan prices are end of day, so trades execute at the latest close.
- **Metric engine** (`src/metrics/`). Pure, versioned calculation functions
  for the product spec's metrics: returns that exclude game-earned capital,
  volatility, drawdown, concentration, risk score, exposures, benchmarks and
  the Player Card figures. Unit-tested; not yet wired to every screen.
- **Player Card.** One endpoint with the player's identity, portfolio counts
  and returns, and the locks the spec sets. Level and XP are withheld until
  their rules are defined.

The product spec, the gap between it and this code, and the decisions taken
so far are in [`docs/PRODUCT-SPEC-AND-GAP.md`](docs/PRODUCT-SPEC-AND-GAP.md).

## Tech stack

- Node.js 22, Express 4, TypeScript
- PostgreSQL (hosted on Neon)
- JWT authentication, bcrypt password hashing
- Massive for market data (US stocks only)
- helmet, CORS allowlist, per-route rate limiting
- Vitest for tests

## Getting started

Prerequisites: Node.js 22 and a PostgreSQL database.

```bash
npm install
```

Create a `.env` file:

```env
DATABASE_URL=postgres://user:password@host/dbname
JWT_SECRET=at-least-32-random-characters
REFRESH_SECRET=a-different-value-of-at-least-32-characters
MASSIVE_API_KEY=your-key
```

The server refuses to start without `DATABASE_URL`, `JWT_SECRET` and
`REFRESH_SECRET`, if either secret is shorter than 32 characters, or if the
two are the same.

Create or update the tables (safe to re-run), then start the server:

```bash
node src/db/migrate.js
npm run dev
```

It listens on `http://localhost:3000`.

The database connection always requests SSL, as Neon requires. For a local
Postgres without SSL, add `?sslmode=disable` to `DATABASE_URL`.

### Optional settings

| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on (default 3000). |
| `NODE_ENV` | `production` in deployment. `development` adds error detail to responses; anything else keeps it out. |
| `CORS_ORIGINS` | Comma-separated origins allowed to call the API. Defaults to the local Vite dev server; set it to the frontend's domain in deployment. |
| `TRUST_PROXY` | Number of proxies in front of the server (usually `1` on Render), so rate limits see real client addresses. Leave unset without a proxy. |
| `MASSIVE_REQUESTS_PER_MINUTE` | Request budget per rolling minute (default 5, the free plan). |
| `MASSIVE_MAX_WAIT_MS` | Longest a request waits for a free slot before failing, so a cached copy can be served instead (default 15000). |
| `MASSIVE_INTRADAY` | `true` on a paid plan, to enable intraday bars. |
| `PROGRESSION_SWEEP_HOURS` | How often every player is re-evaluated for achievements that fall due with time, such as portfolio age (default 6; `0` turns the sweep off). |

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run with automatic restart (nodemon + ts-node). |
| `npm run build` | Compile to `dist/`. |
| `npm start` | Run the compiled build. |
| `npm test` | Type-check the tests, then run them with Vitest. |
| `node src/db/migrate.js` | Apply `src/db/schema.sql` and seed the title and achievement catalogs from `src/progression/catalog.json` (new rows only). Idempotent. |
| `node src/db/seedDemo.js` | Add demo accounts and portfolios; `--undo` removes them. |

`src/db/resetForPortfolios.js` is a one-time, destructive migration that was
used to move to the portfolio model. Read its header before running it.

## API

Every route except `/auth` needs an `Authorization: Bearer <access token>`
header. Routes acting on a portfolio read it from an `X-Portfolio-Id` header.

### Authentication — `/auth`

| Method | Path | |
|---|---|---|
| POST | `/auth/register` | Create an account. |
| POST | `/auth/login` | Sign in; returns access and refresh tokens. |
| POST | `/auth/refresh` | Exchange a refresh token for a new access token. |

### Portfolios — `/portfolios`

| Method | Path | |
|---|---|---|
| GET | `/portfolios` | Your portfolios, valued, with cash. |
| POST | `/portfolios` | Open a new portfolio, up to the account's limit. |

### Holdings and trades — `/watchlist`

| Method | Path | |
|---|---|---|
| GET | `/watchlist` | Holdings and cash in the open portfolio. |
| POST | `/watchlist` | Buy at the market price, with a required note. |
| POST | `/watchlist/:id/sell` | Sell all or part of a holding at the market price, with a note. |
| DELETE | `/watchlist/:id` | Take back a buy within 60 seconds of making it. |

### Social — `/social`

| Method | Path | |
|---|---|---|
| GET | `/social/leaderboard` | Every portfolio ranked by percentage return. |
| GET | `/social/portfolios/:id` | One portfolio; percentages only unless it is yours. |
| GET | `/social/portfolios/:id/journal` | A portfolio's trades and their reasoning. |

### Feed — `/feed`

| Method | Path | |
|---|---|---|
| GET | `/feed` | Everyone's trades, newest first. |
| POST | `/feed/:id/reactions` | React to a post. |
| POST | `/feed/:id/comments` | Reply to a post. |
| DELETE | `/feed/comments/:commentId` | Delete your reply. |

### Players — `/players`

| Method | Path | |
|---|---|---|
| GET | `/players/me/card` | Your Player Card. Every figure is calculated on the server; figures without data or rules yet come back as locked or unavailable, with the reason. |
| PATCH | `/players/me` | Change your bio (at most 100 characters) and first name (at most 50). The nickname and picture cannot be changed yet. |
| GET | `/players/me/titles` | Your title collection: every level title, marked unlocked or locked, and the active one. |
| PUT | `/players/me/title` | Make an unlocked title the active one. A locked title is refused (403 `TITLE_NOT_OWNED`). |
| GET | `/players/me/achievements` | All game achievements with your state and progress for each, and per-category counts. |
| GET | `/players/me/progression/notifications` | Unlock notices you have not seen, and the pending title ceremony if a new tier was reached. |
| POST | `/players/me/progression/acknowledge` | Mark notices as seen and close the ceremony, so neither returns after a refresh. |

XP, levels, titles and achievements live in `src/progression`. XP per level is
not decided yet: the `level_thresholds` table ships empty, so every player is
level 1 until it is filled. XP rewards, targets and switches
(`progression_settings`) are database rows, changeable without a deploy. See
Part 5 of `docs/PRODUCT-SPEC-AND-GAP.md`.

### Market data — `/stocks`

| Method | Path | |
|---|---|---|
| GET | `/stocks/market-status` | Whether US markets are open. |
| GET | `/stocks/quota` | Remaining market data budget for today. |
| GET | `/stocks/search` | Symbol search. |
| GET | `/stocks/:ticker` | Latest close, cached for 24 hours. |
| GET | `/stocks/:ticker/quote` | Full quote. |
| GET | `/stocks/:ticker/details` | Company fundamentals: sector, industry, market cap. |
| GET | `/stocks/:ticker/news` | Recent news. |
| GET | `/stocks/:ticker/aggregates` | Daily price history (`?days=30`). |

## Project structure

```
src/
  server.ts         app setup, security headers, CORS, route mounting
  config/           database pool, CORS, portfolio rules
  routes/           one router per area above
  controllers/      request handlers
  middleware/       authentication, rate limits, error handling
  services/         Massive client, market clock
  metrics/          the metric engine and its tests
  progression/      XP ledger, levels, titles, game achievements, catalog
  db/               schema.sql, migration, seed and reset scripts
docs/               product spec and gap analysis
```

## Deployment

Prepared for Render: `npm ci && npm run build`, then `npm start`. Set
`NODE_ENV=production`, `CORS_ORIGINS` to the frontend's address,
`TRUST_PROXY=1`, and the required secrets. Run `node src/db/migrate.js`
against the production database after any schema change.

## Contact

For questions or feedback: [galomer6708@gmail.com](mailto:galomer6708@gmail.com)
