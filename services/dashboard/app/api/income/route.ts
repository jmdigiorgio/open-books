/**
 * GET /api/income – List income rows (ensures table exists with example structure).
 */

import { NextResponse } from "next/server";
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
