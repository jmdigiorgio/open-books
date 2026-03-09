/**
 * HTTP entry point for the classification agent.
 *
 * Exposes a single endpoint:
 *   POST /run — triggers a full classification run.
 *
 * Auth: If AGENT_API_KEY is set, the caller must send
 *   Authorization: Bearer <key>
 * If not set, the endpoint is open (local dev only).
 *
 * Also serves GET /health for container probes.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { runClassification, requestCancel, getRunProgress } from "./runner.js";
import { closePool } from "./db.js";

const PORT = Number(process.env.PORT) || 3001;

/* ------------------------------------------------------------------ */
/*  Auth helper                                                        */
/* ------------------------------------------------------------------ */

/**
 * Validate the Authorization header against AGENT_API_KEY.
 * Returns true if auth passes (or if no key is configured).
 */
function checkAuth(req: IncomingMessage): boolean {
  const expectedKey = process.env.AGENT_API_KEY;

  /* No key configured → endpoint is open (local dev). */
  if (!expectedKey) return true;

  const authHeader = req.headers.authorization ?? "";
  return authHeader === `Bearer ${expectedKey}`;
}

/* ------------------------------------------------------------------ */
/*  JSON response helpers                                              */
/* ------------------------------------------------------------------ */

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/* ------------------------------------------------------------------ */
/*  HTTP server                                                        */
/* ------------------------------------------------------------------ */

/** Track whether a run is already in progress (prevent concurrent runs). */
let running = false;

const server = createServer(async (req, res) => {
  const method = req.method ?? "";
  const url = req.url ?? "";

  /* ------ Health check ------ */
  if (method === "GET" && url === "/health") {
    jsonResponse(res, 200, { status: "ok" });
    return;
  }

  /* ------ GET /run/progress ------ */
  if (method === "GET" && url === "/run/progress") {
    if (!checkAuth(req)) {
      jsonResponse(res, 401, { error: "Unauthorized" });
      return;
    }
    const { current, total, description } = getRunProgress();
    jsonResponse(res, 200, { current, total, description: description ?? null });
    return;
  }

  /* ------ POST /run/cancel ------ */
  if (method === "POST" && url === "/run/cancel") {
    if (!checkAuth(req)) {
      jsonResponse(res, 401, { error: "Unauthorized" });
      return;
    }
    requestCancel();
    jsonResponse(res, 200, { ok: true, message: "Cancel requested" });
    return;
  }

  /* ------ POST /run ------ */
  if (method === "POST" && url === "/run") {
    /* Auth gate. */
    if (!checkAuth(req)) {
      jsonResponse(res, 401, { error: "Unauthorized" });
      return;
    }

    /* Prevent concurrent runs. */
    if (running) {
      jsonResponse(res, 409, { error: "A classification run is already in progress" });
      return;
    }

    /* Validate required env. */
    if (!process.env.DATABASE_URL) {
      jsonResponse(res, 500, { error: "DATABASE_URL is not set" });
      return;
    }
    if (!process.env.OPENROUTER_API_KEY) {
      jsonResponse(res, 500, { error: "OPENROUTER_API_KEY is not set" });
      return;
    }

    running = true;
    try {
      console.log("[server] Classification run started");
      const result = await runClassification();
      jsonResponse(res, 200, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[server] Classification run failed:", msg);
      jsonResponse(res, 500, { error: msg });
    } finally {
      running = false;
    }
    return;
  }

  /* ------ 404 for everything else ------ */
  jsonResponse(res, 404, { error: "Not found" });
});

/* ------------------------------------------------------------------ */
/*  Start + graceful shutdown                                          */
/* ------------------------------------------------------------------ */

server.listen(PORT, () => {
  console.log(`[server] Agent listening on http://localhost:${PORT}`);
  console.log(`[server] POST /run to trigger classification`);
  if (process.env.AGENT_API_KEY) {
    console.log(`[server] Auth enabled (AGENT_API_KEY is set)`);
  } else {
    console.log(`[server] Auth disabled (no AGENT_API_KEY — local dev mode)`);
  }
});

/* Graceful shutdown on SIGINT / SIGTERM. */
async function shutdown(): Promise<void> {
  console.log("\n[server] Shutting down...");
  server.close();
  await closePool();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
