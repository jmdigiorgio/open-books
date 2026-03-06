import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth";

/** POST /api/auth/logout – Clear auth cookie and redirect to /login. */
export async function POST(request: NextRequest) {
  /* Use forwarded host/proto when behind a proxy (e.g. Railway) so redirect stays on the deployed origin. */
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    new URL(request.url).host;
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (request.url.startsWith("https") ? "https" : "http");
  const origin = `${proto}://${host}`;
  const res = NextResponse.redirect(new URL("/login", origin));
  res.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
