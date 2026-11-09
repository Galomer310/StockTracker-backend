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

-- ---------------------------------------------------------------------------
-- Player Card (docs/PRODUCT-SPEC-AND-GAP.md, Parts 3-4)
-- ---------------------------------------------------------------------------

-- Player identity. All four start empty and the player fills them in from
-- the Player Card. The nickname is the player's username; its rules are in
-- src/services/nickname.ts and its uniqueness index is further down. The bio
-- limit is the spec's own.
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio        TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- The avatar chosen from the built-in gallery: an id such as 'warrior',
-- whose artwork ships with the frontend. Null means the default picture.
-- The allowed ids are AVATAR_IDS in src/services/playerProfile.ts, not a
-- CHECK, so the gallery can grow without a migration.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_id TEXT;

-- Usernames (src/services/nickname.ts). Unique without regard to case, so
-- "Gal" and "gal" cannot both exist; the name is stored as typed. The index
-- is on lower(nickname), which for the allowed characters (English and
-- Hebrew letters, digits, "_", ".") matches the server's nicknameKey().
-- Players who have not chosen one are null, and nulls never collide.
-- nickname_changed_at is when it was last set: one change every 30 days.
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname_changed_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS users_nickname_lower_key ON users (lower(nickname));

-- A username given up is held for its previous owner for 30 days, so nobody
-- else can take it straight away and pose as them. One row per name (its
-- lower-cased key); giving it up again later just moves released_at.
CREATE TABLE IF NOT EXISTS nickname_holds (
  nickname_key  TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  released_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Portfolio status. Active or closed only: "archived" is named in the spec but
-- not defined. Every existing portfolio is active, and there is no way to
-- close one yet, because what closing does to open positions is not decided.
-- closed_at is set exactly when the status is closed.
ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS status    TEXT NOT NULL DEFAULT 'active';
ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_bio_length') THEN
    ALTER TABLE users ADD CONSTRAINT users_bio_length CHECK (char_length(bio) <= 100);
  END IF;

  -- Not a spec limit: the spec gives the first name none. A placeholder cap,
  -- matching FIRST_NAME_MAX_LENGTH in src/services/playerProfile.ts.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_first_name_length') THEN
    ALTER TABLE users ADD CONSTRAINT users_first_name_length CHECK (char_length(first_name) <= 50);
  END IF;

  -- NICKNAME_MIN_LENGTH / NICKNAME_MAX_LENGTH in src/services/nickname.ts.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_nickname_length') THEN
    ALTER TABLE users ADD CONSTRAINT users_nickname_length CHECK (char_length(nickname) BETWEEN 3 AND 20);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portfolios_status_valid') THEN
    ALTER TABLE portfolios ADD CONSTRAINT portfolios_status_valid CHECK (status IN ('active', 'closed'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portfolios_closed_at_matches') THEN
    ALTER TABLE portfolios ADD CONSTRAINT portfolios_closed_at_matches
      CHECK ((status = 'closed') = (closed_at IS NOT NULL));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- XP, levels, player titles and game achievements
-- (docs/PRODUCT-SPEC-AND-GAP.md, Parts 5 and 6)
-- ---------------------------------------------------------------------------
--
-- Catalogs (titles, achievement categories, achievements) are seeded by
-- migrate.js from src/progression/catalog.json. It inserts missing rows and
-- never overwrites, so after the first deploy the database is the authority:
-- an XP reward, a target or an enabled flag changed here takes effect without
-- a code change. Ownership and selection are per player and separate from the
-- catalog, which is never copied per player.

-- XP needed to REACH each level. Level 1 needs nothing and has no row. The
-- final thresholds are not decided, so this ships EMPTY: everyone is level 1
-- until it is filled. A gap stops progression at the last configured level,
-- so a partly filled table can never skip levels.
CREATE TABLE IF NOT EXISTS level_thresholds (
  level        INTEGER PRIMARY KEY CHECK (level BETWEEN 2 AND 100),
  xp_required  INTEGER NOT NULL CHECK (xp_required > 0),
  is_provisional BOOLEAN NOT NULL DEFAULT TRUE
);

-- Small switches the product decides, editable without a deploy. Known keys:
--   backfill_history  true | false   count what existing players did before
--                                    the XP system existed (default true)
--   founding_period   {"start": ISO date | null, "end": ISO date | null}
--                                    accounts created inside it are Founding
--                                    Members; no end date means nobody is yet
--   xp_system_started_at  ISO timestamp  set once, on the first migration;
--                                    with backfill off, accounts older than
--                                    this earn no XP for what they had done
CREATE TABLE IF NOT EXISTS progression_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO progression_settings (key, value) VALUES
  ('backfill_history', 'true'),
  ('founding_period', '{"start": null, "end": null}'),
  ('xp_system_started_at', to_jsonb(NOW()))
ON CONFLICT (key) DO NOTHING;

-- Every title a player can hold. Level titles come in tiers of three, one per
-- category, and unlock at level 5 * (tier - 1) + 1. Special and store titles
-- (future) use the same table with required_level and tier left empty.
CREATE TABLE IF NOT EXISTS titles (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  category         TEXT NOT NULL,
  source_type      TEXT NOT NULL CHECK (source_type IN ('level', 'special', 'store')),
  required_level   INTEGER CHECK (required_level BETWEEN 1 AND 100),
  tier             INTEGER CHECK (tier BETWEEN 1 AND 20),
  icon             TEXT NOT NULL,
  accent_color     TEXT NOT NULL,
  sort_order       INTEGER NOT NULL,
  rarity           TEXT,
  unlock_condition JSONB,
  is_purchasable   BOOLEAN NOT NULL DEFAULT FALSE,
  price_cents      INTEGER CHECK (price_cents >= 0),
  is_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK ((source_type = 'level') = (tier IS NOT NULL AND required_level IS NOT NULL))
);

-- Achievement categories and the achievements themselves.
CREATE TABLE IF NOT EXISTS achievement_categories (
  id           TEXT PRIMARY KEY,
  name_en      TEXT NOT NULL,
  name_he      TEXT NOT NULL,
  icon         TEXT NOT NULL,
  accent_color TEXT NOT NULL,
  sort_order   INTEGER NOT NULL
);

-- condition_type names an evaluator in src/progression/evaluate.ts; the
-- target and params are data, so a threshold can change without a deploy.
CREATE TABLE IF NOT EXISTS achievements (
  id                TEXT PRIMARY KEY,
  category_id       TEXT NOT NULL REFERENCES achievement_categories(id),
  title_en          TEXT NOT NULL,
  title_he          TEXT NOT NULL,
  description_en    TEXT NOT NULL,
  description_he    TEXT NOT NULL,
  condition_type    TEXT NOT NULL,
  target_value      INTEGER,
  condition_params  JSONB NOT NULL DEFAULT '{}',
  prerequisite_ids  TEXT[] NOT NULL DEFAULT '{}',
  xp_reward         INTEGER NOT NULL CHECK (xp_reward >= 0),
  rarity            TEXT NOT NULL,
  icon              TEXT,                 -- null: the category's icon
  is_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order        INTEGER NOT NULL
);

-- The XP ledger. Every grant from every source is one row, and the
-- idempotency key is what makes a grant happen once: replaying an event
-- inserts nothing. A player's total is the sum of their rows.
CREATE TABLE IF NOT EXISTS xp_transactions (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type      TEXT NOT NULL,         -- 'game_achievement' today; later 'professional_achievement', 'competition', 'daily_login', ...
  source_id        TEXT NOT NULL,
  xp_amount        INTEGER NOT NULL,
  awarded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key  TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_xp_transactions_user ON xp_transactions(user_id);

-- Per-player progression: the cached total and level (both recomputed from
-- the ledger and the thresholds on every sync), the active title, and when
-- the player first chose one.
CREATE TABLE IF NOT EXISTS player_progression (
  user_id                  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_xp                 INTEGER NOT NULL DEFAULT 0,
  level                    INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 100),
  active_title_id          TEXT REFERENCES titles(id),
  first_title_selected_at  TIMESTAMPTZ,
  initialized_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Titles a player owns. Never deleted by choosing another title.
CREATE TABLE IF NOT EXISTS player_titles (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id     TEXT NOT NULL REFERENCES titles(id),
  unlocked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source       TEXT NOT NULL,             -- 'level' today; later 'special', 'store'
  PRIMARY KEY (user_id, title_id)
);

-- One unlock ceremony per title tier reached. acknowledged_at is set when the
-- player chooses a title or keeps their current one, so a ceremony is shown
-- once and survives a refresh until then.
CREATE TABLE IF NOT EXISTS title_ceremonies (
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier             INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 20),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at  TIMESTAMPTZ,
  PRIMARY KEY (user_id, tier)
);

-- Achievements a player has unlocked. notified_at is set once the player has
-- seen the unlock notice, so it appears once and survives a refresh.
CREATE TABLE IF NOT EXISTS player_achievements (
  user_id                INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id         TEXT NOT NULL REFERENCES achievements(id),
  unlocked_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  xp_awarded             INTEGER NOT NULL,
  reward_transaction_id  INTEGER REFERENCES xp_transactions(id) ON DELETE SET NULL,
  notified_at            TIMESTAMPTZ,
  PRIMARY KEY (user_id, achievement_id)
);

-- ---------------------------------------------------------------------------
-- Following (decided 2026-10-24)
-- ---------------------------------------------------------------------------
--
-- Free and one-click: no approval, no holdings revealed. One row per
-- follower/followee pair, so following twice is one follow, and a player can
-- never follow themselves. Counts are public; the lists are shown only to
-- the player they belong to (src/controllers/followController.ts).
CREATE TABLE IF NOT EXISTS follows (
  follower_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Daily rewards: login streaks, daily XP and capital growth (2026-11-09)
-- ---------------------------------------------------------------------------
-- Rules in src/rewards/schedule.ts; the database side in src/rewards/service.ts.

-- What a portfolio's return is measured against. Null until its first
-- capital growth reward, which means "the starting_balance it opened with";
-- every valuation reads COALESCE(capital_base, starting_balance). A reward
-- adds cash and grows this base by the same factor, so the return is
-- unchanged and added capital never counts as profit. starting_balance stays
-- the original $10,000 for the record.
ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS capital_base NUMERIC(14,4);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portfolios_capital_base_positive') THEN
    ALTER TABLE portfolios ADD CONSTRAINT portfolios_capital_base_positive CHECK (capital_base IS NULL OR capital_base > 0);
  END IF;
END $$;

-- The amounts, as configuration. Edit these rows to change the economy.
INSERT INTO progression_settings (key, value) VALUES
  ('rewards_timezone', '"Asia/Jerusalem"'),
  ('daily_login_xp', '{"base": 50, "milestones": [{"every": 7, "xp": 75}, {"every": 30, "xp": 150}, {"every": 150, "xp": 250}]}'),
  ('capital_growth', '{"milestones": [{"every": 7, "pct": 1, "tier": "weekly"}, {"every": 30, "pct": 3, "tier": "monthly"}, {"every": 90, "pct": 5, "tier": "quarterly"}]}')
ON CONFLICT (key) DO NOTHING;

-- One row per player: the streak as of their last counted login date.
CREATE TABLE IF NOT EXISTS daily_login_state (
  user_id           INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_streak    INTEGER NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  last_login_date   DATE,
  total_login_days  INTEGER NOT NULL DEFAULT 0 CHECK (total_login_days >= 0),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every counted login date: its streak day and the XP it paid (the XP itself
-- is in xp_transactions as source_type 'daily_login', key
-- daily_login:<user>:<date>). The primary key makes a date count once.
-- seen_at: when the player saw that day's reward notice.
CREATE TABLE IF NOT EXISTS daily_logins (
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  login_date         DATE NOT NULL,
  streak_day         INTEGER NOT NULL CHECK (streak_day >= 1),
  xp_amount          INTEGER NOT NULL,
  xp_transaction_id  INTEGER REFERENCES xp_transactions(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seen_at            TIMESTAMPTZ,
  PRIMARY KEY (user_id, login_date)
);

-- The motivational messages (src/rewards/messages.json, seeded insert-only).
CREATE TABLE IF NOT EXISTS capital_messages (
  id          TEXT PRIMARY KEY,
  text_en     TEXT NOT NULL,
  text_he     TEXT NOT NULL,
  is_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- Capital growth rewards. One per player per login date at most. The
-- percentage is fixed when earned; the money is worked out when redeemed,
-- into one portfolio the player picks. Never expires.
CREATE TABLE IF NOT EXISTS capital_rewards (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  login_date       DATE NOT NULL,
  streak_day       INTEGER NOT NULL,
  percentage       NUMERIC(6,3) NOT NULL CHECK (percentage > 0),
  tier             TEXT NOT NULL,
  earned_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'redeemed')),
  message_id       TEXT REFERENCES capital_messages(id),
  message_cycle    INTEGER,
  portfolio_id     INTEGER REFERENCES portfolios(id) ON DELETE SET NULL,
  redeemed_at      TIMESTAMPTZ,
  value_before     NUMERIC(14,4),
  value_after      NUMERIC(14,4),
  base_before      NUMERIC(14,4),
  base_after       NUMERIC(14,4),
  capital_added    NUMERIC(14,4),
  UNIQUE (user_id, login_date)
);
CREATE INDEX IF NOT EXISTS idx_capital_rewards_user ON capital_rewards(user_id, earned_at);

-- The portfolio's own audit trail: every capital adjustment, separate from
-- trades. One per redeemed reward.
CREATE TABLE IF NOT EXISTS capital_adjustments (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  portfolio_id       INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  reward_id          INTEGER NOT NULL UNIQUE REFERENCES capital_rewards(id) ON DELETE CASCADE,
  adjustment_type    TEXT NOT NULL DEFAULT 'capital_boost',
  percentage         NUMERIC(6,3) NOT NULL,
  valued_at          TIMESTAMPTZ NOT NULL,
  prices_as_of       TIMESTAMPTZ,
  cash_before        NUMERIC(14,4) NOT NULL,
  cash_after         NUMERIC(14,4) NOT NULL,
  value_before       NUMERIC(14,4) NOT NULL,
  value_after        NUMERIC(14,4) NOT NULL,
  base_before        NUMERIC(14,4) NOT NULL,
  base_after         NUMERIC(14,4) NOT NULL,
  applied_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_capital_adjustments_portfolio ON capital_adjustments(portfolio_id, applied_at);

-- ---------------------------------------------------------------------------
-- Portfolio history and market data (professional achievements, stage 1)
-- ---------------------------------------------------------------------------
-- How it is built: src/performance/history.ts; filled by src/performance/service.ts.

-- The benchmark for Beat the Market. Decided by Gal 2026-11-09: the SPY fund
-- stands in for the S&P 500 (index data is not on the current Massive plan),
-- price return, provisional. Change the symbol here to switch, e.g. to I:SPX
-- on an indices plan.
INSERT INTO progression_settings (key, value) VALUES
  ('benchmark', '{"symbol": "SPY", "name": "S&P 500", "source": "etf_proxy", "return_type": "price", "provisional": true}')
ON CONFLICT (key) DO NOTHING;

-- Daily closes, kept for good rather than in memory. Unadjusted for splits,
-- like the holdings they value. One row per symbol per US trading date.
CREATE TABLE IF NOT EXISTS daily_prices (
  symbol  TEXT NOT NULL,
  date    DATE NOT NULL,
  close   NUMERIC(14,4) NOT NULL CHECK (close > 0),
  PRIMARY KEY (symbol, date)
);

-- How far each symbol's closes are known to be complete: every session up
-- to checked_through is in daily_prices (or there was none). A day after it
-- is not final yet.
CREATE TABLE IF NOT EXISTS price_coverage (
  symbol           TEXT PRIMARY KEY,
  checked_through  DATE NOT NULL,
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error       TEXT
);

-- Each portfolio's value on every calendar date since it opened, rebuilt
-- from its trades, capital rewards and closes. perf_index is the genuine
-- performance (1 at opening, capital rewards stripped out); null once the
-- value is not positive. estimated: a holding was valued at a trade price
-- because it had no close yet.
CREATE TABLE IF NOT EXISTS portfolio_daily_values (
  portfolio_id     INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  cash             NUMERIC(16,4) NOT NULL,
  positions_value  NUMERIC(16,4) NOT NULL,
  nav              NUMERIC(16,4) NOT NULL,
  external_flow    NUMERIC(14,4) NOT NULL DEFAULT 0,
  perf_index       NUMERIC(24,12),
  estimated        BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (portfolio_id, date)
);

-- Per portfolio: whether the rebuilt record ends where the live portfolio
-- is (if not, nothing is awarded from it, and reason says why), and the
-- last date whose value is final.
CREATE TABLE IF NOT EXISTS portfolio_history_status (
  portfolio_id   INTEGER PRIMARY KEY REFERENCES portfolios(id) ON DELETE CASCADE,
  consistent     BOOLEAN NOT NULL,
  reason         TEXT,
  final_through  DATE,
  rebuilt_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
