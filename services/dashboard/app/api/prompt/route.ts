/**
 * GET /api/prompt – Return the agent prompt content and updated_at.
 * PUT /api/prompt – Update the prompt. Body: { content: string }.
 */

import { NextResponse } from "next/server";
import { getPromptContent, setPromptContent } from "@/lib/prompt";

export async function GET() {
  try {
    const { content, updatedAt } = await getPromptContent();
    return NextResponse.json({ content, updatedAt });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load prompt";
    console.error("[prompt] GET Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const content = typeof body?.content === "string" ? body.content : "";
    const { updatedAt } = await setPromptContent(content);
    return NextResponse.json({ ok: true, updatedAt });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save prompt";
    console.error("[prompt] PUT Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
