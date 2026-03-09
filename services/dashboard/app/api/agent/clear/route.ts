/**
 * POST /api/agent/clear — Clear income, deductions, and uncategorized tables.
 * Used when the user chooses "Clear tables and start from beginning" before classifying.
 * Order: uncategorized, income, deductions (no FK between them; all reference transactions).
 */

import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export async function POST() {
  try {
    const pool = getPool();
    await pool.query("DELETE FROM uncategorized");
    await pool.query("DELETE FROM income");
    await pool.query("DELETE FROM deductions");
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to clear tables";
    console.error("[agent/clear]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
