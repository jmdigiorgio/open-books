/**
 * Plaid /transactions/get backfill: fetches historical transactions for a
 * specific date range. Unlike /transactions/sync (cursor-based, no date
 * params), this endpoint lets us explicitly request a window of time.
 *
 * Use this when the Sync API didn't return older transactions that the
 * institution actually has available.
 */

import { getPlaidClient } from "./plaid";
import { getPlaidAccessToken } from "./plaid-token";
import { getPool } from "./db";

/** Counts returned to the caller after a backfill completes. */
export interface BackfillResult {
  /** Total transactions Plaid returned for the date range. */
  fetched: number;
  /** How many were new (inserted) vs already present (skipped/updated). */
  upserted: number;
}

/**
 * Pull transactions from Plaid for [startDate, endDate] using the
 * /transactions/get endpoint and upsert them into our transactions table.
 *
 * @param startDate – inclusive start, YYYY-MM-DD format
 * @param endDate   – inclusive end, YYYY-MM-DD format
 */
export async function backfillTransactions(
  startDate: string,
  endDate: string
): Promise<BackfillResult> {
  /* ---- validate date format ---- */
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
    throw new Error("Dates must be in YYYY-MM-DD format");
  }

  /* ---- access token ---- */
  const accessToken = await getPlaidAccessToken();
  if (!accessToken) throw new Error("No bank linked — cannot backfill");

  /* ---- plaid client + credentials ---- */
  const client = getPlaidClient();
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;

  /* ---- paginate through transactionsGet ---- */
  let totalFetched = 0;
  let offset = 0;
  const allTransactions: import("plaid").Transaction[] = [];

  // Plaid returns up to 500 transactions per call; paginate until we have all.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const resp = await client.transactionsGet({
      client_id: clientId,
      secret,
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
      options: { offset, count: 500 },
    });

    const data = resp.data;
    allTransactions.push(...data.transactions);
    totalFetched = data.total_transactions;

    // Stop when we've fetched everything Plaid has for this range.
    if (allTransactions.length >= totalFetched) break;
    offset = allTransactions.length;
  }

  /* ---- upsert into transactions table (same schema as sync.ts) ---- */
  const pool = getPool();
  let upserted = 0;

  for (const txn of allTransactions) {
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
    upserted++;
  }

  return { fetched: totalFetched, upserted };
}
