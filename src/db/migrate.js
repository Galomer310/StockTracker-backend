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
