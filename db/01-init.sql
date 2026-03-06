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

-- Single-row table holding the markdown rules document the classification agent reads.
CREATE TABLE agent_rules (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  content text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE agent_rules IS 'Markdown rules for the agent when classifying transactions as income vs expenses.';
