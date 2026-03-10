/**
 * /api/expenses – CRUD for the expenses table.
 *
 * GET  → list all expense rows ordered by date descending.
 * POST → create a new expense row (body: { date, name, description, amount, proof }).
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { ensureExpensesTable } from "@/lib/expenses";

export async function GET() {
  try {
    await ensureExpensesTable();
    const pool = getPool();
    const r = await pool.query(
      "SELECT id, date, name, description, amount, proof, created_at FROM expenses ORDER BY date DESC, id DESC"
    );
    return NextResponse.json({ rows: r.rows });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load expenses";
    console.error("[expenses] GET Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureExpensesTable();
    const body = await request.json();
    const { date, name, description, amount, proof } = body;

    if (!date || amount == null) {
      return NextResponse.json({ error: "date and amount are required" }, { status: 400 });
    }

    const pool = getPool();
    const r = await pool.query(
      `INSERT INTO expenses (date, name, description, amount, proof)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, date, name, description, amount, proof, created_at`,
      [date, name ?? null, description ?? null, amount, proof ?? ""]
    );
    return NextResponse.json(r.rows[0], { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create expense";
    console.error("[expenses] POST Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
