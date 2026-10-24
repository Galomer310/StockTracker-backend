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

    // Seed the title and achievement catalogs. Insert-only: a row already in
    // the database is left alone, so an XP value or enabled flag changed there
    // is not reset by the next deploy.
    const catalog = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "progression", "catalog.json"), "utf8")
    );
    let seeded = 0;
    for (const t of catalog.titles) {
      const r = await pool.query(
        `INSERT INTO titles (id, name, category, source_type, required_level, tier, icon, accent_color, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
        [t.id, t.name, t.category, t.source_type, t.required_level, t.tier, t.icon, t.accent_color, t.sort_order]
      );
      seeded += r.rowCount;
    }
    for (const c of catalog.achievement_categories) {
      const r = await pool.query(
        `INSERT INTO achievement_categories (id, name_en, name_he, icon, accent_color, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [c.id, c.name_en, c.name_he, c.icon, c.accent_color, c.sort_order]
      );
      seeded += r.rowCount;
    }
    for (const a of catalog.achievements) {
      const r = await pool.query(
        `INSERT INTO achievements (id, category_id, title_en, title_he, description_en, description_he,
                                   condition_type, target_value, condition_params, prerequisite_ids,
                                   xp_reward, rarity, icon, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT (id) DO NOTHING`,
        [
          a.id, a.category_id, a.title_en, a.title_he, a.description_en, a.description_he,
          a.condition_type, a.target_value, JSON.stringify(a.condition_params), a.prerequisite_ids,
          a.xp_reward, a.rarity, a.icon, a.sort_order,
        ]
      );
      seeded += r.rowCount;
    }
    console.log(`catalog: ${seeded} new row(s) seeded`);

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
