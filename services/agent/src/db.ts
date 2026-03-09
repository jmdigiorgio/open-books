/**
 * Postgres connection pool for the agent service.
 * Uses the same DATABASE_URL as the dashboard (shared DB).
 */

import pg from "pg";
const { Pool } = pg;

/** Singleton pool instance, created on first call to getPool(). */
let pool: pg.Pool | null = null;

/**
 * Return (or create) the shared Postgres pool.
 * Throws if DATABASE_URL is not set.
 */
export function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

/**
 * Gracefully shut down the pool (for clean exits).
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
