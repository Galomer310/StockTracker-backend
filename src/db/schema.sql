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
-- occurred_at is when the trade happened (a manual entry can be backdated);
-- created_at is when the note was written. Showing both keeps a backdated
-- entry honest.
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
