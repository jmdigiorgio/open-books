/**
 * Plaid access token and link state storage — backed by the plaid_link_state
 * table in Postgres (single row, one linked account at a time).
 */

import { getPool } from "./db";

/** Row shape from the plaid_link_state table. */
interface LinkRow {
  access_token: string;
  item_id: string | null;
  institution_name: string | null;
}

/** Persist access token, item ID, and institution name after a successful Link exchange. */
export async function savePlaidAccessToken(
  itemId: string,
  accessToken: string,
  institutionName?: string
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO plaid_link_state (id, access_token, item_id, institution_name, linked_at)
     VALUES (1, $1, $2, $3, now())
     ON CONFLICT (id) DO UPDATE SET
       access_token = $1,
       item_id = $2,
       institution_name = $3,
       linked_at = now()`,
    [accessToken.trim(), itemId.trim(), institutionName?.trim() || null]
  );
}

/** Read the stored link row, or null if no bank is linked. */
async function readStored(): Promise<LinkRow | null> {
  const pool = getPool();
  const result = await pool.query<LinkRow>(
    "SELECT access_token, item_id, institution_name FROM plaid_link_state WHERE id = 1"
  );
  return result.rows[0] ?? null;
}

/** Read stored access token for sync jobs. Returns null if not linked. */
export async function getPlaidAccessToken(): Promise<string | null> {
  const row = await readStored();
  return row?.access_token ?? null;
}

/** Get link state for the UI (institution name). */
export async function getPlaidLinkState(): Promise<{ institutionName: string | null } | null> {
  const row = await readStored();
  if (!row) return null;
  return { institutionName: row.institution_name };
}

/** Whether a bank account is linked. */
export async function hasPlaidAccessToken(): Promise<boolean> {
  const token = await getPlaidAccessToken();
  return token !== null;
}

/** Remove stored token (disconnect). */
export async function clearPlaidAccessToken(): Promise<void> {
  const pool = getPool();
  await pool.query("DELETE FROM plaid_link_state WHERE id = 1");
}
