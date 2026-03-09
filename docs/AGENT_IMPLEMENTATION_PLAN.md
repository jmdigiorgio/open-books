# Transaction Classification Agent — Implementation Plan

This plan builds the agent in **`services/agent`** per [AGENT_TRANSACTION_CLASSIFIER_DESIGN.md](AGENT_TRANSACTION_CLASSIFIER_DESIGN.md). The agent runs as a separate service, shares the dashboard's Postgres DB, and uses OpenRouter for the LLM. The agent can **use the internet** (via OpenRouter's built-in web search) and **CRUD our DB** (via tools we implement and expose to the model).

---

## 1. Prompt and rules: in the agent service

- **Prompt**: Lives in the agent codebase (`services/agent/prompt.md`). Defines the system instruction: three outcomes (income, deduction, uncategorized), no classification by debit/credit alone, how to fill each table. The dashboard's "Prompt" tab is **ignored**; the agent does not read `agent_prompt`.
- **Rules**: Agent reads `agent_rules` from the DB at startup and appends them to the system message. The dashboard "Rules" tab still drives behavior.

---

## 2. Internet: OpenRouter built-in web search (two-pass)

The agent uses the **internet** via **OpenRouter's built-in web search**. No separate search API or API key is required.

- **How**: Use a model with the **`:online`** suffix (e.g. `openai/gpt-4o:online`) or send the **`web`** plugin in the OpenRouter request. OpenRouter runs the search, injects results, and returns the model's response.
- **Cost**: ~$0.02 per request for web search on top of LLM usage.

### Two-pass approach (cost optimization)

OpenRouter's `:online` search fires on **every** request — the model doesn't choose when to search. Most transactions are obvious ("Chevron" is clearly a deduction) and don't need web context. Searching on every call wastes money.

**Solution: two passes.**

1. **Pass 1 (no search)**: Call the model **without** `:online` for each unclassified transaction. The model classifies based on description, amount, date, and its built-in knowledge. If confident → insert into income/deductions. If unsure → respond with `uncategorized` and a reason.
2. **Pass 2 (with search)**: For transactions the model marked `uncategorized` in pass 1, re-run **with** `:online` so the model gets web context. If the model can now classify → insert into income/deductions. If still unsure → insert into uncategorized with a reason.

This means only uncertain transactions cost the extra ~$0.02 for search, not every single one.

---

## 3. Tools: DB read/write (CRUD)

The agent gets explicit **read** and **write** tools for our DB. No generic "run SQL" tool; only these concrete tools.

| Tool | Purpose |
|------|--------|
| **read_income** | Read rows from `income` (e.g. limit 20). |
| **read_deductions** | Read rows from `deductions` (e.g. limit 20). |
| **read_uncategorized** | Read rows from `uncategorized` (e.g. limit 20). |
| **insert_income** | Insert one row into `income`: date, name (payer/source), description, amount, proof = transaction_id. |
| **insert_deduction** | Insert one row into `deductions`: date, name (payee), description, amount, proof = transaction_id. |
| **insert_uncategorized** | Insert one row into `uncategorized`: transaction_id, date, description, amount, reason. |

Future: update/delete tools can be added if we want the agent to correct or reclassify entries.

---

## 4. Flow: runner loops, agent handles one transaction

Our code fetches all unclassified transactions. For each transaction we run the agent with a single user message containing the transaction's date, description, amount, and transaction_id. The agent has DB tools and should call exactly one of `insert_income`, `insert_deduction`, `insert_uncategorized`.

We do **not** expose a `get_unclassified` tool. We inject the current transaction in the message and control the loop ourselves. This is simpler, more robust, and makes retries straightforward.

---

## 5. Repo layout

```
services/
  agent/
    package.json
    tsconfig.json
    .env.example
    prompt.md                    # System prompt (source of truth; not from DB)
    src/
      index.ts                   # HTTP server + POST /run handler
      db.ts                      # Postgres pool (DATABASE_URL)
      prompt.ts                  # Load prompt.md + agent_rules from DB → system message
      unclassified.ts            # Query unclassified transactions (derived description)
      tools/
        db-read.ts               # read_income, read_deductions, read_uncategorized
        db-write.ts              # insert_income, insert_deduction, insert_uncategorized
        definitions.ts           # Tool schemas (name, description, parameters) for OpenRouter
      agent.ts                   # OpenRouter chat loop with tool calls; execute tools and resume
      runner.ts                  # Two-pass orchestration: pass 1 (no search) → pass 2 (:online for uncategorized)
      types.ts
    Dockerfile
  dashboard/                     # existing; Prompt tab ignored for classifier
```

---

## 6. Data flow (per run)

1. **Trigger** (`POST /run`)
   - Validate auth (see §8).
   - Validate env: `DATABASE_URL`, `OPENROUTER_API_KEY`.

2. **System message**
   - Read `prompt.md` from the agent service.
   - Read `agent_rules` from DB (sort_order, id), append to system message.

3. **Fetch unclassified**
   - Query `transactions` where transaction_id not in income.proof, deductions.proof, uncategorized.transaction_id.
   - Derived description = `COALESCE(merchant_name, name, original_description, '')`.
   - Return list of `{ transaction_id, date, amount, description }`.

4. **Pass 1: classify without search**
   - For each unclassified transaction, call OpenRouter **without** `:online` (base model, e.g. `openai/gpt-4o`), with DB tools registered.
   - User message: "Classify this transaction: transaction_id=X, date=Y, description=Z, amount=W. Call exactly one of insert_income, insert_deduction, or insert_uncategorized."
   - When model returns tool_calls, execute them and continue until the model finishes.
   - Log the decision (see §9).

5. **Pass 2: retry uncategorized with search**
   - Collect transactions that were inserted into `uncategorized` during pass 1.
   - For each, delete the uncategorized row, then re-run the agent **with** `:online` (e.g. `openai/gpt-4o:online`).
   - User message: same as pass 1, but note "You now have web search context. Re-evaluate this transaction."
   - If the model now classifies as income/deduction → insert. If still uncategorized → re-insert into uncategorized with updated reason.

6. **Log run**
   - Insert a row into `agent_runs` with counts and timestamp (see §9).

7. **Response**
   - Return `{ processed, income, deductions, uncategorized, errors, runId }`.

---

## 7. OpenRouter: web search + tool calling

- **Tool calling**: Use OpenRouter's **chat completions** API with **tools** (function calling) for DB read/write. Define each tool (name, description, parameters JSON schema). When the response has `tool_calls`, we execute them and send results back; repeat until the model stops calling tools.
- **Web search**: In pass 2 only, use a model slug with **`:online`** (e.g. `openai/gpt-4o:online`) or the **`web`** plugin. OpenRouter injects search results automatically.
- **Rate limiting**: OpenRouter has rate limits. Process transactions sequentially (one at a time). If we hit a rate limit (429), back off and retry with exponential delay. Add a configurable delay between requests (e.g. `REQUEST_DELAY_MS`, default 500ms) to stay under limits.

---

## 8. When the agent runs (trigger + auth)

The agent does **not** run on its own. It runs **only when triggered manually** from the dashboard via the **Classify** button (which calls `POST /run`). No cron or scheduled runs.

- **Manual**: Dashboard "Classify" button (✦ Classify) in the tab bar. The dashboard proxies the request to the agent with `Authorization: Bearer <key>`. For local/dev, `curl -X POST http://localhost:3001/run -H "Authorization: Bearer <key>"` also works.

### Auth

The `/run` endpoint is protected with a shared secret (`AGENT_API_KEY` env var). The caller must send `Authorization: Bearer <key>` in the request header. If `AGENT_API_KEY` is not set, the endpoint is open (local dev only).

---

## 9. Logging and audit trail

A `agent_runs` table records each run for audit and debugging.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | serial | Primary key. |
| `started_at` | timestamptz | When the run began. |
| `finished_at` | timestamptz | When the run completed. |
| `total_processed` | integer | Number of transactions processed. |
| `income_count` | integer | Classified as income. |
| `deductions_count` | integer | Classified as deductions. |
| `uncategorized_count` | integer | Classified as uncategorized. |
| `error_count` | integer | Transactions that failed. |
| `errors` | jsonb | Array of `{ transaction_id, error }` for any failures. |

The agent creates this table if it doesn't exist (same pattern as the dashboard's ensure* functions). Each `POST /run` inserts one row at the end of the run.

Additionally, the agent logs each decision to stdout (structured JSON) so container logs capture: `{ transaction_id, decision, name, description }`.

---

## 10. Config / env

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres (same as dashboard). |
| `OPENROUTER_API_KEY` | OpenRouter API key (LLM + web search billed through OpenRouter). |
| `PORT` | HTTP server port (default 3001). |
| `OPENROUTER_MODEL` | Base model slug (default `openai/gpt-4o`). `:online` is appended automatically for pass 2. |
| `AGENT_API_KEY` | Shared secret for `/run` endpoint auth. If unset, endpoint is open (local dev). |
| `REQUEST_DELAY_MS` | Delay between OpenRouter requests in ms (default 500). Prevents rate limiting. |

---

## 11. Implementation order

| Step | Task |
|------|------|
| 1 | Create `services/agent`: package.json, tsconfig, .env.example. Add `prompt.md` with initial system prompt. |
| 2 | `src/db.ts`: getPool(). |
| 3 | `src/prompt.ts`: load prompt.md + load `agent_rules` from DB → combined system message. |
| 4 | `src/unclassified.ts`: query unclassified transactions with derived description. |
| 5 | `src/tools/definitions.ts`: tool schemas for OpenRouter (read_income, read_deductions, read_uncategorized, insert_income, insert_deduction, insert_uncategorized). |
| 6 | `src/tools/db-read.ts`: read_income(limit), read_deductions(limit), read_uncategorized(limit). |
| 7 | `src/tools/db-write.ts`: insert_income, insert_deduction, insert_uncategorized (single row each). |
| 8 | `src/agent.ts`: OpenRouter chat loop with tools; on tool_calls, dispatch and continue. |
| 9 | `src/runner.ts`: two-pass orchestration (pass 1 without search, pass 2 with :online for uncategorized). |
| 10 | `src/index.ts`: HTTP server; POST /run with auth check; call runner; log to agent_runs; return counts. |
| 11 | (Optional) Dockerfile for Railway. |

---

## 12. Error handling

- **Partial progress**: One transaction per conversation; on failure (OpenRouter or tool error), log the error, skip to the next transaction, and report it in the response and `agent_runs.errors`.
- **Rate limiting**: On 429 from OpenRouter, exponential backoff (1s, 2s, 4s, up to 30s). Max 3 retries per transaction before logging as error and moving on.
- **Duplicate inserts**: UNIQUE constraints on income.proof, deductions.proof, uncategorized.transaction_id prevent double inserts. The agent only processes transactions that are currently unclassified.
- **Empty prompt file**: If `prompt.md` is missing or empty, abort run with 400 and log the error.
- **No unclassified transactions**: If none found, return immediately with `{ processed: 0 }` and log to `agent_runs`.

---

## 13. Summary

- **Internet**: Agent uses **OpenRouter's built-in web search** (`:online` model), but only in **pass 2** for transactions that were uncertain in pass 1. This avoids paying for search on obvious transactions.
- **DB (CRUD)**: Agent has tools to **read** (`read_income`, `read_deductions`, `read_uncategorized`) and **write** (`insert_income`, `insert_deduction`, `insert_uncategorized`).
- **Prompt**: In the agent service (`prompt.md`); dashboard Prompt tab is ignored. Rules come from `agent_rules` in the DB.
- **Flow**: Runner loops over unclassified transactions. Pass 1: classify without search. Pass 2: retry uncategorized with `:online`. Each transaction gets exactly one insert.
- **Trigger**: Manual only — dashboard Classify button (or curl) calling `POST /run`.
- **Auth**: `/run` protected by `AGENT_API_KEY` (shared secret in header).
- **Logging**: `agent_runs` table records each run's counts and errors. Per-transaction decisions logged to stdout.
- **Rate limiting**: Sequential processing with configurable delay; exponential backoff on 429s.
- **Deploy**: Standalone service; same DB as dashboard.
