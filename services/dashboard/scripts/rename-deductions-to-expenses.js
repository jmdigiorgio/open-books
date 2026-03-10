/**
 * One-time script: rename table deductions to expenses (no data copy).
 * Run from dashboard dir: node scripts/rename-deductions-to-expenses.js
 * Loads .env.local for DATABASE_URL if present.
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

function loadEnvLocal() {
  const p = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return;
  const content = fs.readFileSync(p, "utf8");
  for (const line of content.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

loadEnvLocal();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set. Set it or add .env.local with DATABASE_URL.");
  process.exit(1);
}

const pool = new Pool({ connectionString: url });

async function run() {
  const client = await pool.connect();
  try {
    const hasDeductions = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'deductions'"
    );
    const hasExpenses = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'expenses'"
    );

    if (hasDeductions.rows.length === 0 && hasExpenses.rows.length > 0) {
      console.log("Table is already named 'expenses'. Nothing to do.");
      return;
    }
    if (hasDeductions.rows.length === 0 && hasExpenses.rows.length === 0) {
      console.log("Neither 'deductions' nor 'expenses' table exists. Nothing to do.");
      return;
    }
    if (hasDeductions.rows.length > 0 && hasExpenses.rows.length > 0) {
      console.log("Both 'deductions' and 'expenses' exist. Run ensure-income-expenses.js to migrate data and drop deductions.");
      process.exit(1);
    }

    await client.query("ALTER TABLE deductions RENAME TO expenses");
    console.log("Renamed table 'deductions' to 'expenses'.");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
