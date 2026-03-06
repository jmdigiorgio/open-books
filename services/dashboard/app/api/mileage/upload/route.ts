/**
 * POST /api/mileage/upload – Upload a CSV file for the mileage table.
 *
 * - If the mileage table does not exist: create it with columns derived from the CSV header
 *   (sanitized names), then insert all rows.
 * - If the table exists and the CSV has a different set/order of columns: return 400.
 * - If the table exists and columns match: truncate and replace all rows with the CSV data.
 *
 * Body: multipart/form-data with a single file field (e.g. "file").
 */

import { NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import {
  getSanitizedColumns,
  mileageTableExists,
  getMileageColumnNames,
  createMileageTable,
  replaceMileageRows,
} from "@/lib/mileage";

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    const text = await file.text();
    /* Parse CSV: first row as headers, get records as array of arrays to preserve column order. */
    const raw = parse(text, { relax_column_count: true, trim: true });
    if (!Array.isArray(raw) || raw.length === 0) {
      return NextResponse.json({ error: "CSV is empty or invalid" }, { status: 400 });
    }
    const rawHeaders = raw[0] as string[];
    const dataRows = raw.slice(1) as string[][];
    const sanitizedColumns = getSanitizedColumns(rawHeaders);

    const exists = await mileageTableExists();
    if (exists) {
      const existingColumns = await getMileageColumnNames();
      if (!arraysEqual(sanitizedColumns, existingColumns)) {
        return NextResponse.json(
          {
            error:
              "Mileage table already exists with a different structure. " +
              "Expected columns (order matters): " +
              existingColumns.join(", ") +
              ". CSV columns: " +
              sanitizedColumns.join(", ") +
              ".",
          },
          { status: 400 }
        );
      }
      /* Build rows keyed by sanitized column name; values by index. */
      const rows: Record<string, string>[] = dataRows.map((values) => {
        const row: Record<string, string> = {};
        sanitizedColumns.forEach((col, i) => {
          row[col] = values[i] ?? "";
        });
        return row;
      });
      await replaceMileageRows(sanitizedColumns, rows);
      return NextResponse.json({ ok: true, rowsReplaced: rows.length });
    }

    /* Table does not exist: create it and insert. */
    await createMileageTable(sanitizedColumns);
    const rows: Record<string, string>[] = dataRows.map((values) => {
      const row: Record<string, string> = {};
      sanitizedColumns.forEach((col, i) => {
        row[col] = values[i] ?? "";
      });
      return row;
    });
    await replaceMileageRows(sanitizedColumns, rows);
    return NextResponse.json({ ok: true, tableCreated: true, rowsInserted: rows.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed";
    console.error("[mileage/upload] Error:", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
