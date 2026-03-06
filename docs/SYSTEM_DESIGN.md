# OpenBooks — System Design

## Problem

Solo business owners manually track income, deductions, and mileage across spreadsheets for tax filing. This is tedious and error-prone.

**Goal**: Automate transaction ingestion from a business bank account, support classification of transactions as income or deduction (with room for AI/agent logic), and expose everything in a simple dashboard.

---

## Scope

### Implemented

| Area | Status |
|------|--------|
| Plaid Link (e.g. Novo business account) | Done |
| Transaction sync (cursor-based, incremental) | Done |
| Postgres storage (transactions, sync_state, plaid_link_state) | Done |
| Dashboard: Summary, Income, Deductions, Mileage, Transactions, Rules, Prompt | Done |
| Income and deductions tables (IRS-style: date, name, description, amount, proof) | Done |
| Agent rules (per-rule CRUD; agent_rules table) | Done |
| Agent prompt (single row; agent_prompt table) | Done |
| Mileage: CSV upload and table storage | Done |
| Single-password auth | Done |

### Deferred / Optional

| Area | Notes |
|------|--------|
| AI/agent execution | Prompt and rules are stored; an external agent or cron can read them and write to income/deductions. |
| Mileage API integration | MileIQ / TripLog; currently CSV upload. |
| Reports and export | CSV/PDF for tax filing. |
| Multi-user accounts | Single shared password for now. |

---

## Architecture

```
┌─────────────────┐
│  Plaid API      │  (e.g. Novo via /transactions/sync)
└────────┬────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Next.js API Routes                                                │
│  /api/plaid/sync, link-token, exchange, status, disconnect         │
│  /api/transactions  — read from Postgres (year filter)             │
│  /api/income        — list income rows                             │
│  /api/deductions    — list deduction rows                          │
│  /api/rules         — list/create rules; /api/rules/[id] PATCH/DEL │
│  /api/prompt        — GET/PUT agent prompt                        │
│  /api/mileage       — GET table; POST upload CSV                   │
└────────┬──────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Postgres                                                        │
│  transactions, sync_state, plaid_link_state                     │
│  agent_rules, agent_prompt, income, deductions                   │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Dashboard UI                                                    │
│  Tabs: Summary | Income | Deductions | Mileage | Transactions    │
│        | Rules | Prompt                                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend + API | Next.js 16 (App Router, API routes) |
| Database | Postgres 16 (Docker Compose locally; Railway or other in production) |
| Bank integration | Plaid SDK (`plaid` npm package, `/transactions/sync`) |
| Auth | Single shared password; HMAC cookie session (`DASHBOARD_PASSWORD`) |
| Token storage | Postgres `plaid_link_state`; single linked account |

---

## Data Model

### Core sync and link state

- **`transactions`** — Mirrors [Plaid Transaction object](https://plaid.com/docs/api/products/transactions/#transactionssync). Primary key: `transaction_id`.
- **`sync_state`** — Single row (id=1): Plaid sync `cursor`, `last_synced_at`.
- **`plaid_link_state`** — Single row (id=1): Plaid `access_token`, `item_id`, `institution_name`, `linked_at`.

### Classification and agent

- **`agent_rules`** — One row per rule. Columns: `id`, `content`, `sort_order`, `created_at`, `updated_at`. CRUD via API; agent reads these for overrides (e.g. “treat merchant X as income”).
- **`agent_prompt`** — Single row (id=1): `content`, `updated_at`. System prompt for the classification agent (e.g. “classify by amount sign; use agent_rules for overrides”).

### Classified output

- **`income`** — One row per transaction classified as income. Columns: `id`, `date`, `name`, `description`, `amount`, `proof` (FK to `transactions.transaction_id`), `created_at`.
- **`deductions`** — Same shape as `income`; one row per transaction classified as deduction.

Full schema: [`db/01-init.sql`](../db/01-init.sql).

---

## Sync Flow

1. **Trigger**: Manual Sync button or external call to `GET /api/plaid/sync` (e.g. cron).
2. **Cursor**: Read from `sync_state` (empty on first run).
3. **Plaid**: Call `/transactions/sync` until `has_more` is false; collect added/modified/removed.
4. **Upsert**: Insert/update added and modified rows in `transactions`.
5. **Delete**: Remove removed transaction IDs from `transactions`.
6. **Persist**: Save new cursor and timestamp in `sync_state`.

No year filtering at sync time; UI filters by year when reading.

---

## Dashboard

### Tab structure

| Order | Tab | Purpose |
|-------|-----|--------|
| 1 | Summary | Totals: income, deductions, mileage, taxable income (placeholder values where not yet driven by DB). |
| 2 | Income | IRS-style income records (placeholder table; can be wired to `GET /api/income`). |
| 3 | Deductions | IRS-style deduction records (placeholder table; can be wired to `GET /api/deductions`). |
| 4 | Mileage | CSV upload; table with columns from CSV. |
| 5 | Transactions | Synced Plaid transactions; year filter, Sync button, last-synced time. |
| 6 | Rules | Per-rule CRUD for classification overrides (backed by `agent_rules`). |
| 7 | Prompt | Edit system prompt for classification agent (backed by `agent_prompt`). |

### Header

OpenBooks title (left). Right: link status (green = linked), institution name, Link account, Sign out.

---

## Classification Agent (design)

Intended flow (agent not in this repo):

1. **Sync** is handled separately (cron or manual) so the agent does not spend tokens on it.
2. **Unexamined**: Transactions whose `transaction_id` is not in `income.proof` or `deductions.proof`.
3. **Prompt + rules**: Agent reads `agent_prompt.content` and `agent_rules` (ordered by `sort_order`, `id`).
4. **Classify**: For each unexamined transaction, decide income vs deduction (e.g. by amount sign + rules).
5. **Write**: Insert one row into `income` or `deductions` with `proof` = `transaction_id`, and copy `amount`, `date`, `name` (and optionally `description`) from the transaction.

---

## One-time setup for existing DBs

If Postgres was created before `income` and `deductions` were added to `01-init.sql`, run once from `services/dashboard`:

```bash
node scripts/ensure-income-deductions.js
```

This creates `income` and `deductions` if missing, adds `description` if absent, and migrates from legacy `expenses` table if present.

---

## Roadmap

1. **Agent integration** — Wire an LLM or rule engine to read prompt + rules and write to income/deductions.
2. **Mileage** — Optional MileIQ/TripLog API; keep CSV as fallback.
3. **Reports & export** — Summaries by category, CSV/PDF for taxes.
4. **Deploy** — e.g. Railway: Next.js app + Postgres + env vars.
