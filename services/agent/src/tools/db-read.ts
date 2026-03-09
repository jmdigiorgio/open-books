/**
 * DB read tools — exposed to the LLM via tool calling.
 *
 * Each function returns a JSON string (the tool result sent back to the model).
 * The model uses these to check existing classifications for consistency.
 */

import { getPool } from "../db.js";

/** Clamp a limit value to [1, 100], defaulting to 20. */
function clampLimit(raw: unknown): number {
  const n = typeof raw === "number" ? raw : 20;
  return Math.max(1, Math.min(100, Math.round(n)));
}

/**
 * Read recent income rows.
 * Returns JSON array of { id, date, name, description, amount, proof }.
 */
export async function readIncome(args: { limit?: number }): Promise<string> {
  const limit = clampLimit(args.limit);
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT id, date, name, description, amount, proof FROM income ORDER BY date DESC LIMIT $1",
    [limit]
  );
  return JSON.stringify(rows);
}

/**
 * Read recent deduction rows.
 * Returns JSON array of { id, date, name, description, amount, proof }.
 */
export async function readDeductions(args: { limit?: number }): Promise<string> {
  const limit = clampLimit(args.limit);
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT id, date, name, description, amount, proof FROM deductions ORDER BY date DESC LIMIT $1",
    [limit]
  );
  return JSON.stringify(rows);
}

/**
 * Read recent uncategorized rows.
 * Returns JSON array of { id, transaction_id, date, description, amount, reason }.
 */
export async function readUncategorized(args: { limit?: number }): Promise<string> {
  const limit = clampLimit(args.limit);
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT id, transaction_id, date, description, amount, reason FROM uncategorized ORDER BY date DESC LIMIT $1",
    [limit]
  );
  return JSON.stringify(rows);
}
