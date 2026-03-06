/**
 * GET /api/rules – Return the agent rules markdown content and updated_at.
 * PUT /api/rules – Update the content. Body: { content: string }.
 */

import { NextResponse } from "next/server";
import { getRulesContent, setRulesContent } from "@/lib/rules";

export async function GET() {
  try {
    const { content, updatedAt } = await getRulesContent();
    return NextResponse.json({ content, updatedAt });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load rules";
    console.error("[rules] GET Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const content = typeof body?.content === "string" ? body.content : "";
    await setRulesContent(content);
    const { updatedAt } = await getRulesContent();
    return NextResponse.json({ ok: true, updatedAt });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save rules";
    console.error("[rules] PUT Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
