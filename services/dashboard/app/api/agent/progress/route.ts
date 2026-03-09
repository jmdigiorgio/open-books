/**
 * GET /api/agent/progress — Proxy to the agent's GET /run/progress.
 * Returns { current, total } for the current or last run.
 */

import { NextResponse } from "next/server";

export async function GET() {
  const base = process.env.AGENT_URL;
  const key = process.env.AGENT_API_KEY;

  if (!base) {
    return NextResponse.json({ error: "AGENT_URL is not set" }, { status: 500 });
  }

  const url = `${base.replace(/\/$/, "")}/run/progress`;
  const headers: Record<string, string> = {};
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }

  try {
    const res = await fetch(url, { method: "GET", headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(data?.error ? { error: data.error } : { error: "Progress failed" }, { status: res.status });
    }
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Progress request failed";
    console.error("[agent/progress]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
