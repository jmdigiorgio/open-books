/**
 * GET /api/mileage – Return all rows and column names from the mileage table.
 * If the table does not exist, returns { columns: [], rows: [] }.
 */

import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { mileageTableExists } from "@/lib/mileage";

export async function GET() {
  try {
    const exists = await mileageTableExists();
    if (!exists) {
      return NextResponse.json({ columns: [], rows: [] });
    }
    const pool = getPool();
    const r = await pool.query("SELECT * FROM mileage ORDER BY id ASC");
    const columns = r.fields.map((f) => f.name);
    return NextResponse.json({ columns, rows: r.rows });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch mileage";
    console.error("[mileage] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
