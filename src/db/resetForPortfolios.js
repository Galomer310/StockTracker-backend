// ONE-TIME, DESTRUCTIVE. Moves the database to the multi-portfolio model.
//
//   node src/db/migrate.js                    apply the schema first
//   node src/db/resetForPortfolios.js         dry run - reports what it WOULD delete
//   node src/db/resetForPortfolios.js --confirm   actually do it
//
// Holdings and cash used to be unbounded: anyone could buy any quantity of
// anything, so no existing position corresponds to money a portfolio actually
// had. There is no honest way to retrofit a $10,000 balance onto that history,
// so the trading record is cleared and everyone starts level.
//
// What is DELETED: watchlist, trade_notes, feed_reactions, feed_comments.
// What is KEPT:    users (logins keep working), stocks (the price cache).
//
// Each account is then given one "Main" portfolio with the standard starting
// cash, and portfolio_id is tightened to NOT NULL now that every row has one.
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Kept in step with src/config/portfolio.ts by hand: this script is JavaScript
// so that it can be run with plain node, and cannot import the TypeScript.
const STARTING_CASH = 10000;
const DEFAULT_NAME = "Main";

const confirmed = process.argv.includes("--confirm");

(async () => {
  const client = await pool.connect();
  try {
    const counts = await client.query(`
      SELECT (SELECT COUNT(*)::int FROM watchlist)      AS holdings,
             (SELECT COUNT(*)::int FROM trade_notes)    AS trades,
             (SELECT COUNT(*)::int FROM feed_reactions) AS reactions,
             (SELECT COUNT(*)::int FROM feed_comments)  AS comments,
             (SELECT COUNT(*)::int FROM users)          AS users,
             (SELECT COUNT(*)::int FROM portfolios)     AS portfolios
    `);
    const before = counts.rows[0];
    console.log("current state:", before);

    if (!confirmed) {
      console.log("");
      console.log("DRY RUN - nothing was changed.");
      console.log(
        `Would delete ${before.holdings} holding(s), ${before.trades} trade(s), ` +
          `${before.reactions} reaction(s), ${before.comments} comment(s).`
      );
      console.log(
        `Would give each of the ${before.users} account(s) a "${DEFAULT_NAME}" portfolio with $${STARTING_CASH}.`
      );
      console.log("Re-run with --confirm to apply.");
      return;
    }

    await client.query("BEGIN");

    // Order matters only for readability: the feed tables cascade from
    // trade_notes anyway.
    await client.query("DELETE FROM feed_comments");
    await client.query("DELETE FROM feed_reactions");
    await client.query("DELETE FROM watchlist");
    await client.query("DELETE FROM trade_notes");

    // One starting portfolio per account. ON CONFLICT so a second run is a
    // no-op rather than an error.
    const created = await client.query(
      `INSERT INTO portfolios (user_id, name, starting_balance, cash)
       SELECT id, $1, $2, $2 FROM users
       ON CONFLICT (user_id, name) DO NOTHING
       RETURNING id, user_id`,
      [DEFAULT_NAME, STARTING_CASH]
    );

    // Every remaining row now has a portfolio, so the column can carry the
    // constraint that makes an orphaned holding impossible from here on.
    await client.query("ALTER TABLE watchlist   ALTER COLUMN portfolio_id SET NOT NULL");
    await client.query("ALTER TABLE trade_notes ALTER COLUMN portfolio_id SET NOT NULL");

    await client.query("COMMIT");

    console.log(`created ${created.rowCount} "${DEFAULT_NAME}" portfolio(s)`);
    console.log("portfolio_id is now NOT NULL on watchlist and trade_notes");

    const after = await client.query(
      `SELECT p.id, u.email, p.name, p.starting_balance, p.cash
       FROM portfolios p JOIN users u ON u.id = p.user_id ORDER BY p.id`
    );
    console.table(after.rows);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("RESET ERROR:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
