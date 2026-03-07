# Transaction Classification Agent — Design

This document designs an agent that classifies each uncategorized transaction as **income**, **business expense (deduction)**, or **uncategorized**, and writes to the appropriate table. It extends the existing [Classification Agent design](SYSTEM_DESIGN.md#classification-agent-design) with three-way classification, web search, and an uncategorized table.

---

## 1. Purpose

- **Input**: Rows in `transactions` that are not yet classified (not in `income.proof`, `deductions.proof`, or `uncategorized.transaction_id`).
- **Output**: For each transaction, exactly one of:
  - One row in **income** (payer/source, IRS-style description, date, amount, proof),
  - One row in **deductions** (payee, IRS-style description, date, amount, proof),
  - One row in **uncategorized** (transaction_id, date, description, amount, reason).

The agent must **not** rely on debit/credit alone: a credit can be non-income (e.g. refund), and a debit can be non-deductible (e.g. personal). It uses the transaction **description** (and optional web search) to decide.

---

## 2. API provider and bootstrap

- **LLM API**: [OpenRouter](https://openrouter.ai/) is the API provider. The agent calls OpenRouter for chat/completion when classifying transactions (and optionally for search summarization).
- **First step**: The agent **always** starts by reading the **`agent_prompt`** table (single row, `id = 1`). The `content` column is the system/instruction prompt that defines what the agent is supposed to do. No classification work happens until this prompt is loaded.
- **Rules**: After loading the prompt, the agent loads **`agent_rules`** (ordered by `sort_order`, then `id`). Rules are overrides and business-specific guidance the agent must apply when classifying. The combined prompt + rules form the full instruction context for the LLM.

---

## 3. Schema Additions

### 3.1 Description field for transactions

The prompt refers to a "Description" column. In the DB, use a single **description** value derived from Plaid fields:

- **Preferred**: `COALESCE(transactions.merchant_name, transactions.name, transactions.original_description, '')`
- Expose this as `description` in any API or payload the agent consumes so the prompt wording matches.

### 3.2 Uncategorized table

Store transactions the agent could not classify (after attempting research).

| Column           | Type    | Purpose |
|------------------|---------|--------|
| `id`             | serial  | Primary key. |
| `transaction_id` | text    | FK to `transactions.transaction_id`; UNIQUE so one row per transaction. |
| `date`           | date    | Copy from transaction. |
| `description`    | text    | Copy of the transaction description (see 2.1). |
| `amount`         | numeric | Copy from transaction. |
| `reason`         | text    | Brief explanation why the agent could not categorize (e.g. "Ambiguous merchant; could be personal or business."). |
| `created_at`     | timestamptz | When the row was inserted. |

- **Constraint**: `transaction_id` UNIQUE and REFERENCES `transactions(transaction_id)` (or no FK if you want to allow orphans; UNIQUE still required so a transaction is only in uncategorized once).

---

## 4. Definition of “uncategorized” (unclassified) transaction

A transaction is **unclassified** for a run of the agent iff:

- Its `transaction_id` does **not** appear in `income.proof`, and  
- Does **not** appear in `deductions.proof`, and  
- Does **not** appear in `uncategorized.transaction_id`.

The agent processes only these. After a successful run, each processed transaction appears in exactly one of income, deductions, or uncategorized.

---

## 5. Agent flow (per transaction)

High level:

1. **Bootstrap**: Load system prompt from **`agent_prompt`** (first thing; defines the task). Then load rules from **`agent_rules`** (ordered by `sort_order`, `id`).
2. **Fetch** all unclassified transactions (and optional batch size / ordering).
3. **For each** unclassified transaction:
   - **Classify**: income vs business expense vs uncategorized.
   - **If unsure**: run a **web search** using the transaction description (and optionally amount/date context), then re-classify.
   - **Act**:
     - **Income** → insert into `income`.
     - **Business expense** → insert into `deductions`.
     - **Uncategorized** → insert into `uncategorized` (only after attempting research; if no research was done, the agent must search first, then possibly still mark uncategorized with a reason).

### 5.1 Income branch

1. Insert one row into **income**.
2. **Payer/source** (`income.name`): Infer from transaction description (e.g. "Lyft" → "Lyft").
3. **Description** (`income.description`): IRS-compliant description of the source (e.g. "Rideshare driver income").
4. **Date / amount**: Copy from `transactions.date`, `transactions.amount`.
5. **Proof** (`income.proof`): Set to `transactions.transaction_id`.

### 5.2 Deduction (business expense) branch

1. Insert one row into **deductions**.
2. **Payee** (`deductions.name`): Infer from transaction description (e.g. "Tradingviewm Product" → "TradingView").
3. **Description** (`deductions.description`): IRS-compliant description of the expense.
4. **Date / amount**: Copy from transaction.
5. **Proof** (`deductions.proof`): Set to `transactions.transaction_id`.

(Note: the payee column lives on the **deductions** table, not the income table.)

### 5.3 Uncategorized branch

1. **Precondition**: The agent must have attempted to research the transaction (e.g. web search) before giving up. If it did not, it should search first and re-evaluate.
2. Insert one row into **uncategorized** with:
   - `transaction_id`, `date`, `description`, `amount` copied from the transaction (description = derived description from §3.1).
   - `reason`: Short explanation why it could not be categorized (e.g. "Merchant name ambiguous; could not determine if business or personal.").
3. Then move on to the next transaction.

---

## 6. Tools / capabilities the agent needs

| Capability        | Purpose |
|-------------------|--------|
| **Read unclassified transactions** | Query transactions where `transaction_id` not in income.proof, deductions.proof, uncategorized.transaction_id; return at least transaction_id, date, amount, and derived description. |
| **Read agent_prompt** | **First**: system/instruction text from `agent_prompt.content` (defines what the agent does). |
| **Read agent_rules** | Ordered list of rule strings from `agent_rules` (e.g. `getRulesContent()` or equivalent); loaded after prompt. |
| **Web search** | Query the internet using the transaction description (and optionally amount/date) when the agent is unsure. |
| **Insert income** | One row: date, name (payer/source), description, amount, proof=transaction_id. |
| **Insert deduction** | One row: date, name (payee), description, amount, proof=transaction_id. |
| **Insert uncategorized** | One row: transaction_id, date, description, amount, reason. |

The agent can be implemented as a Cursor/IDE agent (MCP or API + DB) or as a backend job. The chosen deployment is a **separate Railway service** (see below).

---

## 7. Deployment: agent as its own Railway service

The classification agent runs as **its own Railway service**, separate from the Next.js dashboard.

- **Why separate**: The agent uses an LLM (OpenRouter), optional web search, and longer-running per-transaction work. Running it as its own service keeps the dashboard responsive, isolates failures, and allows independent scaling and scheduling (e.g. cron or queue-driven runs).
- **Shared DB**: The agent connects to the same Postgres database as the dashboard (e.g. same `DATABASE_URL`). It reads `transactions`, `agent_prompt`, `agent_rules` and writes to `income`, `deductions`, and `uncategorized`. No direct HTTP calls between dashboard and agent are required; coordination is via the database.
- **Trigger**: The agent can be triggered by a Railway cron job, an external scheduler hitting an HTTP endpoint, or a manual run. How it is triggered is left to the implementation.
- **Secrets**: The Railway service needs at least `DATABASE_URL` and OpenRouter (or other LLM) API keys; web search may require additional keys depending on the provider.

---

## 8. Idempotency and re-runs

- **Same transaction never written twice**: Enforce at DB level (UNIQUE on `income.proof`, `deductions.proof`, `uncategorized.transaction_id`). The agent must only insert for transactions that are currently unclassified.
- **Re-classification**: If a human later moves a transaction from uncategorized to income/deductions (or corrects a classification), that would require either: (a) deleting the old row and re-running the agent for that transaction, or (b) a separate “reclassify” flow. Out of scope for this design; the agent only adds new classifications.

---

## 9. IRS-compliant descriptions (guidance for prompt)

- **Income**: Short, factual description of the source (e.g. "Freelance design fee", "Rideshare driver income", "Interest income").
- **Deductions**: Short, factual description of the business purpose (e.g. "Software subscription for business use", "Office supplies", "Professional subscription").  
The stored prompt in `agent_prompt` can include this guidance and examples so the model produces consistent, audit-friendly text.

---

## 10. Error handling and observability

- **Partial progress**: Process transactions one-by-one (or in small batches); commit after each insert so a failure does not roll back prior classifications.
- **Duplicates**: Rely on UNIQUE constraints; agent should not insert if the transaction is already in income/deductions/uncategorized (query unclassified at start of run or before each insert).
- **Logging**: Log each decision (transaction_id → income | deduction | uncategorized) and, for uncategorized, the reason. Optionally store run metadata (e.g. run_id, started_at, finished_at, counts) in a separate table for debugging and auditing.

---

## 11. Agent prompt (source of truth)

The agent instructions come from `agent_prompt.content` in the database. Edit the prompt in the dashboard Prompt tab. It should define the three outcomes (income, deduction, uncategorized), require web search when unsure, and specify how to fill each table. Combine with ordered agent_rules when building the full system prompt sent to the LLM.


---

## 12. Summary

| Item | Decision |
|------|----------|
| **Unclassified** | transaction_id not in income.proof, deductions.proof, or uncategorized.transaction_id. |
| **New table** | `uncategorized` (id, transaction_id, date, description, amount, reason, created_at). |
| **Description** | Use COALESCE(merchant_name, name, original_description) from transactions. |
| **Flow** | Load prompt + rules → for each unclassified txn: classify (with web search if unsure) → insert into income, deductions, or uncategorized. |
| **Deployment** | Agent runs as its own Railway service; shared Postgres with dashboard; trigger via cron, HTTP, or manual. |
| **Idempotency** | Only insert for currently unclassified transactions; UNIQUE constraints prevent double inserts. |
