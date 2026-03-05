# OpenBooks

Open-source bookkeeping for solo businesses. Connect your bank via Plaid, sync transactions into a local Postgres database, and view everything in a clean dashboard.

Built for freelancers and sole proprietors who want to track income, expenses, and mileage without paying for QuickBooks.

## Features

- **Bank sync via Plaid** — Link your business bank account (e.g. Novo) through Plaid Link. First sync pulls all available history (up to 24 months); subsequent syncs fetch only new and modified transactions.
- **Local Postgres storage** — Transactions are stored locally in a Postgres database. The dashboard reads from the DB, not from Plaid, so page loads are fast and don't cost API calls.
- **Tabbed dashboard** — Summary, Income, Expenses, Mileage, and Transactions tabs. The Transactions tab displays a sortable table with year filtering and a manual Sync button.
- **Single-password auth** — No user accounts. One shared password protects the dashboard (cookie-based session).
- **Auto-sync on load** — When a bank is linked, the dashboard automatically syncs on page load to keep data fresh.

## Architecture

```
Plaid API ──► Next.js API routes ──► Postgres
                    │
                    ▼
              Dashboard UI
```

- **Frontend + API**: Next.js (App Router) in `services/dashboard/`.
- **Database**: Postgres 16 via Docker Compose.
- **Bank integration**: Plaid SDK (`plaid` npm package). Access token stored in the `plaid_link_state` table.
- **Sync**: Cursor-based via Plaid `/transactions/sync`. Cursor persisted in a `sync_state` table so incremental syncs are efficient.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Docker](https://www.docker.com/) (for Postgres)
- A [Plaid](https://dashboard.plaid.com/) account with API keys

## Quick Start

### 1. Start the database

```bash
docker compose up -d
```

This starts Postgres 16 on `localhost:5432` and runs `db/01-init.sql` to create the `transactions`, `sync_state`, and `plaid_link_state` tables.

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
| `PLAID_ENV` | No | `sandbox` (default), `development` (real bank), or `production`. |
| `DATABASE_URL` | Yes | Postgres connection string. Default: `postgresql://openbooks:openbooks@localhost:5432/openbooks`. |

### 3. Install and run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in, link your bank account via the header button, and navigate to the Transactions tab.

## Project Structure

```
open-books/
├── docker-compose.yml          # Postgres service
├── db/
│   └── 01-init.sql             # Schema: transactions + sync_state tables
└── services/
    └── dashboard/              # Next.js app
        ├── app/
        │   ├── (dashboard)/    # Main dashboard (tabs, transaction table)
        │   ├── login/          # Login page
        │   └── api/
        │       ├── auth/       # Login/logout endpoints
        │       ├── plaid/      # link-token, exchange, status, sync, disconnect
        │       └── transactions/ # Read transactions from DB (year filter)
        └── lib/
            ├── auth.ts         # Auth constants
            ├── db.ts           # Postgres pool
            ├── plaid.ts        # Plaid client, link token, exchange
            ├── plaid-token.ts  # Access token storage (Postgres)
            └── sync.ts         # Transaction sync (Plaid → Postgres)
```

## How Sync Works

1. **First sync** — No cursor exists. Plaid returns all available transaction history. Everything is inserted into the `transactions` table.
2. **Subsequent syncs** — The saved cursor is sent to Plaid. Only new, modified, and removed transactions are returned. The DB is updated accordingly (upsert/delete).
3. **No polling** — Sync runs on page load (auto) or when you click the Sync button. No background jobs or cron.

## Database Schema

**`transactions`** — Mirrors Plaid's [Transaction object](https://plaid.com/docs/api/products/transactions/#transactionssync). Primary key: `transaction_id`.

**`sync_state`** — Single-row table storing the Plaid sync cursor and last sync timestamp.

**`plaid_link_state`** — Single-row table storing the Plaid access token, item ID, and institution name for the linked bank account.

See [`db/01-init.sql`](db/01-init.sql) for the full schema.

## Roadmap

- [ ] AI classification (expense/income + tax category per transaction)
- [ ] Mileage tracking (MileIQ or TripLog integration)
- [ ] Reports and export
- [ ] Deploy to Railway

## License

MIT
