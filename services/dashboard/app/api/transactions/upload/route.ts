/**
 * POST /api/transactions/upload – Import transactions from a bank CSV file.
 *
 * Body: multipart/form-data with:
 *   - "file"   – the CSV file
 *   - "format" – bank format identifier (e.g. "novo")
 *
 * The format determines how CSV columns are mapped to the transactions table.
 * Returns { parsed, inserted, skippedDuplicate } on success.
 * Existing Plaid-synced transactions are never overwritten.
 */

import { NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import { importCsv, SUPPORTED_FORMATS } from "@/lib/csv-import";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const format = (formData.get("format") as string | null) ?? "novo";

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate format is one we support.
    if (!SUPPORTED_FORMATS.includes(format)) {
      return NextResponse.json(
        { error: `Unsupported format "${format}". Supported: ${SUPPORTED_FORMATS.join(", ")}` },
        { status: 400 }
      );
    }

    const text = await file.text();

    // Parse CSV with headers so each row is a keyed object.
    const records: Record<string, string>[] = parse(text, {
      columns: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
    });

    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ error: "CSV is empty or invalid" }, { status: 400 });
    }

    // Delegate to the format-specific parser and importer.
    const result = await importCsv(format, records);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed";
    console.error("[transactions/upload] Error:", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
