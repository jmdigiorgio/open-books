/**
 * GET /api/plaid/status – Whether a bank is linked and its institution name.
 * Returns { linked: boolean, institution_name?: string | null }.
 */

import { NextResponse } from "next/server";
import { getPlaidLinkState, hasPlaidAccessToken } from "@/lib/plaid-token";

export async function GET() {
  try {
    const linked = await hasPlaidAccessToken();
    const state = linked ? await getPlaidLinkState() : null;
    return NextResponse.json({
      linked,
      institution_name: state?.institutionName ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Status check failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
