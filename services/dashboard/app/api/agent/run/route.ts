/**
 * POST /api/agent/run — Proxy to the classification agent's POST /run.
 * Requires AGENT_URL and AGENT_API_KEY in env. Long-running; runs until the agent finishes or is cancelled.
 */

import { NextResponse } from "next/server";

export async function POST() {
  const base = process.env.AGENT_URL;
  const key = process.env.AGENT_API_KEY;

  if (!base) {
    return NextResponse.json({ error: "AGENT_URL is not set" }, { status: 500 });
  }

  const url = `${base.replace(/\/$/, "")}/run`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(600_000), // 10 min max
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(data?.error ? { error: data.error } : { error: "Agent run failed" }, { status: res.status });
    }
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Agent run failed";
    console.error("[agent/run]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
