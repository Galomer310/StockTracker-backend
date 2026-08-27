// Applies src/db/schema.sql against DATABASE_URL. Idempotent - safe to re-run.
//   node src/db/migrate.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    await pool.query(sql);
    console.log("schema applied");

    // Backfill: holdings created before the journal existed have no buy entry,
    // which would make them invisible to a leaderboard computed from trades.
    // Synthesise one per orphaned holding, labelled honestly as imported.
    const orphans = await pool.query(
      `SELECT id, user_id, portfolio_id, stock_symbol, price_at_time, quantity, added_at
       FROM watchlist WHERE trade_note_id IS NULL ORDER BY id`
    );
    for (const row of orphans.rows) {
      const note = await pool.query(
        `INSERT INTO trade_notes (user_id, portfolio_id, stock_symbol, action, quantity, price, note, occurred_at, created_at)
         VALUES ($1, $2, $3, 'buy', $4, $5, $6, $7, NOW())
         RETURNING id`,
        [
          row.user_id,
          row.portfolio_id,
          row.stock_symbol,
          row.quantity,
          row.price_at_time,
          "Imported from an existing holding. This position predates the trade journal, so no thesis was recorded at the time.",
          row.added_at,
        ]
      );
      await pool.query("UPDATE watchlist SET trade_note_id = $1 WHERE id = $2", [
        note.rows[0].id,
        row.id,
      ]);
    }
    if (orphans.rowCount > 0) {
      console.log(`backfilled ${orphans.rowCount} holding(s) with an imported buy entry`);
    }

    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' ORDER BY table_name`
    );
    for (const t of tables.rows) {
      const cols = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
        [t.table_name]
      );
      console.log(
        `  ${t.table_name}: ${cols.rows.map((c) => c.column_name).join(", ")}`
      );
    }
  } catch (err) {
    console.error("MIGRATION ERROR:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
