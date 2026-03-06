/**
 * Agent rules: single-row table storing one markdown document the agent reads
 * when classifying transactions as income vs expenses.
 */

import { getPool } from "@/lib/db";

const TABLE = "agent_rules";

/**
 * Create agent_rules table if it does not exist and ensure one row exists.
 * Safe to call on every request; use for DBs that were created before this table was added.
 */
export async function ensureAgentRulesTable(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      content text NOT NULL DEFAULT '',
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(
    `INSERT INTO ${TABLE} (id, content) VALUES (1, '') ON CONFLICT (id) DO NOTHING`
  );
}

/**
 * Get the rules content and updated_at. Returns empty string if no row.
 */
export async function getRulesContent(): Promise<{ content: string; updatedAt: string }> {
  await ensureAgentRulesTable();
  const pool = getPool();
  const r = await pool.query<{ content: string; updated_at: string }>(
    `SELECT content, updated_at FROM ${TABLE} WHERE id = 1`
  );
  const row = r.rows[0];
  return {
    content: row?.content ?? "",
    updatedAt: row?.updated_at ?? new Date().toISOString(),
  };
}

/**
 * Update the rules content. Creates table and row if needed.
 */
export async function setRulesContent(content: string): Promise<void> {
  await ensureAgentRulesTable();
  const pool = getPool();
  await pool.query(
    `UPDATE ${TABLE} SET content = $1, updated_at = now() WHERE id = 1`,
    [content]
  );
}
