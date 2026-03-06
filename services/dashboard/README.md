# Dashboard

Next.js application for the OpenBooks dashboard. Handles bank linking (Plaid), transaction sync, income/deductions tables, classification rules and prompt, mileage CSV upload, and the tabbed UI.

## Setup

See the [root README](../../README.md) for full setup (Docker or external Postgres, env vars, one-time scripts).

Quick start from this directory:

```bash
cp .env.example .env.local   # fill in DATABASE_URL, Plaid keys, etc.
npm install
npm run dev                   # http://localhost:3000
```

## Auth

Single shared password. Set `DASHBOARD_PASSWORD` in `.env.local`. If unset, `dev` is accepted for local use. Cookie-based session (30-day expiry).

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/plaid/link-token` | Create a Plaid Link token for the frontend. |
| POST | `/api/plaid/exchange` | Exchange Link public token for access token; store in Postgres (`plaid_link_state`). |
| GET | `/api/plaid/status` | Whether a bank is linked and institution name. |
| GET | `/api/plaid/sync` | Sync transactions from Plaid into Postgres. |
| POST | `/api/plaid/disconnect` | Clear stored access token. |
| GET | `/api/transactions?year=YYYY` | Read transactions from Postgres (default: current year; `year=all` for no filter). |
| GET | `/api/income` | List income rows (ensures table exists). |
| GET | `/api/deductions` | List deduction rows (ensures table exists; migrates from `expenses` if present). |
| GET | `/api/rules` | List all agent rules. |
| POST | `/api/rules` | Create a rule (body: `{ content, sortOrder? }`). |
| PATCH | `/api/rules/[id]` | Update a rule (body: `{ content }`). |
| DELETE | `/api/rules/[id]` | Delete a rule. |
| GET | `/api/prompt` | Get agent prompt content and updated_at. |
| PUT | `/api/prompt` | Update agent prompt (body: `{ content }`). |
| GET | `/api/mileage` | Get mileage table columns and rows. |
| POST | `/api/mileage/upload` | Upload CSV to create or replace mileage table. |
| POST | `/api/auth` | Login (password check). |
| POST | `/api/auth/logout` | Logout (clear cookie). |

## Scripts

| Script | Purpose |
|--------|--------|
| `node scripts/ensure-income-deductions.js` | One-time: create `income` and `deductions` tables; migrate from `expenses` if present. Requires `DATABASE_URL` (e.g. in `.env.local`). |

## Environment Variables

See [`.env.example`](.env.example) for the full list and descriptions.
