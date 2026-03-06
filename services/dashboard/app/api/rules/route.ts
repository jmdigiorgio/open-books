/**
 * GET /api/rules – List all rules (one row per rule).
 * POST /api/rules – Create a rule. Body: { content: string, sortOrder?: number }.
 */

import { NextResponse } from "next/server";
import { listRules, createRule } from "@/lib/rules";

export async function GET() {
  try {
    const rules = await listRules();
    return NextResponse.json({ rules });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load rules";
    console.error("[rules] GET Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const content = typeof body?.content === "string" ? body.content : "";
    const sortOrder = typeof body?.sortOrder === "number" ? body.sortOrder : undefined;
    const rule = await createRule(content, sortOrder);
    return NextResponse.json(rule);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create rule";
    console.error("[rules] POST Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
