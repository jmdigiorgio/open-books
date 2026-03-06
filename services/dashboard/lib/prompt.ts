/**
 * Agent prompt: single-row table storing the agent's system/instruction prompt
 * (e.g. how to classify transactions as income vs deductions).
 */

import { getPool } from "@/lib/db";

const TABLE = "agent_prompt";

/**
 * Create agent_prompt table if it does not exist and ensure one row exists.
 * Safe to call on every request.
 */
export async function ensureAgentPromptTable(): Promise<void> {
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
 * Get the prompt content and updated_at.
 */
export async function getPromptContent(): Promise<{ content: string; updatedAt: string }> {
  await ensureAgentPromptTable();
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
 * Update the prompt content.
 */
export async function setPromptContent(content: string): Promise<{ updatedAt: string }> {
  await ensureAgentPromptTable();
  const pool = getPool();
  const r = await pool.query<{ updated_at: string }>(
    `UPDATE ${TABLE} SET content = $1, updated_at = now() WHERE id = 1 RETURNING updated_at`,
    [content]
  );
  if (r.rows.length === 0) throw new Error("Prompt row not found");
  return { updatedAt: r.rows[0].updated_at };
}
