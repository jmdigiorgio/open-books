/**
 * One-time script: create income, expenses, and uncategorized tables if missing.
 * Migrates from deductions -> expenses if deductions exists.
 * Run from dashboard dir: node scripts/ensure-income-expenses.js
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
    const hasIncome = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'income'"
    );
    if (hasIncome.rows.length === 0) {
      await client.query(`
        CREATE TABLE income (
          id serial PRIMARY KEY,
          date date NOT NULL,
          name text,
          description text,
          amount numeric NOT NULL,
          proof text NOT NULL UNIQUE REFERENCES transactions(transaction_id) ON DELETE CASCADE,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      console.log("Created table income.");
    } else {
      await client.query("ALTER TABLE income ADD COLUMN IF NOT EXISTS description text");
      console.log("Ensured income has description.");
    }

    const hasExpenses = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'expenses'"
    );
    if (hasExpenses.rows.length === 0) {
      await client.query(`
        CREATE TABLE expenses (
          id serial PRIMARY KEY,
          date date NOT NULL,
          name text,
          description text,
          amount numeric NOT NULL,
          proof text NOT NULL UNIQUE REFERENCES transactions(transaction_id) ON DELETE CASCADE,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      console.log("Created table expenses.");
    } else {
      await client.query("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS description text");
      console.log("Ensured expenses has description.");
    }

    const hasUncategorized = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'uncategorized'"
    );
    if (hasUncategorized.rows.length === 0) {
      await client.query(`
        CREATE TABLE uncategorized (
          id serial PRIMARY KEY,
          transaction_id text NOT NULL UNIQUE REFERENCES transactions(transaction_id) ON DELETE CASCADE,
          date date NOT NULL,
          description text,
          amount numeric NOT NULL,
          reason text NOT NULL DEFAULT '',
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      console.log("Created table uncategorized.");
    }

    const hasDeductions = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'deductions'"
    );
    if (hasDeductions.rows.length > 0) {
      const count = await client.query("SELECT COUNT(*)::int AS n FROM expenses");
      if (count.rows[0].n === 0) {
        await client.query(`
          INSERT INTO expenses (date, name, description, amount, proof, created_at)
          SELECT date, name, COALESCE(description, ''::text), amount, proof, created_at FROM deductions ORDER BY id
        `);
        console.log("Migrated rows from deductions to expenses.");
      }
      await client.query("DROP TABLE deductions");
      console.log("Dropped table deductions.");
    }

    console.log("Done.");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
