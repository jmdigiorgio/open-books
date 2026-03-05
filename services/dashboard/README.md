# Dashboard

Next.js application that serves the OpenBooks dashboard. Handles bank linking (Plaid), transaction sync, and the tabbed UI.

## Setup

See the [root README](../../README.md) for full setup instructions (Docker, env vars, etc.).

Quick start from this directory:

```bash
cp .env.example .env.local   # fill in your values
npm install
npm run dev                   # http://localhost:3000
```

## Auth

Protected by a single shared password. Set `DASHBOARD_PASSWORD` in `.env.local`. If unset, password `dev` is accepted for local testing. Cookie-based session (30-day expiry).

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/plaid/link-token` | Create a Plaid Link token for the frontend. |
| POST | `/api/plaid/exchange` | Exchange Link public token for access token; store in file. |
| GET | `/api/plaid/status` | Check if a bank is linked + institution name. |
| POST | `/api/plaid/disconnect` | Clear stored access token. |
| GET | `/api/plaid/sync` | Sync transactions from Plaid into Postgres. |
| GET | `/api/transactions?year=YYYY` | Read transactions from Postgres (defaults to current year). |
| POST | `/api/auth` | Login (password check). |
| POST | `/api/auth/logout` | Logout (clear cookie). |

## Environment Variables

See [`.env.example`](.env.example) for the full list and descriptions.
