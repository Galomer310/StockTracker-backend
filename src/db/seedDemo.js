// Seeds demo accounts, portfolios and holdings so the leaderboard, feed and
// compare views have something to show. Idempotent.
//
//   node src/db/seedDemo.js          apply
//   node src/db/seedDemo.js --undo   remove every demo account and its data
//
// Demo accounts all use @demo.investments emails, so removal is exact and
// cannot touch a real account.
//
// Every demo portfolio obeys the same rule as a real one: it opens with
// STARTING_CASH and its holdings are paid for out of that, so the seeded books
// are all under $10,000 and their cash balances are what is actually left.
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const DEMO_DOMAIN = "@demo.investments";
const DEMO_PASSWORD = "Demo1234$";

// Kept in step with src/config/portfolio.ts by hand: this script is plain
// JavaScript and cannot import the TypeScript.
const STARTING_CASH = 10000;

// Cached prices the valuation query reads from.
const PRICES = { AAPL: 232.5, TSLA: 402.1, MSFT: 511.4, NVDA: 187.9, KO: 71.2 };

// [symbol, price paid, quantity, date, thesis]
const USERS = [
  {
    email: "maya" + DEMO_DOMAIN,
    name: "Maya Levi",
    portfolio: "Main",
    holdings: [
      ["AAPL", 150.0, 20, "2024-02-11", "Services revenue is the whole story now, and the market is still pricing this as a hardware company."],
      ["NVDA", 62.4, 40, "2024-03-04", "Every model being trained runs on their silicon. Buying the toll road, not the traffic."],
      ["MSFT", 402.0, 5, "2024-09-19", "Azure plus the OpenAI stake. Expensive, so keeping this one small."],
    ],
  },
  {
    email: "daniel" + DEMO_DOMAIN,
    name: "Daniel Cohen",
    portfolio: "Main",
    holdings: [
      ["TSLA", 244.8, 12, "2024-05-22", "Buying the energy storage business, which nobody seems to be valuing at all."],
      ["KO", 60.15, 60, "2024-06-30", "Boring on purpose. Somewhere to sit while I wait for better prices elsewhere."],
    ],
  },
  {
    email: "noa" + DEMO_DOMAIN,
    name: "Noa Friedman",
    portfolio: "Main",
    holdings: [
      ["MSFT", 330.25, 14, "2023-11-08", "The safest way I can think of to own AI without betting on which model wins."],
      ["AAPL", 189.6, 10, "2024-07-02", "Bought the dip after the iPhone launch disappointed. The installed base does not care."],
      ["TSLA", 410.0, 4, "2025-01-15", "Small position, high conviction, fully aware this is the speculative corner of the book."],
      ["NVDA", 140.75, 10, "2025-03-27", "Added on the correction. Thesis unchanged since the first purchase."],
    ],
  },
];

const undo = process.argv.includes("--undo");

(async () => {
  try {
    if (undo) {
      const r = await pool.query(
        "DELETE FROM users WHERE email LIKE $1 RETURNING email",
        ["%" + DEMO_DOMAIN]
      );
      // portfolios, holdings, trades and feed activity all go with them via
      // ON DELETE CASCADE
      console.log(`removed ${r.rowCount} demo account(s)`);
      return;
    }

    // Cached prices, so portfolios value at something other than cost.
    for (const [symbol, price] of Object.entries(PRICES)) {
      await pool.query(
        `INSERT INTO stocks (stock_symbol, last_price, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (stock_symbol)
         DO UPDATE SET last_price = $2, updated_at = NOW()`,
        [symbol, price]
      );
    }
    console.log(`cached ${Object.keys(PRICES).length} prices`);

    const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
    for (const u of USERS) {
      const res = await pool.query(
        `INSERT INTO users (email, password, display_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
         RETURNING id`,
        [u.email, hash, u.name]
      );
      const userId = res.rows[0].id;

      const cost = u.holdings.reduce((sum, [, price, qty]) => sum + price * qty, 0);
      if (cost > STARTING_CASH) {
        throw new Error(
          `${u.name}'s seeded holdings cost $${cost.toFixed(2)}, more than the ` +
            `$${STARTING_CASH} a portfolio opens with. Trim the list.`
        );
      }

      const portfolioRes = await pool.query(
        `INSERT INTO portfolios (user_id, name, starting_balance, cash)
         VALUES ($1, $2, $3, $3)
         ON CONFLICT (user_id, name) DO UPDATE SET starting_balance = $3
         RETURNING id`,
        [userId, u.portfolio, STARTING_CASH]
      );
      const portfolioId = portfolioRes.rows[0].id;

      // Replace holdings and history so re-running does not duplicate them.
      await pool.query("DELETE FROM watchlist WHERE portfolio_id = $1", [portfolioId]);
      await pool.query("DELETE FROM trade_notes WHERE portfolio_id = $1", [portfolioId]);

      for (const [symbol, price, qty, date, note] of u.holdings) {
        // The journal entry and the holding are written together, exactly as
        // the buy endpoint does it - so the feed and the trade log have real
        // content rather than positions that appeared from nowhere.
        const noteRow = await pool.query(
          `INSERT INTO trade_notes (user_id, portfolio_id, stock_symbol, action, quantity, price, note, occurred_at, created_at)
           VALUES ($1, $2, $3, 'buy', $4, $5, $6, $7, $7)
           RETURNING id`,
          [userId, portfolioId, symbol, qty, price, note, date]
        );
        await pool.query(
          `INSERT INTO watchlist (user_id, portfolio_id, stock_symbol, price_at_time, quantity, added_at, trade_note_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [userId, portfolioId, symbol, price, qty, date, noteRow.rows[0].id]
        );
      }

      // Whatever was not spent.
      await pool.query("UPDATE portfolios SET cash = $1 WHERE id = $2", [
        STARTING_CASH - cost,
        portfolioId,
      ]);

      console.log(
        `  ${u.name.padEnd(16)} id=${userId}  ${u.holdings.length} holdings  ` +
          `spent $${cost.toFixed(2)}  cash $${(STARTING_CASH - cost).toFixed(2)}`
      );
    }

    console.log(`\ndemo login password: ${DEMO_PASSWORD}`);
  } catch (err) {
    console.error("SEED ERROR:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
