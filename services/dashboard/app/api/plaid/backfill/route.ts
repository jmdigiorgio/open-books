/**
 * GET /api/plaid/backfill?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Pulls historical transactions from Plaid for the given date range using
 * /transactions/get (which accepts explicit dates, unlike /transactions/sync).
 * Upserts any new transactions into our DB without affecting the sync cursor.
 */

import { NextRequest, NextResponse } from "next/server";
import { backfillTransactions } from "@/lib/backfill";

export async function GET(request: NextRequest) {
  /* ---- read & validate query params ---- */
  const start = request.nextUrl.searchParams.get("start");
  const end = request.nextUrl.searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json(
      { error: "start and end query params required (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  try {
    const result = await backfillTransactions(start, end);
    return NextResponse.json(result);
  } catch (e: unknown) {
    /* Surface Plaid-specific error details if available. */
    let message = "Backfill failed";
    if (e && typeof e === "object" && "response" in e) {
      const res = (
        e as { response?: { data?: { error_message?: string; error_code?: string } } }
      ).response;
      message = res?.data?.error_message ?? res?.data?.error_code ?? message;
      console.error("[backfill] Plaid error:", res?.data);
    } else if (e instanceof Error) {
      message = e.message;
      console.error("[backfill] Error:", message);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
