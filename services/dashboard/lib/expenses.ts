/**
 * Expenses table: matches example (Date incurred, Payee, Description, Amount paid, Proof).
 * proof = transactions.transaction_id. Ensures table exists and migrates from deductions if present.
 */

import { getPool } from "@/lib/db";

const TABLE = "expenses";

/**
 * Create expenses table if it does not exist (structure matches UI example).
 * If the old deductions table exists, copy rows into expenses then drop deductions.
 * Adds description column if missing on existing table.
 */
export async function ensureExpensesTable(): Promise<void> {
  const pool = getPool();
  const tableExists = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [TABLE]
  );
  if (tableExists.rows.length === 0) {
    await pool.query(`
      CREATE TABLE ${TABLE} (
        id serial PRIMARY KEY,
        date date NOT NULL,
        name text,
        description text,
        amount numeric NOT NULL,
        proof text NOT NULL UNIQUE REFERENCES transactions(transaction_id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  } else {
    await pool.query(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS description text`);
  }
  const hasDeductions = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'deductions'`
  );
  if (hasDeductions.rows.length > 0) {
    const count = await pool.query(`SELECT COUNT(*)::int AS n FROM ${TABLE}`);
    if (count.rows[0]?.n === 0) {
      await pool.query(`
        INSERT INTO ${TABLE} (date, name, description, amount, proof, created_at)
        SELECT date, name, COALESCE(description, ''::text), amount, proof, created_at FROM deductions ORDER BY id
      `);
    }
    await pool.query("DROP TABLE deductions");
  }
}
