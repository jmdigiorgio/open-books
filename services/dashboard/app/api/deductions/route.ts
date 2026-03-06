/**
 * GET /api/deductions – List deduction rows (ensures table exists and migrates from expenses if needed).
 */

import { NextResponse } from "next/server";
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
