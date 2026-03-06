/**
 * One-off script: run db/01-init.sql against the DB in DATABASE_URL.
 * Usage: DATABASE_URL="postgresql://..." node scripts/run-init.js
 * (From repo root: cd services/dashboard && node scripts/run-init.js)
 */

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sqlPath = path.join(__dirname, "../../../db/01-init.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

async function main() {
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await client.query(sql);
    console.log("Ran db/01-init.sql: transactions, sync_state, plaid_link_state created.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
