/**
 * Plaid /transactions/sync loop: pulls all available history on first run,
 * then only deltas on subsequent runs. Upserts into the transactions table
 * and persists the cursor in sync_state so we pick up where we left off.
 */

import { getPlaidClient } from "./plaid";
import { getPlaidAccessToken } from "./plaid-token";
import { getPool } from "./db";
import type { Transaction, RemovedTransaction } from "plaid";

/** Counts returned to the caller after a sync completes. */
export interface SyncResult {
  added: number;
  modified: number;
  removed: number;
  /** ISO timestamp of when this sync finished. */
  syncedAt: string;
}

/**
 * Run a full sync cycle:
 *  1. Read cursor from sync_state (null = first run = full pull).
 *  2. Page through Plaid transactionsSync until has_more is false.
 *  3. Upsert added/modified transactions, delete removed ones.
 *  4. Save the new cursor + timestamp.
 */
export async function syncTransactions(): Promise<SyncResult> {
  /* ---- access token ---- */
  const accessToken = await getPlaidAccessToken();
  if (!accessToken) throw new Error("No bank linked — cannot sync");

  /* ---- plaid client + credentials (sent in body per Plaid convention) ---- */
  const client = getPlaidClient();
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;

  /* ---- load cursor from DB ---- */
  const pool = getPool();
  const cursorRow = await pool.query<{ cursor: string | null }>(
    "SELECT cursor FROM sync_state WHERE id = 1"
  );
  let cursor: string = cursorRow.rows[0]?.cursor ?? "";

  /* ---- paginate through transactionsSync ---- */
  const allAdded: Transaction[] = [];
  const allModified: Transaction[] = [];
  const allRemoved: RemovedTransaction[] = [];

  let hasMore = true;
  while (hasMore) {
    let resp;
    try {
      resp = await client.transactionsSync({
        client_id: clientId,
        secret,
        access_token: accessToken,
        cursor: cursor || undefined,
      });
    } catch (err: unknown) {
      /* If the cursor is stale (e.g. after re-linking), reset and retry a full pull. */
      const plaidErr = err as { response?: { data?: { error_code?: string; error_message?: string } } };
      const code = plaidErr.response?.data?.error_code ?? "";
      const msg = plaidErr.response?.data?.error_message ?? "";
      if (cursor && code === "INVALID_FIELD" && msg.includes("cursor not associated")) {
        console.warn("[sync] Stale cursor detected — resetting and retrying full sync");
        cursor = "";
        allAdded.length = 0;
        allModified.length = 0;
        allRemoved.length = 0;
        continue;
      }
      throw err;
    }

    const data = resp.data;
    allAdded.push(...data.added);
    allModified.push(...data.modified);
    allRemoved.push(...data.removed);

    hasMore = data.has_more;
    cursor = data.next_cursor;
  }

  /* ---- upsert added + modified ---- */
  const toUpsert = [...allAdded, ...allModified];
  for (const txn of toUpsert) {
    await pool.query(
      `INSERT INTO transactions (
         transaction_id, account_id, amount, iso_currency_code,
         unofficial_currency_code, date, name, merchant_name,
         original_description, pending, pending_transaction_id,
         account_owner, category_id, authorized_date, datetime,
         payment_channel, location, payment_meta, personal_finance_category
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
       )
       ON CONFLICT (transaction_id) DO UPDATE SET
         account_id               = EXCLUDED.account_id,
         amount                   = EXCLUDED.amount,
         iso_currency_code        = EXCLUDED.iso_currency_code,
         unofficial_currency_code = EXCLUDED.unofficial_currency_code,
         date                     = EXCLUDED.date,
         name                     = EXCLUDED.name,
         merchant_name            = EXCLUDED.merchant_name,
         original_description     = EXCLUDED.original_description,
         pending                  = EXCLUDED.pending,
         pending_transaction_id   = EXCLUDED.pending_transaction_id,
         account_owner            = EXCLUDED.account_owner,
         category_id              = EXCLUDED.category_id,
         authorized_date          = EXCLUDED.authorized_date,
         datetime                 = EXCLUDED.datetime,
         payment_channel          = EXCLUDED.payment_channel,
         location                 = EXCLUDED.location,
         payment_meta             = EXCLUDED.payment_meta,
         personal_finance_category = EXCLUDED.personal_finance_category`,
      [
        txn.transaction_id,
        txn.account_id,
        txn.amount,
        txn.iso_currency_code ?? null,
        txn.unofficial_currency_code ?? null,
        txn.date,
        txn.name ?? null,
        txn.merchant_name ?? null,
        txn.original_description ?? null,
        txn.pending,
        txn.pending_transaction_id ?? null,
        txn.account_owner ?? null,
        txn.category_id ?? null,
        txn.authorized_date ?? null,
        txn.datetime ?? null,
        txn.payment_channel ?? null,
        txn.location ? JSON.stringify(txn.location) : null,
        txn.payment_meta ? JSON.stringify(txn.payment_meta) : null,
        txn.personal_finance_category
          ? JSON.stringify(txn.personal_finance_category)
          : null,
      ]
    );
  }

  /* ---- delete removed ---- */
  const removedIds = allRemoved
    .map((r) => r.transaction_id)
    .filter(Boolean) as string[];
  if (removedIds.length > 0) {
    await pool.query(
      "DELETE FROM transactions WHERE transaction_id = ANY($1::text[])",
      [removedIds]
    );
  }

  /* ---- persist cursor + timestamp ---- */
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO sync_state (id, cursor, last_synced_at)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET cursor = $1, last_synced_at = $2`,
    [cursor, now]
  );

  return {
    added: allAdded.length,
    modified: allModified.length,
    removed: removedIds.length,
    syncedAt: now,
  };
}
