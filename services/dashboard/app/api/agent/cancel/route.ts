/**
 * POST /api/agent/cancel — Tell the classification agent to stop the current run.
 * Proxies to the agent's POST /run/cancel.
 */

import { NextResponse } from "next/server";

export async function POST() {
  const base = process.env.AGENT_URL;
  const key = process.env.AGENT_API_KEY;

  if (!base) {
    return NextResponse.json({ error: "AGENT_URL is not set" }, { status: 500 });
  }

  const url = `${base.replace(/\/$/, "")}/run/cancel`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }

  try {
    const res = await fetch(url, { method: "POST", headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(data?.error ? { error: data.error } : { error: "Cancel failed" }, { status: res.status });
    }
    return NextResponse.json(data ?? { ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Cancel request failed";
    console.error("[agent/cancel]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
