/**
 * GET /api/plaid/link-token – Create a Plaid link_token for initializing Link on the frontend.
 * Returns { link_token: string }. Requires PLAID_CLIENT_ID and PLAID_SECRET.
 */

import { NextResponse } from "next/server";
import { createLinkToken } from "@/lib/plaid";

function getPlaidErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "response" in e) {
    const res = (e as { response?: { data?: { error_message?: string; error_code?: string } } }).response;
    const msg = res?.data?.error_message ?? res?.data?.error_code;
    if (msg) return msg;
  }
  return e instanceof Error ? e.message : "Failed to create link token";
}

export async function GET() {
  try {
    const linkToken = await createLinkToken();
    return NextResponse.json({ link_token: linkToken });
  } catch (e) {
    const message = getPlaidErrorMessage(e);
    const status = e && typeof e === "object" && "response" in e
      ? (e as { response?: { status?: number } }).response?.status ?? 500
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
