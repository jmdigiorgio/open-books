/**
 * POST /api/plaid/disconnect – Clear stored Plaid access token (unlink bank).
 */

import { NextResponse } from "next/server";
import { clearPlaidAccessToken } from "@/lib/plaid-token";

export async function POST() {
  try {
    await clearPlaidAccessToken();
    return NextResponse.json({ success: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Disconnect failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
