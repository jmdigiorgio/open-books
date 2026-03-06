/**
 * PATCH /api/rules/[id] – Update a rule. Body: { content: string }.
 * DELETE /api/rules/[id] – Delete a rule.
 */

import { NextResponse } from "next/server";
import { updateRule, deleteRule } from "@/lib/rules";

function parseId(id: string): number | null {
  const n = parseInt(id, 10);
  return Number.isNaN(n) ? null : n;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await context.params;
    const id = parseId(idParam);
    if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const body = await request.json();
    const content = typeof body?.content === "string" ? body.content : "";
    const { updatedAt } = await updateRule(id, content);
    return NextResponse.json({ ok: true, updatedAt });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to update rule";
    if (message === "Rule not found")
      return NextResponse.json({ error: message }, { status: 404 });
    console.error("[rules] PATCH Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await context.params;
    const id = parseId(idParam);
    if (id === null) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    await deleteRule(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to delete rule";
    if (message === "Rule not found")
      return NextResponse.json({ error: message }, { status: 404 });
    console.error("[rules] DELETE Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
