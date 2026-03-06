"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { usePlaidLink } from "react-plaid-link";

type TabId = "summary" | "deductions" | "income" | "mileage" | "transactions" | "rules" | "prompt";

/** One rule row from GET /api/rules. */
interface RuleRow {
  id: number;
  content: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Shape of a transaction row returned by GET /api/transactions. */
interface Transaction {
  transaction_id: string;
  date: string;
  datetime: string | null;
  name: string | null;
  merchant_name: string | null;
  amount: number;
  iso_currency_code: string | null;
  pending: boolean;
  personal_finance_category: { primary?: string; detailed?: string } | null;
  payment_channel: string | null;
}

/** Format transaction date/time in the user's locale and timezone. Uses datetime when present, else date. */
function formatTxnDate(date: string, datetime: string | null): string {
  if (datetime) {
    return new Date(datetime).toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
  }
  return new Date(date).toLocaleDateString(undefined, { dateStyle: "short" });
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
  { id: "deductions", label: "Deductions" },
  { id: "mileage", label: "Mileage" },
  { id: "transactions", label: "Transactions" },
  { id: "rules", label: "Rules" },
  { id: "prompt", label: "Prompt" },
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

  /* ---- Mileage state ---- */
  const [mileageColumns, setMileageColumns] = useState<string[]>([]);
  const [mileageRows, setMileageRows] = useState<Record<string, unknown>[]>([]);
  const [mileageLoading, setMileageLoading] = useState(false);
  const [mileageUploading, setMileageUploading] = useState(false);
  const [mileageError, setMileageError] = useState<string | null>(null);
  const [mileageSuccess, setMileageSuccess] = useState<string | null>(null);

  /** Fetch mileage table data from the API. */
  const fetchMileage = useCallback(async () => {
    setMileageLoading(true);
    setMileageError(null);
    try {
      const res = await fetch("/api/mileage");
      if (!res.ok) throw new Error("Failed to load mileage");
      const data = await res.json();
      setMileageColumns(data.columns ?? []);
      setMileageRows(data.rows ?? []);
    } catch {
      setMileageColumns([]);
      setMileageRows([]);
      setMileageError("Could not load mileage data");
    } finally {
      setMileageLoading(false);
    }
  }, []);

  /** Load mileage when the Mileage or Summary tab is selected (Summary needs it for total miles & deduction). */
  useEffect(() => {
    if (tab === "mileage" || tab === "summary") fetchMileage();
  }, [tab, fetchMileage]);

  /** Upload CSV: replace or create mileage table, then refresh. */
  const handleMileageUpload = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      const fileInput = form.querySelector<HTMLInputElement>('input[type="file"]');
      const file = fileInput?.files?.[0];
      if (!file) {
        setMileageError("Please select a CSV file");
        return;
      }
      setMileageUploading(true);
      setMileageError(null);
      setMileageSuccess(null);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/mileage/upload", { method: "POST", body: formData });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error ?? "Upload failed");
        }
        setMileageSuccess(
          data.tableCreated
            ? `Table created with ${data.rowsInserted ?? 0} rows.`
            : `Replaced with ${data.rowsReplaced ?? 0} rows.`
        );
        fileInput.value = "";
        await fetchMileage();
      } catch (e) {
        setMileageError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setMileageUploading(false);
      }
    },
    [fetchMileage]
  );

  /* ---- Rules (agent classification): one row per rule, CRUD ---- */
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  /** Id of rule being edited inline; null when not editing. */
  const [rulesEditingId, setRulesEditingId] = useState<number | null>(null);
  /** Draft content while editing (for the row in rulesEditingId). */
  const [rulesEditDraft, setRulesEditDraft] = useState("");
  /** Id of rule pending delete (for confirm); null when not confirming. */
  const [rulesDeletingId, setRulesDeletingId] = useState<number | null>(null);
  /** New-rule form: current input. */
  const [rulesNewContent, setRulesNewContent] = useState("");

  const fetchRules = useCallback(async () => {
    setRulesLoading(true);
    setRulesError(null);
    try {
      const res = await fetch("/api/rules");
      if (!res.ok) throw new Error("Failed to load rules");
      const data = await res.json();
      setRules(Array.isArray(data.rules) ? data.rules : []);
    } catch {
      setRulesError("Could not load rules");
    } finally {
      setRulesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "rules") fetchRules();
  }, [tab, fetchRules]);

  const handleAddRule = useCallback(async () => {
    const content = rulesNewContent.trim();
    if (!content) return;
    setRulesError(null);
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to add rule");
      }
      const rule = await res.json();
      setRules((prev) => [...prev, rule]);
      setRulesNewContent("");
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : "Failed to add rule");
    }
  }, [rulesNewContent]);

  const startEditRule = useCallback((row: RuleRow) => {
    setRulesEditingId(row.id);
    setRulesEditDraft(row.content);
  }, []);

  const cancelEditRule = useCallback(() => {
    setRulesEditingId(null);
    setRulesEditDraft("");
  }, []);

  const saveEditRule = useCallback(async () => {
    if (rulesEditingId === null) return;
    setRulesError(null);
    try {
      const res = await fetch(`/api/rules/${rulesEditingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: rulesEditDraft }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to save rule");
      }
      const data = await res.json();
      setRules((prev) =>
        prev.map((r) =>
          r.id === rulesEditingId
            ? { ...r, content: rulesEditDraft, updatedAt: data.updatedAt }
            : r
        )
      );
      setRulesEditingId(null);
      setRulesEditDraft("");
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : "Failed to save rule");
    }
  }, [rulesEditingId, rulesEditDraft]);

  const confirmDeleteRule = useCallback((id: number) => {
    setRulesDeletingId(id);
  }, []);

  const cancelDeleteRule = useCallback(() => {
    setRulesDeletingId(null);
  }, []);

  const handleDeleteRule = useCallback(async () => {
    if (rulesDeletingId === null) return;
    setRulesError(null);
    try {
      const res = await fetch(`/api/rules/${rulesDeletingId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to delete rule");
      }
      setRules((prev) => prev.filter((r) => r.id !== rulesDeletingId));
      setRulesDeletingId(null);
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : "Failed to delete rule");
    }
  }, [rulesDeletingId]);

  /* ---- Prompt (single-row agent prompt) ---- */
  const [promptContent, setPromptContent] = useState("");
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptUpdatedAt, setPromptUpdatedAt] = useState<string | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

  const fetchPrompt = useCallback(async () => {
    setPromptLoading(true);
    setPromptError(null);
    try {
      const res = await fetch("/api/prompt");
      if (!res.ok) throw new Error("Failed to load prompt");
      const data = await res.json();
      setPromptContent(data.content ?? "");
      setPromptUpdatedAt(data.updatedAt ?? null);
    } catch {
      setPromptError("Could not load prompt");
    } finally {
      setPromptLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "prompt") fetchPrompt();
  }, [tab, fetchPrompt]);

  /* Auto-expand prompt textarea to show full content. Defer so layout is done (e.g. after switching tab and content load). */
  useEffect(() => {
    if (tab !== "prompt" || promptLoading) return;
    const run = () => {
      const el = promptTextareaRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.max(el.scrollHeight, 120)}px`;
    };
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(run);
    });
    return () => cancelAnimationFrame(id);
  }, [promptContent, tab, promptLoading]);

  const handlePromptSave = useCallback(async () => {
    setPromptSaving(true);
    setPromptError(null);
    try {
      const res = await fetch("/api/prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: promptContent }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to save prompt");
      }
      const data = await res.json();
      setPromptUpdatedAt(data.updatedAt ?? null);
    } catch (e) {
      setPromptError(e instanceof Error ? e.message : "Failed to save prompt");
    } finally {
      setPromptSaving(false);
    }
  }, [promptContent]);

  /**
   * From mileage table: total miles and mileage deduction for the selected year only.
   * Rows are filtered by the Summary year dropdown when a date column exists; the IRS rate used is for that same year.
   */
  const { summaryTotalMiles, summaryMileageDeduction } = useMemo(() => {
    const cols = mileageColumns.filter((c) => c !== "id");
    const milesCol = cols.find(
      (c) =>
        c.includes("mile") || c === "distance" || c === "odometer" || c === "miles"
    );
    const dateCol = cols.find(
      (c) => c === "date" || c.includes("date") || c === "trip_date"
    );
    /* Restrict to rows in the selected year when we have a date column. */
    let rows = mileageRows;
    if (dateCol && mileageRows.length > 0) {
      rows = mileageRows.filter((row) => {
        const raw = row[dateCol];
        if (raw == null || raw === "") return false;
        const d = new Date(String(raw));
        return !Number.isNaN(d.getTime()) && d.getFullYear() === selectedYear;
      });
    }
    let totalMiles = 0;
    if (milesCol) {
      for (const row of rows) {
        const v = parseFloat(String(row[milesCol] ?? "").replace(/,/g, ""));
        if (!Number.isNaN(v)) totalMiles += v;
      }
    }
    /* IRS business standard mileage rate per mile for the dropdown year. */
    const RATE_BY_YEAR: Record<number, number> = {
      2022: 0.585,
      2023: 0.655,
      2024: 0.67,
      2025: 0.7,
      2026: 0.725,
    };
    const rate = RATE_BY_YEAR[selectedYear] ?? (selectedYear >= 2027 ? 0.725 : 0.67);
    return {
      summaryTotalMiles: totalMiles,
      summaryMileageDeduction: Math.round(totalMiles * rate * 100) / 100,
    };
  }, [mileageColumns, mileageRows, selectedYear]);

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
        <h1 className="flex items-center">
          <img
            src="/logo.svg"
            alt="OpenBooks"
            className="h-8 w-auto brightness-0 invert"
          />
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
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                Summary
              </h2>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-700 outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                aria-label="Year"
              >
                {(availableYears.length > 0
                  ? [...new Set([new Date().getFullYear(), ...availableYears])].sort((a, b) => b - a)
                  : Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)
                ).map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>
            </div>
            <p className="mb-6 text-zinc-600 dark:text-zinc-400">
              All amounts and miles are year-to-date.
            </p>
            <div className="space-y-6">
              <div>
                <p className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
                  Income &amp; Mileage
                </p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Gross income
                    </p>
                    <p className="mt-1 text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
                      $42,350
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Total miles
                    </p>
                    <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
                      {summaryTotalMiles.toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
                  Income &amp; Deductions
                </p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Business deductions
                    </p>
                    <p className="mt-1 text-2xl font-semibold text-red-600 dark:text-red-400">
                      $28,190
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Mileage deduction
                    </p>
                    <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
                      ${summaryMileageDeduction.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Total deductions
                    </p>
                    <p className="mt-1 text-2xl font-semibold text-red-600 dark:text-red-400">
                      ${(28190 + summaryMileageDeduction).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
                  Taxable Income
                </p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Taxable income
                    </p>
                    <p
                      className={`mt-1 text-2xl font-semibold ${
                        42350 - (28190 + summaryMileageDeduction) > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : 42350 - (28190 + summaryMileageDeduction) < 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-zinc-900 dark:text-zinc-100"
                      }`}
                    >
                      ${(42350 - (28190 + summaryMileageDeduction)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
        {tab === "deductions" && (
          <section aria-label="Deductions">
            <h2 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Deductions
            </h2>
            <p className="mb-4 text-zinc-600 dark:text-zinc-400">
              Example of an IRS-compliant deduction record. The IRS expects: who was paid (payee),
              amount, proof of payment, date incurred, and a description of what was purchased or
              the service received.
            </p>
            <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                  <tr>
                    <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">
                      Date incurred
                    </th>
                    <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">
                      Payee
                    </th>
                    <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">
                      Description
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-400">
                      Amount paid
                    </th>
                    <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">
                      Proof of payment
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-700 dark:text-zinc-300">
                      2024-01-15
                    </td>
                    <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">Office Depot</td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                      Printer paper, toner (business use)
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-zinc-700 dark:text-zinc-300">
                      $47.23
                    </td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">CC ****4521</td>
                  </tr>
                  <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-700 dark:text-zinc-300">
                      2024-01-22
                    </td>
                    <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">Cloud Hosting Co</td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                      Monthly server (Jan 2024)
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-zinc-700 dark:text-zinc-300">
                      $89.00
                    </td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">Receipt #8842</td>
                  </tr>
                  <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-700 dark:text-zinc-300">
                      2024-02-01
                    </td>
                    <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">FedEx</td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                      Shipping for client deliverables
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-zinc-700 dark:text-zinc-300">
                      $32.50
                    </td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">Check #1204</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}
        {tab === "income" && (
          <section aria-label="Income">
            <h2 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Income
            </h2>
            <p className="mb-4 text-zinc-600 dark:text-zinc-400">
              Example of an IRS-compliant income record. The IRS expects records sufficient to show
              gross income: source of payment, amount, date received, and supporting documentation
              (e.g. 1099, W-2, deposit slip, invoice).
            </p>
            <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                  <tr>
                    <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">
                      Date received
                    </th>
                    <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">
                      Payer / source
                    </th>
                    <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">
                      Description
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-400">
                      Amount
                    </th>
                    <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">
                      Proof
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-700 dark:text-zinc-300">
                      2024-01-31
                    </td>
                    <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">Acme Corp</td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                      Consulting (Jan 2024)
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-zinc-700 dark:text-zinc-300">
                      $4,500.00
                    </td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">1099-NEC; Deposit slip</td>
                  </tr>
                  <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-700 dark:text-zinc-300">
                      2024-02-15
                    </td>
                    <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">Employer Inc</td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">W-2 wages</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-zinc-700 dark:text-zinc-300">
                      $3,200.00
                    </td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">W-2; Pay stub</td>
                  </tr>
                  <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-700 dark:text-zinc-300">
                      2024-03-01
                    </td>
                    <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">Client LLC</td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                      Project invoice #2104
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-zinc-700 dark:text-zinc-300">
                      $1,850.00
                    </td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">Invoice; ACH confirmation</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}
        {tab === "mileage" && (
          <section aria-label="Mileage">
            <h2 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Mileage
            </h2>
            <p className="mb-4 text-zinc-600 dark:text-zinc-400">
              Upload a CSV to create or replace the mileage table. The table structure matches your
              CSV headers. If the table already exists, the CSV must have the same columns in the
              same order.
            </p>
            <form onSubmit={handleMileageUpload} className="mb-4 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
                CSV file
                <input
                  type="file"
                  accept=".csv"
                  className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  disabled={mileageUploading}
                />
              </label>
              <button
                type="submit"
                disabled={mileageUploading}
                className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {mileageUploading ? "Uploading…" : "Upload"}
              </button>
            </form>
            {mileageError && (
              <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                {mileageError}
              </div>
            )}
            {mileageSuccess && (
              <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                {mileageSuccess}
              </div>
            )}
            {mileageLoading ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
            ) : mileageColumns.length === 0 && mileageRows.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No mileage data yet. Upload a CSV to create the table.
              </p>
            ) : (
              <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                    <tr>
                      {mileageColumns.map((col) => (
                        <th
                          key={col}
                          className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {mileageRows.map((row, i) => (
                      <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                        {mileageColumns.map((col) => (
                          <td
                            key={col}
                            className="whitespace-nowrap px-3 py-2 text-zinc-700 dark:text-zinc-300"
                          >
                            {String(row[col] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-700 outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
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
                <table className="w-full table-fixed text-left text-sm">
                  <thead className="border-b border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                    <tr>
                      <th className="w-[min(12rem,20%)] px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">Transaction ID</th>
                      <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">Date</th>
                      <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">Description</th>
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
                        <td className="max-w-0 truncate px-3 py-2 font-mono text-xs text-zinc-500 dark:text-zinc-400" title={txn.transaction_id}>
                          {txn.transaction_id}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-zinc-700 dark:text-zinc-300">
                          {formatTxnDate(txn.date, txn.datetime)}
                        </td>
                        <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">
                          {txn.merchant_name ?? txn.name ?? "—"}
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
        {tab === "rules" && (
          <section aria-label="Rules">
            <h2 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Rules
            </h2>
            <p className="mb-4 text-zinc-600 dark:text-zinc-400">
              Rules help the agent classify transactions as income or deduction. Add rules when the automatic classification is wrong—for example, a refund showing as income, a transfer as a deduction, or a specific merchant you always want treated one way. Clearer rules give you more accurate Summary, Income, and Deductions views.
            </p>
            {rulesError && (
              <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                {rulesError}
              </div>
            )}
            {/* New rule: textarea + Add button. */}
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start">
              <textarea
                value={rulesNewContent}
                onChange={(e) => setRulesNewContent(e.target.value)}
                placeholder="e.g. Treat merchant &quot;Acme Corp&quot; as income."
                rows={2}
                className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
              />
              <button
                type="button"
                onClick={handleAddRule}
                disabled={!rulesNewContent.trim()}
                className="shrink-0 rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Add rule
              </button>
            </div>
            {rulesLoading ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
            ) : (
              <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
                <table className="w-full min-w-[400px] border-collapse text-left text-sm">
                  <thead className="border-b border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                    <tr>
                      <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">
                        Rule
                      </th>
                      <th className="w-0 px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {rules.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="px-3 py-4 text-zinc-500 dark:text-zinc-400">
                          No rules yet. Add one above.
                        </td>
                      </tr>
                    ) : (
                      rules.map((row) => (
                        <tr key={row.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                          <td className="px-3 py-2">
                            {rulesEditingId === row.id ? (
                              <div className="flex flex-col gap-2">
                                <textarea
                                  value={rulesEditDraft}
                                  onChange={(e) => setRulesEditDraft(e.target.value)}
                                  rows={3}
                                  className="min-w-0 rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                                  autoFocus
                                />
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={saveEditRule}
                                    className="rounded bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelEditRule}
                                    className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <span className="text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
                                {row.content || "—"}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2">
                            {rulesEditingId === row.id ? null : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => startEditRule(row)}
                                  className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                                >
                                  Edit
                                </button>
                                {rulesDeletingId === row.id ? (
                                  <span className="ml-2 inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={handleDeleteRule}
                                      className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                                    >
                                      Confirm delete
                                    </button>
                                    <button
                                      type="button"
                                      onClick={cancelDeleteRule}
                                      className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 dark:border-zinc-500 dark:text-zinc-400"
                                    >
                                      Cancel
                                    </button>
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => confirmDeleteRule(row.id)}
                                    className="ml-2 rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950/30"
                                  >
                                    Delete
                                  </button>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
        {tab === "prompt" && (
          <section aria-label="Prompt">
            <h2 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Prompt
            </h2>
            <p className="mb-4 text-zinc-600 dark:text-zinc-400">
              System prompt for the classification agent. This is the main instruction text the agent sees (e.g. how to treat income vs deductions). Edit below and save.
            </p>
            {promptError && (
              <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                {promptError}
              </div>
            )}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              {promptUpdatedAt && (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Last saved {new Date(promptUpdatedAt).toLocaleString()}
                </span>
              )}
              <button
                type="button"
                onClick={handlePromptSave}
                disabled={promptSaving}
                className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {promptSaving ? "Saving…" : "Save"}
              </button>
            </div>
            {promptLoading ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
            ) : (
              <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
                <table className="w-full min-w-[400px] border-collapse text-left text-sm">
                  <thead className="border-b border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                    <tr>
                      <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">
                        Prompt
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                      <td className="px-3 py-2">
                        <textarea
                          ref={promptTextareaRef}
                          value={promptContent}
                          onChange={(e) => setPromptContent(e.target.value)}
                          placeholder="e.g. You are a classifier. Treat refunds as deductions, salary as income…"
                          rows={4}
                          className="min-h-[120px] min-w-0 w-full resize-none overflow-hidden rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </td>
                    </tr>
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

