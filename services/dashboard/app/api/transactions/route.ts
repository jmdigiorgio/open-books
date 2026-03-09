/**
 * GET /api/transactions – Read transactions from the local Postgres DB.
 *
 * Query params:
 *   ?year=YYYY  – filter to a specific year (defaults to current year).
 *   ?year=all   – return every transaction regardless of date.
 *
 * Also returns the list of distinct years present in the DB (for the UI dropdown)
 * and the last sync timestamp from sync_state.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const pool = getPool();
    const yearParam = request.nextUrl.searchParams.get("year");

    /* Determine which year to filter on. */
    const currentYear = new Date().getFullYear();
    const filterYear =
      yearParam === "all"
        ? null
        : yearParam && /^\d{4}$/.test(yearParam)
          ? parseInt(yearParam, 10)
          : currentYear;

    /* Fetch transactions, optionally filtered by year, ordered newest first. */
    let transactionsQuery: string;
    let transactionsParams: unknown[];

    if (filterYear !== null) {
      transactionsQuery =
        "SELECT * FROM transactions WHERE EXTRACT(YEAR FROM date) = $1 ORDER BY date DESC, name ASC";
      transactionsParams = [filterYear];
    } else {
      transactionsQuery = "SELECT * FROM transactions ORDER BY date DESC, name ASC";
      transactionsParams = [];
    }

    /* Run queries in parallel: transactions, distinct years, and last sync time. */
    const [txnResult, yearsResult, syncResult] = await Promise.all([
      pool.query(transactionsQuery, transactionsParams),
      pool.query<{ year: number }>(
        "SELECT DISTINCT EXTRACT(YEAR FROM date)::int AS year FROM transactions ORDER BY year DESC"
      ),
      pool.query<{ last_synced_at: string | null }>(
        "SELECT last_synced_at FROM sync_state WHERE id = 1"
      ),
    ]);

    return NextResponse.json({
      transactions: txnResult.rows,
      years: yearsResult.rows.map((r) => r.year),
      lastSyncedAt: syncResult.rows[0]?.last_synced_at ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch transactions";
    console.error("[transactions] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
