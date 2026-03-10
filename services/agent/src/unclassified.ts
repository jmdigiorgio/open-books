/**
 * Query the transactions table for rows that have NOT yet been classified.
 *
 * "Unclassified" = transaction_id does NOT appear in:
 *   - income.proof
 *   - expenses.proof
 *   - uncategorized.transaction_id
 *
 * Returns a lightweight projection: { transaction_id, date, description, amount }.
 * The description is derived as COALESCE(merchant_name, name, original_description, '').
 */

import { getPool } from "./db.js";
import type { UnclassifiedTransaction } from "./types.js";

/**
 * Fetch all unclassified transactions from the DB.
 * Only pending = false (posted) transactions are considered.
 */
export async function fetchUnclassified(): Promise<UnclassifiedTransaction[]> {
  const pool = getPool();

  const { rows } = await pool.query<{
    transaction_id: string;
    date: Date;
    description: string;
    amount: string; // numeric comes back as string from pg
  }>(`
    SELECT
      t.transaction_id,
      t.date,
      COALESCE(t.merchant_name, t.name, t.original_description, '') AS description,
      t.amount
    FROM transactions t
    WHERE t.pending = false
      AND t.transaction_id NOT IN (SELECT proof FROM income)
      AND t.transaction_id NOT IN (SELECT proof FROM expenses)
      AND t.transaction_id NOT IN (SELECT transaction_id FROM uncategorized)
    ORDER BY t.date
  `);

  return rows.map((r) => ({
    transaction_id: r.transaction_id,
    date: r.date.toISOString().slice(0, 10), // YYYY-MM-DD
    description: r.description,
    amount: Number(r.amount),
  }));
}
