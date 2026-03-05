# OpenBooks – System Design

## Problem

- Manually enter **expenses**, **income**, and **mileage** into 3 tables for taxable income.
- Goal: automate daily pull from business bank (and later mileage), auto-classify with AI, store, and expose in a UI.

---

## Scope: Streamlined MVP

**MVP = bank only.** No CSV, no mileage in v1. Keep the project small and shippable.

| In MVP | Later |
|--------|--------|
| Plaid → Novo business account | Mileage when we integrate an app with an API (MileIQ or TripLog) |
| Transactions: fetch, store, dedupe | CSV/import flows only if we add them later |
| AI classification (expense/income + tax category) | Reports, export, few-shot from overrides |
| Minimal UI: list transactions, override category | |

---

## Confirmed Decisions

| Decision | Choice |
|----------|--------|
| Bank | **Plaid** (Novo business account). |
| Deployment | **Railway** (app + Postgres). |
| Classification | **AI from day one** (LLM per transaction; overrides stored). |
| Mileage | **Out of MVP.** Add when we use MileIQ or TripLog API. |
| Dashboard auth | **Single password** (no user accounts). Password in env (`DASHBOARD_PASSWORD`); cookie-based session after login. |

---

## High-Level Architecture (MVP)

```
┌─────────────────┐
│  Plaid (Novo)   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  DAILY JOB (Railway)                                              │
│  Fetch new transactions → dedupe by plaid_id → store              │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  AI CLASSIFICATION                                                │
│  LLM: merchant, amount, date → expense/income + tax category      │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Postgres (Railway)                                               │
│  accounts  •  transactions (with ai_category)  •  overrides       │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  UI (dashboard)                                                   │
│  List transactions  •  Filter  •  Override category               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Backend | Python (FastAPI) – Plaid, LLM calls. |
| DB | Postgres (Railway). |
| Scheduler | Railway cron or worker – daily sync. |
| AI | OpenAI API (configurable). |
| Frontend | Next.js (existing `services/dashboard`). |
| Secrets | Railway env vars. Dashboard: `DASHBOARD_PASSWORD` (single shared password; no username). |

---

## Data Model (MVP)

- **accounts** – Plaid-linked accounts (e.g. Novo business checking).
- **transactions** – date, amount, merchant, plaid_category, **ai_category** (expense/income + tax category), account_id, plaid_id (dedupe).
- **classification_overrides** – (transaction_id, user_category) for overrides; optional few-shot later.

*(Mileage table and sources come in a later phase.)*

---

## Phased Plan

1. **MVP**
   - Plaid link + fetch transactions; store in Postgres; daily job.
   - AI: classify each new transaction (expense/income + tax category); store overrides.
   - UI: list transactions, filter, edit category.
   - Deploy to Railway.

2. **Later (only after MVP is solid)**
   - Mileage via MileIQ or TripLog API (no CSV in scope).
   - Reports / export; use overrides as few-shot; anything else.

---

## Next Steps

1. Backend in `services/` (e.g. `services/api`): FastAPI, Plaid, Postgres, env template.
2. Plaid link flow + transactions sync + daily job.
3. AI classification for transactions.
4. Dashboard: single view of transactions + override; call backend API.
5. Railway: app + Postgres + cron.
