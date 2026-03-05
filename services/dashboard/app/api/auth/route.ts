import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import {
  AUTH_COOKIE_NAME,
  AUTH_MESSAGE,
  DEV_FALLBACK_PASSWORD,
} from "@/lib/auth";

/**
 * POST /api/auth – Check password and set auth cookie.
 * Body: { password: string }
 * Uses DASHBOARD_PASSWORD from env; when unset (local dev), accepts DEV_FALLBACK_PASSWORD so you can test (e.g. "dev").
 */
export async function POST(request: NextRequest) {
  const envPassword = process.env.DASHBOARD_PASSWORD;
  const password = envPassword ?? DEV_FALLBACK_PASSWORD;

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const submitted = body.password ?? "";
  if (submitted !== password) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const token = createHmac("sha256", password).update(AUTH_MESSAGE).digest("hex");
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
