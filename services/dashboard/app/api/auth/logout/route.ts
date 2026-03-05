import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth";

/** POST /api/auth/logout – Clear auth cookie and redirect to /login. */
export async function POST(request: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", request.url));
  res.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
