-- StockTrack / Investments schema.
--
-- Reconstructed from the columns the controllers query, since the database had
-- no tables. Safe to re-run: every statement is IF NOT EXISTS.

-- Accounts.
--   display_name and created_at exist for the leaderboard: it shows an account
--   name, and measures performance "from the moment the account was opened".
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password      TEXT NOT NULL,            -- bcrypt hash, never plaintext
  display_name  TEXT,                     -- falls back to the email local-part when null
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Portfolios.
--
-- A user holds up to MAX_PORTFOLIOS of these (3 today, more on paid tiers
-- later), and every holding and every trade belongs to exactly one.
--
-- Each starts with a fixed amount of cash. That is what makes the numbers on
-- this site mean anything: a position can only be opened with money the
-- portfolio actually has, so "23% of the book in NVDA" is a real weight rather
-- than an artefact of someone typing in an unlimited number of shares.
--
--   starting_balance  what the portfolio opened with. Never changes, so it is
--                     the honest denominator for return: a portfolio cannot
--                     improve its percentage by having more paid in.
--   cash              what is left to deploy. Falls on every buy, rises on
--                     every sale, and is never allowed below zero.
--
-- Equity is cash + the market value of the open positions; return is measured
-- against starting_balance.
CREATE TABLE IF NOT EXISTS portfolios (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  starting_balance  NUMERIC(14,4) NOT NULL,
  cash              NUMERIC(14,4) NOT NULL CHECK (cash >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Two portfolios called "Growth" under one account would be indistinguishable
  -- in the switcher and on the leaderboard.
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_portfolios_user ON portfolios(user_id);

-- Cache of the most recent close per symbol, refreshed at most every 24h.
-- stock_symbol is the primary key so the controllers' ON CONFLICT upsert works.
CREATE TABLE IF NOT EXISTS stocks (
  stock_symbol  TEXT PRIMARY KEY,
  last_price    NUMERIC(14,4) NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Holdings. Despite the name this stores owned positions: a price paid and a
-- quantity. One row per purchase, so the same symbol can appear several times.
CREATE TABLE IF NOT EXISTS watchlist (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stock_symbol  TEXT NOT NULL,
  price_at_time NUMERIC(14,4) NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 1,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  industry      TEXT
);

CREATE INDEX IF NOT EXISTS idx_watchlist_user_id ON watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_symbol  ON watchlist(stock_symbol);

-- Trade journal.
--
-- One row per recorded buy or sell, with the owner's thesis. Separate from
-- `watchlist` because that table holds only CURRENT positions: when a holding
-- is sold its row shrinks or disappears, but the trade and its reasoning must
-- survive for other users to read.
--
-- occurred_at is when the trade happened; created_at is when the note was
-- written. New trades set both to now, but manual entries - no longer
-- accepted - could be backdated, and showing both keeps those rows honest.
CREATE TABLE IF NOT EXISTS trade_notes (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stock_symbol  TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('buy', 'sell')),
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  price         NUMERIC(14,4) NOT NULL,
  note          TEXT NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_notes_user   ON trade_notes(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_notes_symbol ON trade_notes(stock_symbol);

-- ---------------------------------------------------------------------------
-- Trade integrity
-- ---------------------------------------------------------------------------

-- Links a holding to the buy entry that created it, so a correction or a
-- removal can keep the journal and the position in step instead of letting
-- them drift apart.
ALTER TABLE watchlist
  ADD COLUMN IF NOT EXISTS trade_note_id INTEGER REFERENCES trade_notes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_watchlist_trade_note ON watchlist(trade_note_id);

-- Which portfolio each holding and each trade belongs to.
--
-- Added as nullable so this file stays re-runnable, then tightened to NOT NULL
-- by the migration once every row has an owner. Deleting a portfolio takes its
-- positions and its history with it.
ALTER TABLE watchlist
  ADD COLUMN IF NOT EXISTS portfolio_id INTEGER REFERENCES portfolios(id) ON DELETE CASCADE;
ALTER TABLE trade_notes
  ADD COLUMN IF NOT EXISTS portfolio_id INTEGER REFERENCES portfolios(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_watchlist_portfolio  ON watchlist(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_trade_notes_portfolio ON trade_notes(portfolio_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- The feed
-- ---------------------------------------------------------------------------
--
-- There is deliberately no `feed_posts` table. A post IS a trade: the feed is
-- built by reading trade_notes directly, so a buy or a sell appears the moment
-- it is recorded and can never drift out of step with the journal. Copying
-- each trade into a second table would create exactly that drift, and would
-- also leave orphaned posts behind when a mistyped trade is removed.
--
-- Both tables below therefore hang off trade_notes(id), and cascade: removing
-- a mistyped trade inside its 60 second window takes its post, its reactions
-- and its replies with it.

-- One reaction per person per post. The UNIQUE constraint is what makes
-- reacting idempotent - changing your mind updates the row rather than
-- stacking a second vote, and reacting the same way twice clears it.
CREATE TABLE IF NOT EXISTS feed_reactions (
  id            SERIAL PRIMARY KEY,
  trade_note_id INTEGER NOT NULL REFERENCES trade_notes(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction      TEXT NOT NULL,            -- 'like', 'dislike', or one emoji from the allowlist
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trade_note_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_feed_reactions_post ON feed_reactions(trade_note_id);

-- Replies to a post.
CREATE TABLE IF NOT EXISTS feed_comments (
  id            SERIAL PRIMARY KEY,
  trade_note_id INTEGER NOT NULL REFERENCES trade_notes(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feed_comments_post ON feed_comments(trade_note_id, created_at);

-- Value constraints. These were missing, which allowed a negative quantity and
-- a rewritten cost basis to be stored. Added as named constraints so this file
-- stays re-runnable against an existing database.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'watchlist_quantity_positive') THEN
    ALTER TABLE watchlist ADD CONSTRAINT watchlist_quantity_positive CHECK (quantity > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'watchlist_price_positive') THEN
    ALTER TABLE watchlist ADD CONSTRAINT watchlist_price_positive CHECK (price_at_time > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trade_notes_price_positive') THEN
    ALTER TABLE trade_notes ADD CONSTRAINT trade_notes_price_positive CHECK (price > 0);
  END IF;
END $$;
