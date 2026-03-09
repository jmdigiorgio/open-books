/**
 * GET  /api/uncategorized – List rows from the uncategorized table.
 * POST /api/uncategorized – Insert a row. Body: { transaction_id, date, description, amount, reason }.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { ensureUncategorizedTable } from "@/lib/uncategorized";

export async function GET() {
  try {
    await ensureUncategorizedTable();
    const pool = getPool();
    const r = await pool.query(
      "SELECT id, transaction_id, date, description, amount, reason, created_at FROM uncategorized ORDER BY date DESC, id DESC"
    );
    return NextResponse.json({ rows: r.rows });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load uncategorized";
    console.error("[uncategorized] GET Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureUncategorizedTable();
    const body = await request.json();
    const { transaction_id, date, description, amount, reason } = body;

    if (!transaction_id || !date || amount == null) {
      return NextResponse.json(
        { error: "transaction_id, date, and amount are required" },
        { status: 400 }
      );
    }

    const pool = getPool();
    const r = await pool.query(
      `INSERT INTO uncategorized (transaction_id, date, description, amount, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, transaction_id, date, description, amount, reason, created_at`,
      [transaction_id, date, description ?? null, amount, reason ?? ""]
    );
    return NextResponse.json(r.rows[0], { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create uncategorized";
    console.error("[uncategorized] POST Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
