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
