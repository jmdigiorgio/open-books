/**
 * /api/deductions – CRUD for the deductions table.
 *
 * GET    → list all deduction rows ordered by date descending.
 * POST   → create a new deduction row (body: { date, name, description, amount, proof }).
 * DELETE → delete by id (query param ?id=N).
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { ensureDeductionsTable } from "@/lib/deductions";

export async function GET() {
  try {
    await ensureDeductionsTable();
    const pool = getPool();
    const r = await pool.query(
      "SELECT id, date, name, description, amount, proof, created_at FROM deductions ORDER BY date DESC, id DESC"
    );
    return NextResponse.json({ rows: r.rows });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load deductions";
    console.error("[deductions] GET Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureDeductionsTable();
    const body = await request.json();
    const { date, name, description, amount, proof } = body;

    if (!date || amount == null) {
      return NextResponse.json({ error: "date and amount are required" }, { status: 400 });
    }

    const pool = getPool();
    const r = await pool.query(
      `INSERT INTO deductions (date, name, description, amount, proof)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, date, name, description, amount, proof, created_at`,
      [date, name ?? null, description ?? null, amount, proof ?? ""]
    );
    return NextResponse.json(r.rows[0], { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create deduction";
    console.error("[deductions] POST Error:", message);
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
    const result = await pool.query("DELETE FROM deductions WHERE id = $1", [id]);
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to delete deduction";
    console.error("[deductions] DELETE Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
