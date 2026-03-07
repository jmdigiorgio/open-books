/**
 * CSV transaction import — format-driven.
 *
 * Each bank CSV format gets its own parser that maps CSV columns into a
 * common CsvRow shape. The shared importer handles dedup and insertion.
 *
 * To add a new bank format:
 *  1. Write a parser function: (records) => CsvRow[]
 *  2. Register it in FORMAT_PARSERS below.
 *  3. Add the format key to SUPPORTED_FORMATS.
 *  4. Add an <option> in the UI dropdown.
 */

import { createHash } from "crypto";
import { getPool } from "./db";

/* ------------------------------------------------------------------ */
/*  Public types                                                      */
/* ------------------------------------------------------------------ */

/** Result counts returned after a CSV import completes. */
export interface CsvImportResult {
  parsed: number;
  inserted: number;
  skippedDuplicate: number;
}

/* ------------------------------------------------------------------ */
/*  Internal common row — every format parser must produce these       */
/* ------------------------------------------------------------------ */

/** A single normalised row ready for import. */
interface CsvRow {
  date: string;        // YYYY-MM-DD
  description: string;
  /** Amount in Plaid convention: positive = debit, negative = credit. */
  plaidAmount: number;
  /** Sentinel for account_id (NOT NULL in DB). */
  accountId: string;
}

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Deterministic transaction_id from row contents so re-uploads are
 * idempotent. Prefixed with "csv-" to distinguish from Plaid IDs.
 */
function generateTransactionId(row: CsvRow): string {
  const payload = `${row.date}|${row.description}|${row.plaidAmount}`;
  const hash = createHash("sha256").update(payload).digest("hex").substring(0, 32);
  return `csv-${hash}`;
}

/**
 * First word of a string, lowercased, splitting on whitespace and
 * common special characters so "TradingViewM*Product" and
 * "Tradingviewm Product" both yield "tradingviewm".
 */
function firstWordLower(s: string): string {
  return (s.split(/[\s*\/\\#@!&().,;:]+/)[0] ?? "").toLowerCase();
}

/**
 * Convert a date string to YYYY-MM-DD.
 * Handles MM-DD-YYYY (common US bank format) and YYYY-MM-DD.
 */
function normalizeDate(raw: string): string {
  const mdyMatch = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (mdyMatch) return `${mdyMatch[3]}-${mdyMatch[1]}-${mdyMatch[2]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  throw new Error(`Unrecognized date format: "${raw}"`);
}

/**
 * Strip "$" and commas from an amount string and parse to a number.
 */
function parseCurrencyAmount(raw: string): number {
  const cleaned = raw.replace(/[$,]/g, "").trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) throw new Error(`Invalid amount: "${raw}"`);
  return num;
}

/* ------------------------------------------------------------------ */
/*  Novo parser                                                        */
/* ------------------------------------------------------------------ */

/**
 * Novo CSV shape: Date | Description | Amount | Note | Check Number | Category
 *
 * Amount sign convention is opposite of Plaid:
 *   Novo positive = credit (money in), negative = debit (money out).
 *   Plaid positive = debit (money out), negative = credit (money in).
 * We flip the sign during parsing.
 */
function parseNovo(records: Record<string, string>[]): CsvRow[] {
  // Validate required columns.
  const headers = Object.keys(records[0] ?? {});
  const required = ["Date", "Description", "Amount"];
  const missing = required.filter((col) => !headers.includes(col));
  if (missing.length > 0) {
    throw new Error(`Missing required CSV columns: ${missing.join(", ")}`);
  }

  return records.map((rec, i) => {
    const dateRaw = rec["Date"]?.trim();
    const description = rec["Description"]?.trim();
    const amountRaw = rec["Amount"]?.trim();

    if (!dateRaw) throw new Error(`Row ${i + 1}: missing Date`);
    if (!description) throw new Error(`Row ${i + 1}: missing Description`);
    if (!amountRaw) throw new Error(`Row ${i + 1}: missing Amount`);

    return {
      date: normalizeDate(dateRaw),
      description,
      plaidAmount: parseCurrencyAmount(amountRaw) * -1, // flip sign
      accountId: "novo-csv-import",
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Format registry                                                    */
/* ------------------------------------------------------------------ */

type FormatParser = (records: Record<string, string>[]) => CsvRow[];

/** Map of format key → parser function. Add new banks here. */
const FORMAT_PARSERS: Record<string, FormatParser> = {
  novo: parseNovo,
};

/** List of format keys the UI can offer. */
export const SUPPORTED_FORMATS = Object.keys(FORMAT_PARSERS);

/* ------------------------------------------------------------------ */
/*  Shared importer (format-agnostic)                                  */
/* ------------------------------------------------------------------ */

/**
 * Import a CSV using the specified bank format.
 *
 * For each row:
 *  1. Check if a Plaid transaction already exists with the same amount,
 *     a date within ±1 day, and a matching first word in the description.
 *     Bank CSVs often show the authorized date which is 1 day before
 *     Plaid's posted date.
 *  2. If a match is found, skip (Plaid is the richer data source).
 *  3. Insert with a deterministic transaction_id. ON CONFLICT (re-upload)
 *     is a no-op.
 */
export async function importCsv(
  format: string,
  records: Record<string, string>[]
): Promise<CsvImportResult> {
  const parser = FORMAT_PARSERS[format];
  if (!parser) throw new Error(`Unsupported format: "${format}"`);

  const rows = parser(records);
  const pool = getPool();
  let inserted = 0;
  let skippedDuplicate = 0;

  for (const row of rows) {
    const csvFirstWord = firstWordLower(row.description);

    // Look for a Plaid transaction with the same amount within ±1 day.
    const candidates = await pool.query<{ name: string | null; merchant_name: string | null }>(
      `SELECT name, merchant_name FROM transactions
       WHERE transaction_id NOT LIKE 'csv-%'
         AND amount = $1
         AND date BETWEEN ($2::date - INTERVAL '1 day') AND ($2::date + INTERVAL '1 day')`,
      [row.plaidAmount, row.date]
    );

    // Confirm the match by comparing the first word of the description.
    const isDuplicate = candidates.rows.some((plaid) => {
      const plaidDesc = plaid.merchant_name ?? plaid.name ?? "";
      return firstWordLower(plaidDesc) === csvFirstWord;
    });

    if (isDuplicate) {
      skippedDuplicate++;
      continue;
    }

    const txnId = generateTransactionId(row);

    const result = await pool.query(
      `INSERT INTO transactions (
         transaction_id, account_id, amount, iso_currency_code,
         unofficial_currency_code, date, name, merchant_name,
         original_description, pending, pending_transaction_id,
         account_owner, category_id, authorized_date, datetime,
         payment_channel, location, payment_meta, personal_finance_category
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
       )
       ON CONFLICT (transaction_id) DO NOTHING`,
      [
        txnId,
        row.accountId,
        row.plaidAmount,
        "USD",
        null,                // unofficial_currency_code
        row.date,
        row.description,     // name
        null,                // merchant_name
        row.description,     // original_description
        false,               // pending = posted
        null,                // pending_transaction_id
        null,                // account_owner
        null,                // category_id
        null,                // authorized_date
        null,                // datetime
        null,                // payment_channel
        null,                // location
        null,                // payment_meta
        null,                // personal_finance_category
      ]
    );

    if (result.rowCount && result.rowCount > 0) {
      inserted++;
    } else {
      skippedDuplicate++;
    }
  }

  return { parsed: rows.length, inserted, skippedDuplicate };
}
