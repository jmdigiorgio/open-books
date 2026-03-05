/**
 * Postgres client for dashboard. Uses DATABASE_URL.
 * Used when we sync Plaid transactions into the transactions table.
 */

import { Pool } from "pg";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString: url });
  }
  return pool;
}
