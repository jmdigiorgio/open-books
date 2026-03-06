/**
 * Agent rules: one row per rule in agent_rules. CRUD for rules the agent reads when
 * classifying transactions as income vs deductions.
 */

import { getPool } from "@/lib/db";

const TABLE = "agent_rules";

/** One rule row. */
export interface AgentRule {
  id: number;
  content: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Create agent_rules table if it does not exist. Safe to call on every request.
 * Runs one-time migrations: (1) old single-row agent_rules -> new multi-row schema;
 * (2) old agent_rule table -> copy into agent_rules then drop agent_rule.
 */
export async function ensureAgentRulesTable(): Promise<void> {
  const pool = getPool();

  const tableExists = await pool.query(`
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1
  `, [TABLE]);
  const hasAgentRules = tableExists.rows.length > 0;

  if (hasAgentRules) {
    const hasNewSchema = await pool.query(`
      SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'sort_order'
    `, [TABLE]);
    if (hasNewSchema.rows.length === 0) {
      // Old single-row agent_rules (id, content, updated_at only). Migrate to new schema.
      await pool.query(`
        CREATE TABLE agent_rules_new (
          id serial PRIMARY KEY,
          content text NOT NULL DEFAULT '',
          sort_order integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await pool.query(`
        INSERT INTO agent_rules_new (content, sort_order, created_at, updated_at)
        SELECT content, 0, updated_at, updated_at FROM agent_rules
      `);
      await pool.query("DROP TABLE agent_rules");
      await pool.query("ALTER TABLE agent_rules_new RENAME TO agent_rules");
    }
  } else {
    await pool.query(`
      CREATE TABLE ${TABLE} (
        id serial PRIMARY KEY,
        content text NOT NULL DEFAULT '',
        sort_order integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  const hasAgentRule = await pool.query(`
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_rule'
  `);
  if (hasAgentRule.rows.length > 0) {
    const count = await pool.query(`SELECT COUNT(*)::int AS n FROM ${TABLE}`);
    if (count.rows[0]?.n === 0) {
      await pool.query(`
        INSERT INTO ${TABLE} (content, sort_order, created_at, updated_at)
        SELECT content, sort_order, created_at, updated_at FROM agent_rule ORDER BY id
      `);
    }
    await pool.query("DROP TABLE agent_rule");
  }
}

/**
 * List all rules ordered by sort_order then id.
 */
export async function listRules(): Promise<AgentRule[]> {
  await ensureAgentRulesTable();
  const pool = getPool();
  const r = await pool.query<{
    id: number;
    content: string;
    sort_order: number;
    created_at: string;
    updated_at: string;
  }>(`SELECT id, content, sort_order, created_at, updated_at FROM ${TABLE} ORDER BY sort_order ASC, id ASC`);
  return r.rows.map((row) => ({
    id: row.id,
    content: row.content,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Create a new rule. Returns the new rule with id and timestamps.
 */
export async function createRule(content: string, sortOrder?: number): Promise<AgentRule> {
  await ensureAgentRulesTable();
  const pool = getPool();
  const order = sortOrder ?? 0;
  const r = await pool.query<{
    id: number;
    content: string;
    sort_order: number;
    created_at: string;
    updated_at: string;
  }>(
    `INSERT INTO ${TABLE} (content, sort_order) VALUES ($1, $2) RETURNING id, content, sort_order, created_at, updated_at`,
    [content.trim() || "", order]
  );
  const row = r.rows[0];
  if (!row) throw new Error("Insert did not return row");
  return {
    id: row.id,
    content: row.content,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Update a rule's content. Returns updated_at.
 */
export async function updateRule(id: number, content: string): Promise<{ updatedAt: string }> {
  const pool = getPool();
  const r = await pool.query<{ updated_at: string }>(
    `UPDATE ${TABLE} SET content = $1, updated_at = now() WHERE id = $2 RETURNING updated_at`,
    [content.trim() || "", id]
  );
  if (r.rows.length === 0) throw new Error("Rule not found");
  return { updatedAt: r.rows[0].updated_at };
}

/**
 * Delete a rule by id. Throws if not found.
 */
export async function deleteRule(id: number): Promise<void> {
  const pool = getPool();
  const r = await pool.query(`DELETE FROM ${TABLE} WHERE id = $1`, [id]);
  if (r.rowCount === 0) throw new Error("Rule not found");
}

/**
 * Return combined content of all rules (e.g. for agents that expect one document). Order matches listRules.
 */
export async function getRulesContent(): Promise<{ content: string; updatedAt: string }> {
  const rules = await listRules();
  const content = rules.map((r) => r.content).filter(Boolean).join("\n\n") || "";
  const updatedAt = rules.length > 0 ? rules[rules.length - 1].updatedAt : new Date().toISOString();
  return { content, updatedAt };
}
