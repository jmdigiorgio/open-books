/**
 * /api/income – CRUD for the income table.
 *
 * GET    → list all income rows ordered by date descending.
 * POST   → create a new income row (body: { date, name, description, amount, proof }).
 * DELETE → delete by id (query param ?id=N).
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { ensureIncomeTable } from "@/lib/income";

export async function GET() {
  try {
    await ensureIncomeTable();
    const pool = getPool();
    const r = await pool.query(
      "SELECT id, date, name, description, amount, proof, created_at FROM income ORDER BY date DESC, id DESC"
    );
    return NextResponse.json({ rows: r.rows });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load income";
    console.error("[income] GET Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureIncomeTable();
    const body = await request.json();
    const { date, name, description, amount, proof } = body;

    if (!date || amount == null) {
      return NextResponse.json({ error: "date and amount are required" }, { status: 400 });
    }

    const pool = getPool();
    const r = await pool.query(
      `INSERT INTO income (date, name, description, amount, proof)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, date, name, description, amount, proof, created_at`,
      [date, name ?? null, description ?? null, amount, proof ?? ""]
    );
    return NextResponse.json(r.rows[0], { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create income";
    console.error("[income] POST Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id query param required" }, { status: 400 });
  }
  try {
    const pool = getPool();
    const result = await pool.query("DELETE FROM income WHERE id = $1", [id]);
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to delete income";
    console.error("[income] DELETE Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
