/**
 * Deduction categories: per-year monthly amounts and business-use percentage (e.g. rent, utilities, internet, phone).
 * Monthly deduction = monthly_amount * percentage (computed in UI); year total calculated in Summary.
 */

import { getPool } from "@/lib/db";

/** Category keys stored in the DB. */
export const DEDUCTION_CATEGORY_KEYS = [
  "rent",
  "water_sewer_trash",
  "gas",
  "electricity",
  "internet",
  "phone",
] as const;

export type DeductionCategoryKey = (typeof DEDUCTION_CATEGORY_KEYS)[number];

/** Display label for each category. */
export const DEDUCTION_CATEGORY_LABELS: Record<DeductionCategoryKey, string> = {
  rent: "Rent",
  water_sewer_trash: "Water/Sewer/Trash",
  gas: "Gas",
  electricity: "Electricity",
  internet: "Internet",
  phone: "Phone",
};

export interface DeductionCategoryRow {
  category: DeductionCategoryKey;
  monthly_amount: number;
  percentage: number;
}

const TABLE = "deduction_categories";

/** Create deduction_categories table if it does not exist. */
export async function ensureDeductionCategoriesTable(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      year smallint NOT NULL,
      category text NOT NULL,
      monthly_amount numeric NOT NULL DEFAULT 0,
      percentage numeric NOT NULL DEFAULT 0,
      PRIMARY KEY (year, category)
    )
  `);
  const hasTotalCol = await pool.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'deduction_categories' AND column_name = 'total'"
  );
  if (hasTotalCol.rows.length > 0) {
    await pool.query("ALTER TABLE deduction_categories RENAME COLUMN total TO monthly_amount");
  }
}

/** Load all category rows for a year. Returns one row per category (defaults to 0, 0 if missing). */
export async function getDeductionCategories(year: number): Promise<DeductionCategoryRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<{ category: string; monthly_amount: string; percentage: string }>(
    "SELECT category, monthly_amount, percentage FROM deduction_categories WHERE year = $1",
    [year]
  );
  const byCategory = new Map(rows.map((r) => [r.category, { monthly_amount: Number(r.monthly_amount), percentage: Number(r.percentage) }]));
  return DEDUCTION_CATEGORY_KEYS.map((category) => ({
    category,
    monthly_amount: byCategory.get(category)?.monthly_amount ?? 0,
    percentage: byCategory.get(category)?.percentage ?? 0,
  }));
}

/** Save category monthly amounts and percentages for a year (upsert per category). */
export async function saveDeductionCategories(
  year: number,
  categories: DeductionCategoryRow[]
): Promise<void> {
  const pool = getPool();
  for (const row of categories) {
    await pool.query(
      `INSERT INTO deduction_categories (year, category, monthly_amount, percentage)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (year, category) DO UPDATE SET monthly_amount = $3, percentage = $4`,
      [year, row.category, row.monthly_amount, row.percentage]
    );
  }
}
