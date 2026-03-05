/**
 * GET /api/plaid/sync – Trigger a Plaid transaction sync.
 * Pulls new/modified/removed transactions from Plaid into our Postgres DB.
 * Returns { added, modified, removed, syncedAt } on success.
 */

import { NextResponse } from "next/server";
import { syncTransactions } from "@/lib/sync";

export async function GET() {
  try {
    const result = await syncTransactions();
    return NextResponse.json(result);
  } catch (e: unknown) {
    /* Surface Plaid-specific error details if available. */
    let message = "Sync failed";
    if (e && typeof e === "object" && "response" in e) {
      const res = (
        e as { response?: { data?: { error_message?: string; error_code?: string } } }
      ).response;
      message = res?.data?.error_message ?? res?.data?.error_code ?? message;
      console.error("[sync] Plaid error:", res?.data);
    } else if (e instanceof Error) {
      message = e.message;
      console.error("[sync] Error:", message);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
