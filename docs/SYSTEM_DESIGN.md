# OpenBooks — System Design

## Problem

Solo business owners manually track expenses, income, and mileage across spreadsheets for tax filing. This is tedious and error-prone.

**Goal**: Automate transaction tracking from a business bank account, classify transactions with AI, and expose everything in a simple dashboard.

---

## Scope

### MVP (current)

| Included | Deferred |
|----------|----------|
| Plaid Link to Novo business account | Mileage (MileIQ / TripLog integration) |
| Transaction sync (cursor-based, incremental) | AI classification (expense/income + tax category) |
| Local Postgres storage | Reports and export |
| Dashboard: view transactions by year | CSV import flows |
| Single-password auth | Multi-user accounts |

---

## Architecture

```
┌─────────────────┐
│  Plaid API       │  (Novo via /transactions/sync)
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Next.js API Routes                                     │
│  /api/plaid/sync — cursor-based sync (Plaid → Postgres) │
│  /api/plaid/link-token, exchange, status, disconnect     │
│  /api/transactions — read from Postgres (year filter)    │
└────────┬────────────────────────────────────┬───────────┘
         │                                    │
         ▼                                    ▼
┌─────────────────┐              ┌────────────────────────┐
│  Postgres        │              │  Dashboard UI           │
│  transactions    │              │  Tabs: Summary, Income, │
│  sync_state      │              │  Expenses, Mileage,     │
└─────────────────┘              │  Transactions            │
                                 └────────────────────────┘
```

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend + API | Next.js 16 (App Router, server components + API routes) |
| Database | Postgres 16 (Docker Compose locally; Railway for production) |
| Bank integration | Plaid SDK (`plaid` npm package, `/transactions/sync`) |
| Auth | Single shared password; HMAC cookie session (`DASHBOARD_PASSWORD`) |
| Token storage | Postgres (`plaid_link_state` table); single linked account |

---

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Bank provider | Plaid | Industry standard; supports Novo and most US banks. |
| Sync method | `/transactions/sync` (cursor-based) | Cost-efficient: first call gets all history, subsequent calls get only deltas. |
| Token storage | Postgres (`plaid_link_state` table) | Survives deploys and restarts; no ephemeral filesystem dependency. |
| Auth | Single password | No user accounts needed for a personal bookkeeping tool. |
| Deployment target | Railway | App + Postgres + env vars in one platform. |
| AI classification | Deferred to post-MVP | Get transaction flow working first; add AI layer on top. |
| Mileage | Deferred to post-MVP | Needs MileIQ or TripLog API integration. |

---

## Data Model

### `transactions`

Mirrors [Plaid's Transaction object](https://plaid.com/docs/api/products/transactions/#transactionssync). Primary key: `transaction_id` (Plaid's unique ID).

Key columns: `date`, `amount`, `merchant_name`, `name`, `pending`, `personal_finance_category`, `payment_channel`, `iso_currency_code`.

Full schema: [`db/01-init.sql`](../db/01-init.sql).

### `sync_state`

Single-row table (id locked to 1). Stores the Plaid sync `cursor` and `last_synced_at` timestamp. Used by `/api/plaid/sync` to resume incremental syncs.

### `plaid_link_state`

Single-row table (id locked to 1). Stores the Plaid `access_token`, `item_id`, and `institution_name` for the linked bank account.

---

## Sync Flow

1. **Trigger**: Page load (auto-sync when bank is linked) or manual Sync button.
2. **Read cursor**: Load the saved cursor from `sync_state` (empty on first run).
3. **Paginate**: Call Plaid `/transactions/sync` in a loop until `has_more` is false, collecting `added`, `modified`, and `removed` transactions.
4. **Upsert**: Insert or update all `added`/`modified` transactions in Postgres (`ON CONFLICT DO UPDATE`).
5. **Delete**: Remove any `removed` transaction IDs from Postgres.
6. **Save cursor**: Persist the new cursor and timestamp in `sync_state`.

No year filtering at sync time — all transactions are stored. The UI filters by year at query time.

---

## Dashboard

### Tab Structure

| Order | Tab | Purpose |
|-------|-----|---------|
| 1 | **Summary** | At-a-glance totals: income, expenses, net. (Placeholder.) |
| 2 | **Income** | Income transactions. (Placeholder.) |
| 3 | **Expenses** | Expense transactions, filters, categories. (Placeholder.) |
| 4 | **Mileage** | Mileage tracking and logs. (Post-MVP.) |
| 5 | **Transactions** | All synced transactions. Year filter, sync button, last-synced timestamp. |

### Header

- **OpenBooks** title (left).
- Status indicator (green dot = linked, gray = not linked) + institution name + **Link account** button + **Sign out** (right).

---

## Roadmap

1. **AI classification** — LLM-based categorization of transactions (expense/income + tax category). Override UI for corrections.
2. **Mileage** — MileIQ or TripLog API integration. Mileage tab becomes functional.
3. **Reports & export** — Summaries by category, CSV/PDF export for tax filing.
4. **Deploy** — Railway: Next.js app + Postgres + env vars.
