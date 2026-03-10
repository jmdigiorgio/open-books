/**
 * Postgres client for dashboard. Uses DATABASE_URL.
 *
 * The pool is stored on globalThis so that Next.js dev-mode hot reloads
 * reuse the same pool instead of orphaning connections until the DB
 * runs out of slots (which causes ECONNRESET errors).
 */

import { Pool } from "pg";

/* Extend globalThis so TypeScript knows about our cached pool. */
const globalForPg = globalThis as unknown as { __pgPool?: Pool };

export function getPool(): Pool {
  if (!globalForPg.__pgPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForPg.__pgPool = new Pool({
      connectionString: url,
      /* Railway (and most hosted Postgres) requires SSL; don't verify the proxy cert. */
      ssl: { rejectUnauthorized: false },
      /* Drop idle connections after 30 s so stale ones don't pile up. */
      idleTimeoutMillis: 30_000,
      /* Fail fast (5 s) instead of hanging for the default 10+ s. */
      connectionTimeoutMillis: 5_000,
      /* Cap total connections to avoid exhausting the server. */
      max: 10,
      /* TCP keepalive: detect dead sockets before the next query uses them. */
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });
  }
  return globalForPg.__pgPool;
}
