/**
 * Build the full system message for the classification agent.
 *
 * 1. Read the static prompt from prompt.md (lives in repo, NOT in DB).
 * 2. Read any user-defined rules from the agent_rules table.
 * 3. Concatenate them into a single system-message string.
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db.js";

/** Resolve to the repo-root prompt.md (one level above src/). */
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = resolve(__dirname, "..", "prompt.md");

/**
 * Load the static prompt.md file.
 * Throws if the file is missing or empty — the agent cannot run without it.
 */
async function loadPromptFile(): Promise<string> {
  const text = await readFile(PROMPT_PATH, "utf-8");
  if (!text.trim()) throw new Error("prompt.md is empty");
  return text.trim();
}

/**
 * Fetch all rows from agent_rules, ordered by sort_order then id.
 * Returns an empty array if the table doesn't exist (first run before migration).
 */
async function loadRules(): Promise<string[]> {
  const pool = getPool();
  try {
    const { rows } = await pool.query<{ content: string }>(
      "SELECT content FROM agent_rules ORDER BY sort_order, id"
    );
    return rows.map((r) => r.content).filter(Boolean);
  } catch (err: unknown) {
    /* If the table doesn't exist yet, just return no rules. */
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("does not exist")) return [];
    throw err;
  }
}

/**
 * Build the combined system message: prompt.md + any rules from the DB.
 */
export async function buildSystemMessage(): Promise<string> {
  const [prompt, rules] = await Promise.all([loadPromptFile(), loadRules()]);

  if (rules.length === 0) return prompt;

  /* Append each rule as a numbered bullet under a clear heading. */
  const rulesBlock = rules
    .map((r, i) => `${i + 1}. ${r}`)
    .join("\n");

  return `${prompt}\n\n## Additional classification rules (from agent_rules)\n\n${rulesBlock}`;
}
