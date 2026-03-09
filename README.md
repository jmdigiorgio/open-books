# OpenBooks

Open-source bookkeeping for solo businesses and freelancers. Connect your bank via Plaid, sync transactions to Postgres, and manage income, deductions, mileage, and classification rules in a single dashboard.

Built for freelancers and sole proprietors who want to track income, deductions, and mileage without paying for QuickBooks.

## Features

- **Bank sync via Plaid** — Link your business bank account (e.g. Novo) through Plaid Link. First sync pulls available history (up to 24 months); subsequent syncs are incremental. Sync can be triggered manually or by a cron job.
- **Postgres storage** — Transactions, income, deductions, rules, and prompt are stored in Postgres. The dashboard reads from the DB for fast loads and no repeated Plaid API cost.
- **Tabbed dashboard** — Summary, Income, Deductions, Mileage, Transactions, Rules, and Prompt. Transactions tab: sortable table, year filter, Sync button. Rules: per-rule CRUD for classification overrides. Prompt: system prompt for the classification agent.
- **Income & deductions tables** — Schema aligned with IRS-style records (date, payer/payee, description, amount, proof). Ready for an agent or manual entry to classify transactions from the `transactions` table.
- **Single-password auth** — No user accounts. One shared password protects the dashboard (cookie-based session).

## Architecture

```
Plaid API ──► Next.js API routes ──► Postgres
                    │
                    ▼
              Dashboard UI
```

- **Frontend + API**: Next.js 16 (App Router) in `services/dashboard/`.
- **Database**: Postgres 16 (Docker Compose locally; Railway or any Postgres in production).
- **Bank integration**: Plaid SDK (`plaid` npm package). Access token stored in `plaid_link_state`.
- **Sync**: Cursor-based via Plaid `/transactions/sync`; cursor in `sync_state`.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Docker](https://www.docker.com/) (optional; for local Postgres)
- [Plaid](https://dashboard.plaid.com/) account and API keys (for bank linking)

## Quick Start

### 1. Database

**Option A — Local (Docker)**

```bash
docker compose up -d
```

Postgres 16 runs on `localhost:5432`. On first start, `db/01-init.sql` creates the schema (transactions, sync_state, plaid_link_state, agent_rules, agent_prompt, income, deductions).

**Option B — Existing Postgres (e.g. Railway)**

Use your `DATABASE_URL`. For existing DBs that don’t run `01-init.sql`, use the one-time script to ensure `income` and `deductions` exist:

```bash
cd services/dashboard
node scripts/ensure-income-deductions.js
```

Script reads `DATABASE_URL` from `.env.local`; creates `income` and `deductions` if missing; migrates from legacy `expenses` table if present.

### 2. Configure environment

```bash
cd services/dashboard
cp .env.example .env.local
```

Edit `.env.local`:

| Variable | Required | Description |
|----------|----------|-------------|
| `DASHBOARD_PASSWORD` | No | Dashboard login password. Defaults to `dev` if unset. |
| `PLAID_CLIENT_ID` | Yes | From [dashboard.plaid.com](https://dashboard.plaid.com/) → Keys. |
| `PLAID_SECRET` | Yes | Sandbox, Development, or Production secret. |
| `PLAID_ENV` | No | `sandbox` (default), `development`, or `production`. |
| `DATABASE_URL` | Yes | Postgres connection string. Local default: `postgresql://openbooks:openbooks@localhost:5432/openbooks`. |

### 3. Install and run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in, link your bank via the header, then use the Transactions tab to sync and view data.

## Project Structure

```
open-books/
├── docker-compose.yml          # Postgres (optional)
├── db/
│   └── 01-init.sql            # Full schema (transactions, sync_state, plaid_link_state,
│                              # agent_rules, agent_prompt, income, deductions)
├── docs/
│   └── SYSTEM_DESIGN.md       # Architecture and data model
└── services/
    └── dashboard/             # Next.js app
        ├── app/
        │   ├── (dashboard)/   # Main dashboard (tabs, tables)
        │   ├── login/
        │   └── api/
        │       ├── auth/           # Login / logout
        │       ├── plaid/          # link-token, exchange, status, sync, disconnect
        │       ├── transactions/   # Read transactions (year filter)
        │       ├── income/         # List income rows
        │       ├── deductions/     # List deduction rows
        │       ├── rules/          # CRUD for agent_rules
        │       ├── rules/[id]      # PATCH/DELETE single rule
        │       ├── prompt/         # GET/PUT agent_prompt
        │       └── mileage/        # GET mileage table; upload CSV
        ├── lib/                # db, plaid, sync, auth, rules, prompt, income, deductions, mileage
        └── scripts/
            └── ensure-income-deductions.js   # One-time: create income + deductions tables
```

## Database Schema (summary)

| Table | Purpose |
|-------|---------|
| `transactions` | Plaid transaction sync; mirrors Plaid Transaction object. |
| `sync_state` | Single row: Plaid sync cursor and last_synced_at. |
| `plaid_link_state` | Single row: Plaid access token, item ID, institution name. |
| `agent_rules` | One row per classification rule (CRUD); agent reads these. |
| `agent_prompt` | Single row: system prompt for the classification agent. |
| `income` | Classified income rows (date, name, description, amount, proof → transaction_id). |
| `deductions` | Classified deduction rows (same shape). |

See [`db/01-init.sql`](db/01-init.sql) for the full schema.

## Classification agent

The classification agent runs as a separate service (see `services/agent`). It is triggered **manually only** from the dashboard via the **Classify** button (✦ Classify) in the tab bar. No cron or scheduled runs. The agent reads the system prompt from `services/agent/prompt.md`, rules from `agent_rules` in the DB, and classifies unclassified transactions into `income`, `deductions`, or `uncategorized`.

Transaction sync from Plaid is separate (manual Sync or your own trigger) so the agent doesn’t spend tokens on syncing.

## Scripts

| Script | Purpose |
|--------|--------|
| `node scripts/ensure-income-deductions.js` | One-time: create `income` and `deductions` tables; migrate from `expenses` if present. Run from `services/dashboard` with `DATABASE_URL` in env or `.env.local`. |

## License

MIT
