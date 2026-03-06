"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePlaidLink } from "react-plaid-link";

type TabId = "summary" | "expenses" | "income" | "mileage" | "transactions";

/** Shape of a transaction row returned by GET /api/transactions. */
interface Transaction {
  transaction_id: string;
  date: string;
  name: string | null;
  merchant_name: string | null;
  amount: number;
  iso_currency_code: string | null;
  pending: boolean;
  personal_finance_category: { primary?: string; detailed?: string } | null;
  payment_channel: string | null;
}

/** Response shape from GET /api/transactions. */
interface TransactionsResponse {
  transactions: Transaction[];
  years: number[];
  lastSyncedAt: string | null;
}

const TABS: { id: TabId; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "income", label: "Income" },
  { id: "expenses", label: "Expenses" },
  { id: "mileage", label: "Mileage" },
  { id: "transactions", label: "Transactions" },
];

export default function DashboardPage() {
  const [tab, setTab] = useState<TabId>("summary");
  const [bankLinked, setBankLinked] = useState(false);
  const [institutionName, setInstitutionName] = useState<string | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Load linked status and institution name on mount.
  useEffect(() => {
    fetch("/api/plaid/status")
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.linked === "boolean") setBankLinked(data.linked);
        if (data.linked && data.institution_name != null) setInstitutionName(data.institution_name);
      })
      .catch(() => {});
  }, []);

  const onSuccess = useCallback(async (publicToken: string, metadata: { institution: { name: string; institution_id: string } | null }) => {
    setLinkError(null);
    const institution_name = metadata?.institution?.name;
    const res = await fetch("/api/plaid/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ public_token: publicToken, institution_name }),
    });
    if (res.ok) {
      setBankLinked(true);
      setInstitutionName(institution_name ?? null);
    } else {
      const data = await res.json().catch(() => null);
      setLinkError(data?.error ?? "Exchange failed");
    }
    setLinkToken(null);
    setLinkLoading(false);
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: (_err, _metadata) => {
      setLinkToken(null);
      setLinkLoading(false);
      setLinkError(null);
    },
  });

  // When we get a link token, open Link once (token is one-time use).
  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  // If Plaid script never becomes ready, clear loading after a timeout so user isn’t stuck.
  useEffect(() => {
    if (!linkToken || linkLoading === false) return;
    const t = setTimeout(() => setLinkLoading(false), 8000);
    return () => clearTimeout(t);
  }, [linkToken, linkLoading]);

  const handleLinkAccount = useCallback(() => {
    setLinkError(null);
    setLinkLoading(true);
    fetch("/api/plaid/link-token")
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (ok && data.link_token) {
          setLinkToken(data.link_token);
        } else {
          setLinkLoading(false);
          setLinkError(data?.error ?? "Could not get link token");
        }
      })
      .catch(() => {
        setLinkLoading(false);
        setLinkError("Network error");
      });
  }, []);

  /* ---- Transaction state ---- */
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [txnLoading, setTxnLoading] = useState(false);
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  /** Guard so auto-sync fires only once per page load. */
  const didAutoSync = useRef(false);

  /** Fetch transactions from our DB for the selected year. */
  const fetchTransactions = useCallback(async (year: number) => {
    setTxnLoading(true);
    try {
      const res = await fetch(`/api/transactions?year=${year}`);
      if (!res.ok) throw new Error("Failed to load transactions");
      const data: TransactionsResponse = await res.json();
      setTransactions(data.transactions);
      setAvailableYears(data.years);
      setLastSyncedAt(data.lastSyncedAt);
    } catch {
      setTransactions([]);
    } finally {
      setTxnLoading(false);
    }
  }, []);

  /** Trigger a Plaid sync, then refresh the table. */
  const handleSync = useCallback(async () => {
    setSyncRunning(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/plaid/sync");
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Sync failed");
      }
      /* Refresh transaction list after a successful sync. */
      await fetchTransactions(selectedYear);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncRunning(false);
    }
  }, [fetchTransactions, selectedYear]);

  /**
   * Auto-sync on page load when bank is linked.
   * Fires once after we know bankLinked is true.
   */
  useEffect(() => {
    if (!bankLinked || didAutoSync.current) return;
    didAutoSync.current = true;
    /* Fire-and-forget: sync then load transactions. */
    (async () => {
      setSyncRunning(true);
      try {
        await fetch("/api/plaid/sync");
      } catch { /* non-fatal */ }
      setSyncRunning(false);
      fetchTransactions(selectedYear);
    })();
  }, [bankLinked, fetchTransactions, selectedYear]);

  /** When year changes, re-fetch from DB. */
  useEffect(() => {
    if (tab === "transactions") fetchTransactions(selectedYear);
  }, [selectedYear, tab, fetchTransactions]);

  /**
   * Format an amount for display. Plaid amounts are positive for debits
   * (money leaving the account) and negative for credits (money coming in).
   */
  const formatAmount = (amount: number, currency: string | null) => {
    const formatted = Math.abs(amount).toLocaleString("en-US", {
      style: "currency",
      currency: currency ?? "USD",
    });
    /* Negative in Plaid = credit (income), so flip the sign for display. */
    return amount < 0 ? `+${formatted}` : `-${formatted}`;
  };

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          OpenBooks
        </h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-4">
            <span
              className="h-3 w-3 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600"
              style={bankLinked ? { backgroundColor: "#22c55e" } : undefined}
              title={bankLinked ? "Bank connected" : "Not connected"}
              aria-hidden
            />
            {bankLinked && (
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                {institutionName ?? "Connected"}
              </span>
            )}
            <button
              type="button"
              onClick={handleLinkAccount}
              disabled={linkLoading}
              className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              aria-label="Connect bank account via Plaid Link"
            >
              {linkLoading ? "Opening…" : "Link account"}
            </button>
          </div>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {linkError && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {linkError}
        </div>
      )}

      {/* Tabs */}
      <nav
        className="border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900"
        aria-label="Dashboard sections"
      >
        <ul className="flex gap-1">
          {TABS.map(({ id, label }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => setTab(id)}
                className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  tab === id
                    ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                    : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main className="mx-auto max-w-4xl px-4 py-8">
        {tab === "summary" && (
          <section aria-label="Summary">
            <h2 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Summary
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400">
              At-a-glance totals: income, expenses, net. (Placeholder — wireframe.)
            </p>
          </section>
        )}
        {tab === "expenses" && (
          <section aria-label="Expenses">
            <h2 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Expenses
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400">
              List of expense transactions, filters, categories. (Placeholder — wireframe.)
            </p>
          </section>
        )}
        {tab === "income" && (
          <section aria-label="Income">
            <h2 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Income
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400">
              List of income transactions. (Placeholder — wireframe.)
            </p>
          </section>
        )}
        {tab === "mileage" && (
          <section aria-label="Mileage">
            <h2 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Mileage
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400">
              Mileage tracking and logs. (Placeholder — wireframe.)
            </p>
          </section>
        )}
        {tab === "transactions" && (
          <section aria-label="Transactions">
            {/* Header row: title, year selector, sync button */}
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                  Transactions
                </h2>
                {/* Year selector — shows all years that have data, plus current year as default. */}
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  aria-label="Filter by year"
                >
                  {(availableYears.length > 0
                    ? /* Ensure current year is always in the list. */
                      [...new Set([new Date().getFullYear(), ...availableYears])].sort(
                        (a, b) => b - a
                      )
                    : [new Date().getFullYear()]
                  ).map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-3">
                {lastSyncedAt && (
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    Last synced {new Date(lastSyncedAt).toLocaleString()}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={syncRunning || !bankLinked}
                  className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {syncRunning ? "Syncing…" : "Sync"}
                </button>
              </div>
            </div>

            {syncError && (
              <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                {syncError}
              </div>
            )}

            {txnLoading ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
            ) : transactions.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {bankLinked
                  ? "No transactions for this year. Try syncing."
                  : "Link a bank account to see transactions."}
              </p>
            ) : (
              <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                    <tr>
                      <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">Transaction ID</th>
                      <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">Date</th>
                      <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">Description</th>
                      <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">Category</th>
                      <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-400">Amount</th>
                      <th className="px-3 py-2 text-center font-medium text-zinc-600 dark:text-zinc-400">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {transactions.map((txn) => (
                      <tr
                        key={txn.transaction_id}
                        className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                      >
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-zinc-500 dark:text-zinc-400" title={txn.transaction_id}>
                          {txn.transaction_id}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-zinc-700 dark:text-zinc-300">
                          {txn.date}
                        </td>
                        <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">
                          {txn.merchant_name ?? txn.name ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
                          {txn.personal_finance_category?.primary?.replace(/_/g, " ") ?? "—"}
                        </td>
                        <td
                          className={`whitespace-nowrap px-3 py-2 text-right font-mono ${
                            txn.amount < 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-zinc-900 dark:text-zinc-100"
                          }`}
                        >
                          {formatAmount(txn.amount, txn.iso_currency_code)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {txn.pending ? (
                            <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                              Pending
                            </span>
                          ) : (
                            <span className="inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                              Posted
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

