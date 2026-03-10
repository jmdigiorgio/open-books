-- OpenBooks: single table matching Plaid Transaction shape (what we get from Novo via Plaid).
-- See Plaid API: /transactions/sync and Transaction object.

CREATE TABLE transactions (
  transaction_id text PRIMARY KEY,
  account_id text NOT NULL,
  amount numeric NOT NULL,
  iso_currency_code text,
  unofficial_currency_code text,
  date date NOT NULL,
  name text,
  merchant_name text,
  original_description text,
  pending boolean NOT NULL DEFAULT false,
  pending_transaction_id text,
  account_owner text,
  category_id text,
  authorized_date date,
  datetime timestamptz,
  payment_channel text,
  location jsonb,
  payment_meta jsonb,
  personal_finance_category jsonb
);

COMMENT ON TABLE transactions IS 'Plaid transactions; structure matches Plaid Transaction object from /transactions/sync.';

-- Stores the Plaid /transactions/sync cursor so incremental syncs only fetch new data.
-- Single-row table (id locked to 1) — one linked account.
CREATE TABLE sync_state (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cursor text,
  last_synced_at timestamptz
);

COMMENT ON TABLE sync_state IS 'Plaid transactionsSync cursor; single row tracks last sync position.';

-- Stores the Plaid access token and institution name for the linked bank account.
-- Single-row table (id locked to 1) — one linked account at a time.
CREATE TABLE plaid_link_state (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  access_token text NOT NULL,
  item_id text,
  institution_name text,
  linked_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE plaid_link_state IS 'Plaid access token and linked institution; single row for one bank account.';

-- One row per classification rule; agent reads these when classifying transactions as income vs expenses.
CREATE TABLE agent_rules (
  id serial PRIMARY KEY,
  content text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE agent_rules IS 'Per-rule rows for the classification agent; each rule is one row with CRUD.';

-- Income: matches example table (Date received, Payer/source, Description, Amount, Proof).
CREATE TABLE income (
  id serial PRIMARY KEY,
  date date NOT NULL,
  name text,
  description text,
  amount numeric NOT NULL,
  proof text NOT NULL UNIQUE REFERENCES transactions(transaction_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE income IS 'Income records; proof links to transactions.transaction_id.';

-- Expenses: matches example table (Date incurred, Payee, Description, Amount paid, Proof of payment).
CREATE TABLE expenses (
  id serial PRIMARY KEY,
  date date NOT NULL,
  name text,
  description text,
  amount numeric NOT NULL,
  proof text NOT NULL UNIQUE REFERENCES transactions(transaction_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE expenses IS 'Expense records; proof links to transactions.transaction_id.';

-- Transactions the classification agent could not categorize (after attempting research).
-- One row per transaction; reason explains why it was left uncategorized.
CREATE TABLE uncategorized (
  id serial PRIMARY KEY,
  transaction_id text NOT NULL UNIQUE REFERENCES transactions(transaction_id) ON DELETE CASCADE,
  date date NOT NULL,
  description text,
  amount numeric NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE uncategorized IS 'Transactions the agent could not classify as income or expense; reason explains why.';

-- Deduction categories: home-office style (Rent, Utilities, Internet, Phone, etc.) per year.
-- monthly_amount = amount paid per month; percentage = business use (0–1); monthly deduction = monthly_amount * percentage (computed in UI). Year total calculated in Summary.
CREATE TABLE deduction_categories (
  year smallint NOT NULL,
  category text NOT NULL,
  monthly_amount numeric NOT NULL DEFAULT 0,
  percentage numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (year, category)
);

COMMENT ON TABLE deduction_categories IS 'Per-year category monthly amounts and business-use percentage; monthly deduction and year total computed in UI/Summary.';
