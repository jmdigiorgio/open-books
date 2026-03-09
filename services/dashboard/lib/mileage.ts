/**
 * Mileage table: dynamic schema from CSV.
 * - Table name: mileage. Has id SERIAL PRIMARY KEY plus one text column per CSV header.
 * - Column names are sanitized for PostgreSQL (lowercase, non-alphanumeric → underscore).
 */

import { getPool } from "@/lib/db";

const MILEAGE_TABLE = "mileage";
const PK_COLUMN = "id";

/**
 * Sanitize a CSV header into a safe PostgreSQL column name: lowercase, only a-z 0-9 _.
 * Consecutive non-alphanumeric chars become a single underscore.
 */
export function sanitizeColumnName(header: string): string {
  const s = header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return s || "column";
}

/**
 * Given raw CSV headers, return a list of unique sanitized column names (order preserved).
 * Duplicates get _2, _3, ... suffix.
 */
export function getSanitizedColumns(rawHeaders: string[]): string[] {
  const seen = new Map<string, number>();
  return rawHeaders.map((h) => {
    let name = sanitizeColumnName(h);
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name}_${count + 1}`;
  });
}

/**
 * Return true if the mileage table exists in the public schema.
 */
export async function mileageTableExists(): Promise<boolean> {
  const pool = getPool();
  const r = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    ) AS exists`,
    [MILEAGE_TABLE]
  );
  return r.rows[0]?.exists ?? false;
}

/**
 * Get current mileage table column names (excluding id), in order.
 */
export async function getMileageColumnNames(): Promise<string[]> {
  const pool = getPool();
  const r = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [MILEAGE_TABLE]
  );
  return r.rows.map((row) => row.column_name).filter((c) => c !== PK_COLUMN);
}

/**
 * Create the mileage table with columns (id plus one text column per name).
 * Names are quoted so reserved words (e.g. "date") are allowed.
 */
export async function createMileageTable(columnNames: string[]): Promise<void> {
  const pool = getPool();
  const cols = [PK_COLUMN + " SERIAL PRIMARY KEY", ...columnNames.map((c) => `"${c}" text`)];
  await pool.query(`CREATE TABLE ${MILEAGE_TABLE} (${cols.join(", ")})`);
}

/**
 * Replace all rows in mileage with the given rows. Columns must match existing table.
 * Truncates then inserts. Column names are quoted for INSERT.
 */
export async function replaceMileageRows(columnNames: string[], rows: Record<string, string>[]): Promise<void> {
  const pool = getPool();
  await pool.query(`TRUNCATE ${MILEAGE_TABLE} RESTART IDENTITY`);
  if (rows.length === 0) return;
  const quoted = columnNames.map((c) => `"${c}"`).join(", ");
  const placeholders = columnNames.map((_, i) => `$${i + 1}`).join(", ");
  for (const row of rows) {
    const values = columnNames.map((c) => row[c] ?? "");
    await pool.query(`INSERT INTO ${MILEAGE_TABLE} (${quoted}) VALUES (${placeholders})`, values);
  }
}

/**
 * Append rows to the mileage table, skipping duplicates.
 * A row is considered a duplicate if an existing row has the same date and distance values.
 * Columns must match existing table. Does not truncate.
 * Returns the number of rows actually inserted (after skipping duplicates).
 */
export async function appendMileageRows(columnNames: string[], rows: Record<string, string>[]): Promise<number> {
  if (rows.length === 0) return 0;
  const pool = getPool();

  /* Find date and distance columns for duplicate detection. */
  const dateCol = columnNames.find((c) => c === "date" || c.includes("date"));
  const distCol = columnNames.find((c) => c === "distance" || c.includes("distance") || c.includes("miles"));

  const quoted = columnNames.map((c) => `"${c}"`).join(", ");
  const placeholders = columnNames.map((_, i) => `$${i + 1}`).join(", ");

  let inserted = 0;
  for (const row of rows) {
    /* Skip duplicates: if we have both a date and distance column, check for existing match. */
    if (dateCol && distCol) {
      const existing = await pool.query(
        `SELECT 1 FROM ${MILEAGE_TABLE} WHERE "${dateCol}" = $1 AND "${distCol}" = $2 LIMIT 1`,
        [row[dateCol] ?? "", row[distCol] ?? ""]
      );
      if (existing.rows.length > 0) continue;
    }
    const values = columnNames.map((c) => row[c] ?? "");
    await pool.query(`INSERT INTO ${MILEAGE_TABLE} (${quoted}) VALUES (${placeholders})`, values);
    inserted++;
  }
  return inserted;
}
