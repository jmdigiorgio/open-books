/**
 * Income table: matches example (Date received, Payer/source, Description, Amount, Proof).
 * proof = transactions.transaction_id.
 */

import { getPool } from "@/lib/db";

const TABLE = "income";

/**
 * Create income table if it does not exist (structure matches UI example).
 * Adds description column if missing on existing table.
 */
export async function ensureIncomeTable(): Promise<void> {
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
}
