/**
 * Uncategorized table: transactions the classification agent could not classify.
 * Read-only from the dashboard; the agent inserts rows. Table is created by db/01-init.sql.
 */

import { getPool } from "@/lib/db";

const TABLE = "uncategorized";

/**
 * Create uncategorized table if it does not exist (e.g. DB created before init script).
 */
export async function ensureUncategorizedTable(): Promise<void> {
  const pool = getPool();
  const exists = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [TABLE]
  );
  if (exists.rows.length === 0) {
    await pool.query(`
      CREATE TABLE ${TABLE} (
        id serial PRIMARY KEY,
        transaction_id text NOT NULL UNIQUE REFERENCES transactions(transaction_id) ON DELETE CASCADE,
        date date NOT NULL,
        description text,
        amount numeric NOT NULL,
        reason text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }
}
