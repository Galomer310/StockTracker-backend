// Seeds demo accounts and holdings so the leaderboard and compare views have
// something to show. Idempotent.
//
//   node src/db/seedDemo.js          apply
//   node src/db/seedDemo.js --undo   remove every demo account and its holdings
//
// Demo accounts all use @demo.investments emails, so removal is exact and
// cannot touch a real account.
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const DEMO_DOMAIN = "@demo.investments";
const DEMO_PASSWORD = "Demo1234$";

// Cached prices the valuation query reads from.
const PRICES = { AAPL: 232.5, TSLA: 402.1, MSFT: 511.4, NVDA: 187.9, KO: 71.2 };

const USERS = [
  {
    email: "maya" + DEMO_DOMAIN,
    name: "Maya Levi",
    holdings: [
      ["AAPL", 150.0, 20, "2024-02-11"],
      ["NVDA", 62.4, 40, "2024-03-04"],
      ["MSFT", 402.0, 5, "2024-09-19"],
    ],
  },
  {
    email: "daniel" + DEMO_DOMAIN,
    name: "Daniel Cohen",
    holdings: [
      ["TSLA", 244.8, 12, "2024-05-22"],
      ["KO", 60.15, 60, "2024-06-30"],
    ],
  },
  {
    email: "noa" + DEMO_DOMAIN,
    name: "Noa Friedman",
    holdings: [
      ["MSFT", 330.25, 14, "2023-11-08"],
      ["AAPL", 189.6, 25, "2024-07-02"],
      ["TSLA", 410.0, 6, "2025-01-15"],
      ["NVDA", 140.75, 18, "2025-03-27"],
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
      // watchlist rows go with them via ON DELETE CASCADE
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

      // Replace holdings so re-running does not duplicate them.
      await pool.query("DELETE FROM watchlist WHERE user_id = $1", [userId]);
      for (const [symbol, price, qty, date] of u.holdings) {
        await pool.query(
          `INSERT INTO watchlist (user_id, stock_symbol, price_at_time, quantity, added_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, symbol, price, qty, date]
        );
      }
      console.log(`  ${u.name.padEnd(16)} id=${userId}  ${u.holdings.length} holdings`);
    }

    console.log(`\ndemo login password: ${DEMO_PASSWORD}`);
  } catch (err) {
    console.error("SEED ERROR:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
