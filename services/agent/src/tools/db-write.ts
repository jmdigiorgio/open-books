/**
 * DB write tools — exposed to the LLM via tool calling.
 *
 * Each function inserts a single row and returns a confirmation JSON string
 * that goes back to the model as the tool result.
 *
 * UNIQUE constraints in the schema prevent double-inserts
 * (income.proof, deductions.proof, uncategorized.transaction_id).
 */

import { getPool } from "../db.js";

/* ------------------------------------------------------------------ */
/*  insert_income                                                      */
/* ------------------------------------------------------------------ */

export interface InsertIncomeArgs {
  date: string;
  name: string;
  description: string;
  amount: number;
  proof: string; // transaction_id
}

/**
 * Insert one income row. Returns confirmation JSON.
 * Throws on duplicate proof (UNIQUE constraint).
 */
export async function insertIncome(args: InsertIncomeArgs): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO income (date, name, description, amount, proof)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [args.date, args.name, args.description, args.amount, args.proof]
  );
  return JSON.stringify({ ok: true, id: rows[0].id, table: "income" });
}

/* ------------------------------------------------------------------ */
/*  insert_deduction                                                   */
/* ------------------------------------------------------------------ */

export interface InsertDeductionArgs {
  date: string;
  name: string;
  description: string;
  amount: number;
  proof: string; // transaction_id
}

/**
 * Insert one deduction row. Returns confirmation JSON.
 */
export async function insertDeduction(args: InsertDeductionArgs): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO deductions (date, name, description, amount, proof)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [args.date, args.name, args.description, args.amount, args.proof]
  );
  return JSON.stringify({ ok: true, id: rows[0].id, table: "deductions" });
}

/* ------------------------------------------------------------------ */
/*  insert_uncategorized                                               */
/* ------------------------------------------------------------------ */

export interface InsertUncategorizedArgs {
  transaction_id: string;
  date: string;
  description: string;
  amount: number;
  reason: string;
}

/**
 * Insert one uncategorized row. Returns confirmation JSON.
 */
export async function insertUncategorized(args: InsertUncategorizedArgs): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO uncategorized (transaction_id, date, description, amount, reason)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [args.transaction_id, args.date, args.description, args.amount, args.reason]
  );
  return JSON.stringify({ ok: true, id: rows[0].id, table: "uncategorized" });
}
