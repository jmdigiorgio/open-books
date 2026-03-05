/**
 * POST /api/plaid/exchange – Exchange Link public_token for access_token; store in file (no DB).
 * Body: { public_token: string, institution_name?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { exchangePublicToken } from "@/lib/plaid";
import { savePlaidAccessToken } from "@/lib/plaid-token";

export async function POST(request: NextRequest) {
  let body: { public_token?: string; institution_name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const publicToken = body.public_token?.trim();
  if (!publicToken) {
    return NextResponse.json({ error: "public_token required" }, { status: 400 });
  }

  try {
    const { accessToken, itemId } = await exchangePublicToken(publicToken);
    await savePlaidAccessToken(itemId, accessToken, body.institution_name);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    let message = "Exchange failed";
    if (e && typeof e === "object" && "response" in e) {
      const res = (e as { response?: { data?: { error_message?: string; error_code?: string } } }).response;
      message = res?.data?.error_message ?? res?.data?.error_code ?? message;
      console.error("[exchange] Plaid error:", res?.data);
    } else if (e instanceof Error) {
      message = e.message;
      console.error("[exchange] Error:", message);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
