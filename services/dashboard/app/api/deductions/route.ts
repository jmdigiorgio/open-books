/**
 * /api/deductions – CRUD for deduction categories (Rent, Utilities, Internet, Phone, etc.) per year.
 *
 * GET  ?year=YYYY → list categories with monthly_amount and percentage for that year.
 * POST body: { year, categories: [{ category, monthly_amount, percentage }] } → save.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  ensureDeductionCategoriesTable,
  getDeductionCategories,
  saveDeductionCategories,
  DEDUCTION_CATEGORY_KEYS,
  DEDUCTION_CATEGORY_LABELS,
  type DeductionCategoryRow,
  type DeductionCategoryKey,
} from "@/lib/deductions";

export async function GET(request: NextRequest) {
  try {
    await ensureDeductionCategoriesTable();
    const yearParam = request.nextUrl.searchParams.get("year");
    const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
    if (Number.isNaN(year)) {
      return NextResponse.json({ error: "Invalid year" }, { status: 400 });
    }
    const categories = await getDeductionCategories(year);
    const withLabels = categories.map((row) => ({
      ...row,
      label: DEDUCTION_CATEGORY_LABELS[row.category as DeductionCategoryKey],
    }));
    return NextResponse.json({ year, categories: withLabels });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load deductions";
    console.error("[deductions] GET Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureDeductionCategoriesTable();
    const body = await request.json();
    const { year: bodyYear, categories: bodyCategories } = body;
    const year = typeof bodyYear === "number" ? bodyYear : parseInt(String(bodyYear), 10);
    if (Number.isNaN(year)) {
      return NextResponse.json({ error: "year is required" }, { status: 400 });
    }
    const categories: DeductionCategoryRow[] = Array.isArray(bodyCategories)
      ? bodyCategories
          .filter((c: unknown) => c && typeof c === "object" && DEDUCTION_CATEGORY_KEYS.includes((c as { category?: string }).category as DeductionCategoryKey))
          .map((c: { category: string; monthly_amount?: number; percentage?: number }) => ({
            category: c.category as DeductionCategoryKey,
            monthly_amount: Number(c.monthly_amount) || 0,
            percentage: Number(c.percentage) || 0,
          }))
      : [];
    if (categories.length === 0) {
      return NextResponse.json({ error: "categories array is required" }, { status: 400 });
    }
    await saveDeductionCategories(year, categories);
    return NextResponse.json({ ok: true, year });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save deductions";
    console.error("[deductions] POST Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
