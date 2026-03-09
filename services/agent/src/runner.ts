/**
 * Two-pass runner: orchestrates the classification of all unclassified transactions.
 *
 * Pass 1: Classify each transaction using the base model (no web search).
 *         Transactions the model marks as "uncategorized" are collected for pass 2.
 *
 * Pass 2: Re-attempt classification of pass-1 uncategorized transactions using
 *         the `:online` model variant (web search enabled). The existing uncategorized
 *         row is deleted first so the agent can re-insert into income, deductions,
 *         or uncategorized with an updated reason.
 *
 * After both passes, a summary row is inserted into agent_runs.
 */

import { getPool } from "./db.js";
import { buildSystemMessage } from "./prompt.js";
import { fetchUnclassified } from "./unclassified.js";
import { runAgentLoop } from "./agent.js";
import type { UnclassifiedTransaction, RunResult } from "./types.js";

/** Env-driven delay between per-transaction calls (rate-limit protection). */
function getRequestDelay(): number {
  return Number(process.env.REQUEST_DELAY_MS) || 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** When true, the runner will exit after the current transaction (set by POST /run/cancel). */
let cancelRequested = false;

/** Set by the HTTP server when the client requests cancellation. */
export function requestCancel(): void {
  cancelRequested = true;
}

/** Reset at the start of each run so a previous cancel doesn't affect the next run. */
export function clearCancelRequested(): void {
  cancelRequested = false;
}

function isCancelRequested(): boolean {
  return cancelRequested;
}

/** Progress of the current (or last) run: items done, total, and description of item being worked on. */
let runProgress = { current: 0, total: 0, description: null as string | null };

export function getRunProgress(): { current: number; total: number; description: string | null } {
  return { ...runProgress };
}

function setRunProgress(current: number, total: number, description?: string | null): void {
  runProgress = { current, total, description: description ?? runProgress.description };
}

/** Resolve the base model slug from env, defaulting to gpt-4o. */
function getBaseModel(): string {
  return process.env.OPENROUTER_MODEL || "openai/gpt-4o";
}

/* ------------------------------------------------------------------ */
/*  agent_runs table                                                   */
/* ------------------------------------------------------------------ */

/** Create the agent_runs table if it doesn't already exist. */
async function ensureAgentRunsTable(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id serial PRIMARY KEY,
      started_at timestamptz NOT NULL,
      finished_at timestamptz,
      total_processed integer NOT NULL DEFAULT 0,
      income_count integer NOT NULL DEFAULT 0,
      deductions_count integer NOT NULL DEFAULT 0,
      uncategorized_count integer NOT NULL DEFAULT 0,
      error_count integer NOT NULL DEFAULT 0,
      errors jsonb NOT NULL DEFAULT '[]'
    )
  `);
}

/** Insert a completed run row into agent_runs. Returns the new row id. */
async function logRun(
  startedAt: Date,
  counts: Omit<RunResult, "runId">
): Promise<number> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO agent_runs
       (started_at, finished_at, total_processed, income_count, deductions_count, uncategorized_count, error_count, errors)
     VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      startedAt,
      counts.processed,
      counts.income,
      counts.deductions,
      counts.uncategorized,
      counts.errors,
      JSON.stringify(counts.errorDetails),
    ]
  );
  return rows[0].id;
}

/* ------------------------------------------------------------------ */
/*  User message builder                                               */
/* ------------------------------------------------------------------ */

/**
 * Build the user message that tells the model about one transaction.
 * @param tx          The transaction to classify.
 * @param isRetry     True in pass 2 (the model has web search context).
 */
function buildUserMessage(tx: UnclassifiedTransaction, isRetry: boolean): string {
  let msg =
    `Classify this transaction:\n` +
    `  transaction_id = ${tx.transaction_id}\n` +
    `  date           = ${tx.date}\n` +
    `  description    = ${tx.description}\n` +
    `  amount         = ${tx.amount}\n\n` +
    `Call exactly ONE of: insert_income, insert_deduction, or insert_uncategorized.`;

  if (isRetry) {
    msg +=
      `\n\nThis was previously uncategorized. You now have web search context. ` +
      `Re-evaluate carefully before classifying.`;
  }

  return msg;
}

/* ------------------------------------------------------------------ */
/*  Pass helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Determine whether the agent inserted into the uncategorized table for a
 * given transaction_id. Used after pass 1 to collect the retry list.
 */
async function isUncategorized(transactionId: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT 1 FROM uncategorized WHERE transaction_id = $1 LIMIT 1",
    [transactionId]
  );
  return rows.length > 0;
}

/**
 * Delete an uncategorized row so the agent can re-classify in pass 2.
 */
async function deleteUncategorized(transactionId: string): Promise<void> {
  const pool = getPool();
  await pool.query("DELETE FROM uncategorized WHERE transaction_id = $1", [transactionId]);
}

/**
 * Determine which table a transaction ended up in.
 * Returns the decision so we can increment the right counter.
 */
async function resolveDecision(
  transactionId: string
): Promise<"income" | "deduction" | "uncategorized" | null> {
  const pool = getPool();

  const inc = await pool.query("SELECT 1 FROM income WHERE proof = $1 LIMIT 1", [transactionId]);
  if (inc.rows.length > 0) return "income";

  const ded = await pool.query("SELECT 1 FROM deductions WHERE proof = $1 LIMIT 1", [transactionId]);
  if (ded.rows.length > 0) return "deduction";

  const unc = await pool.query("SELECT 1 FROM uncategorized WHERE transaction_id = $1 LIMIT 1", [transactionId]);
  if (unc.rows.length > 0) return "uncategorized";

  return null;
}

/* ------------------------------------------------------------------ */
/*  Main run function                                                  */
/* ------------------------------------------------------------------ */

/**
 * Execute a full classification run (both passes).
 * This is the entry point called by the HTTP handler.
 */
export async function runClassification(): Promise<RunResult> {
  await ensureAgentRunsTable();
  clearCancelRequested();

  const startedAt = new Date();
  const baseModel = getBaseModel();
  const onlineModel = `${baseModel}:online`;
  const systemMsg = await buildSystemMessage();

  /* ---- Fetch all unclassified transactions ---- */
  const unclassified = await fetchUnclassified();
  console.log(`[runner] Found ${unclassified.length} unclassified transaction(s)`);
  setRunProgress(0, unclassified.length);

  if (unclassified.length === 0) {
    const runId = await logRun(startedAt, {
      processed: 0,
      income: 0,
      deductions: 0,
      uncategorized: 0,
      errors: 0,
      errorDetails: [],
    });
    return { processed: 0, income: 0, deductions: 0, uncategorized: 0, errors: 0, errorDetails: [], runId };
  }

  /* Accumulators. */
  let incomeCount = 0;
  let deductionCount = 0;
  let uncategorizedCount = 0;
  let errorCount = 0;
  const errorDetails: Array<{ transaction_id: string; error: string }> = [];

  /* Collect tx IDs that land in uncategorized after pass 1 (for pass 2). */
  const pass2Queue: UnclassifiedTransaction[] = [];

  /* ---- Pass 1: base model, no web search ---- */
  console.log(`[runner] === Pass 1 (${baseModel}) ===`);

  let processedCount = 0;
  for (const tx of unclassified) {
    if (isCancelRequested()) {
      console.log("[runner] Cancel requested; stopping after pass 1");
      break;
    }
    setRunProgress(processedCount, unclassified.length, tx.description ?? null);
    try {
      const userMsg = buildUserMessage(tx, false);
      await runAgentLoop(baseModel, systemMsg, userMsg);
      processedCount++;
      setRunProgress(processedCount, unclassified.length);

      /* Check what the agent did. */
      const decision = await resolveDecision(tx.transaction_id);

      if (decision === "income") {
        incomeCount++;
        console.log(JSON.stringify({ pass: 1, transaction_id: tx.transaction_id, decision: "income", description: tx.description }));
      } else if (decision === "deduction") {
        deductionCount++;
        console.log(JSON.stringify({ pass: 1, transaction_id: tx.transaction_id, decision: "deduction", description: tx.description }));
      } else if (decision === "uncategorized") {
        /* Queue for pass 2 retry with web search. */
        pass2Queue.push(tx);
        console.log(JSON.stringify({ pass: 1, transaction_id: tx.transaction_id, decision: "uncategorized", description: tx.description }));
      } else {
        /* Agent didn't call any insert tool — treat as error. */
        errorCount++;
        errorDetails.push({ transaction_id: tx.transaction_id, error: "Agent did not call an insert tool" });
        console.error(JSON.stringify({ pass: 1, transaction_id: tx.transaction_id, error: "No insert tool called" }));
      }
    } catch (err: unknown) {
      errorCount++;
      const msg = err instanceof Error ? err.message : String(err);
      errorDetails.push({ transaction_id: tx.transaction_id, error: msg });
      console.error(JSON.stringify({ pass: 1, transaction_id: tx.transaction_id, error: msg }));
    }

    /* Courtesy delay before next transaction. */
    await sleep(getRequestDelay());
  }

  /* ---- Pass 2: :online model for pass-1 uncategorized ---- */
  if (pass2Queue.length > 0) {
    console.log(`[runner] === Pass 2 (${onlineModel}) — ${pass2Queue.length} transaction(s) ===`);

    for (const tx of pass2Queue) {
      if (isCancelRequested()) {
        console.log("[runner] Cancel requested; stopping during pass 2");
        break;
      }
      setRunProgress(processedCount, unclassified.length, tx.description ?? null);
      try {
        /* Remove the pass-1 uncategorized row so the agent can re-classify. */
        await deleteUncategorized(tx.transaction_id);

        const userMsg = buildUserMessage(tx, true);
        await runAgentLoop(onlineModel, systemMsg, userMsg);

        const decision = await resolveDecision(tx.transaction_id);

        if (decision === "income") {
          incomeCount++;
          console.log(JSON.stringify({ pass: 2, transaction_id: tx.transaction_id, decision: "income", description: tx.description }));
        } else if (decision === "deduction") {
          deductionCount++;
          console.log(JSON.stringify({ pass: 2, transaction_id: tx.transaction_id, decision: "deduction", description: tx.description }));
        } else if (decision === "uncategorized") {
          uncategorizedCount++;
          console.log(JSON.stringify({ pass: 2, transaction_id: tx.transaction_id, decision: "uncategorized", description: tx.description }));
        } else {
          errorCount++;
          errorDetails.push({ transaction_id: tx.transaction_id, error: "Agent did not call an insert tool (pass 2)" });
          console.error(JSON.stringify({ pass: 2, transaction_id: tx.transaction_id, error: "No insert tool called" }));
        }
      } catch (err: unknown) {
        errorCount++;
        const msg = err instanceof Error ? err.message : String(err);
        errorDetails.push({ transaction_id: tx.transaction_id, error: msg });
        console.error(JSON.stringify({ pass: 2, transaction_id: tx.transaction_id, error: msg }));
      }

      await sleep(getRequestDelay());
    }
  }

  /* ---- Log run to agent_runs ---- */
  const processed = incomeCount + deductionCount + uncategorizedCount + errorCount;
  const runId = await logRun(startedAt, {
    processed,
    income: incomeCount,
    deductions: deductionCount,
    uncategorized: uncategorizedCount,
    errors: errorCount,
    errorDetails,
  });

  console.log(`[runner] Run #${runId} complete: ${processed} processed, ${incomeCount} income, ${deductionCount} deductions, ${uncategorizedCount} uncategorized, ${errorCount} errors`);

  return {
    processed,
    income: incomeCount,
    deductions: deductionCount,
    uncategorized: uncategorizedCount,
    errors: errorCount,
    errorDetails,
    runId,
  };
}
