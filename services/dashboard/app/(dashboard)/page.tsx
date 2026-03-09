"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { usePlaidLink } from "react-plaid-link";

type TabId = "summary" | "deductions" | "uncategorized" | "income" | "mileage" | "transactions" | "rules";

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

/** Shape of an income or deduction row returned by GET /api/income or /api/deductions. */
interface LedgerRow {
  id: number;
  date: string;
  name: string | null;
  description: string | null;
  amount: number;
  proof: string;
  created_at: string;
}

/** Shape of an uncategorized row from GET /api/uncategorized. */
interface UncategorizedRow {
  id: number;
  transaction_id: string;
  date: string;
  description: string | null;
  amount: number;
  reason: string;
  created_at: string;
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
  { id: "uncategorized", label: "Uncategorized" },
  { id: "mileage", label: "Mileage" },
  { id: "transactions", label: "Transactions" },
  { id: "rules", label: "Rules" },
];

export default function DashboardPage() {
  const [tab, setTab] = useState<TabId>("summary");
  const [bankLinked, setBankLinked] = useState(false);
  const [institutionName, setInstitutionName] = useState<string | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  /** Classify modal: step 'choice' = Clear / Continue / Cancel; 'running' = agent run with progress. */
  const [classifyModalOpen, setClassifyModalOpen] = useState(false);
  const [classifyStep, setClassifyStep] = useState<"choice" | "running">("choice");
  const [classifyRunning, setClassifyRunning] = useState(false);
  const [classifyProgress, setClassifyProgress] = useState<{ current: number; total: number; description?: string | null } | null>(null);
  const classifyAbortRef = useRef<AbortController | null>(null);
  const classifyProgressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  /* ---- CSV upload state ---- */
  const [csvFormat, setCsvFormat] = useState("novo");
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvSuccess, setCsvSuccess] = useState<string | null>(null);

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

  /** Upload a bank CSV: parse, dedup against existing, insert new rows. */
  const handleCsvUpload = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      const fileInput = form.querySelector<HTMLInputElement>('input[type="file"]');
      const file = fileInput?.files?.[0];
      if (!file) {
        setCsvError("Please select a CSV file");
        return;
      }
      setCsvUploading(true);
      setCsvError(null);
      setCsvSuccess(null);
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("format", csvFormat);
        const res = await fetch("/api/transactions/upload", { method: "POST", body: formData });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? "Upload failed");
        setCsvSuccess(
          `Imported ${data.inserted ?? 0} new transactions, skipped ${data.skippedDuplicate ?? 0} duplicates.`
        );
        fileInput.value = "";
        await fetchTransactions(selectedYear);
      } catch (err) {
        setCsvError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setCsvUploading(false);
      }
    },
    [fetchTransactions, selectedYear]
  );

  /** Delete a single transaction by ID, then refresh the table. */
  const handleDeleteTransaction = useCallback(
    async (txnId: string) => {
      try {
        const res = await fetch(`/api/transactions?id=${encodeURIComponent(txnId)}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? "Delete failed");
        }
        await fetchTransactions(selectedYear);
      } catch (e) {
        setSyncError(e instanceof Error ? e.message : "Delete failed");
      }
    },
    [fetchTransactions, selectedYear]
  );

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

  /* ---- Income CRUD ---- */
  const [incomeRows, setIncomeRows] = useState<LedgerRow[]>([]);
  const [incomeLoading, setIncomeLoading] = useState(false);
  const [incomeError, setIncomeError] = useState<string | null>(null);
  const [incomeAdding, setIncomeAdding] = useState(false);
  const [incomeForm, setIncomeForm] = useState({ date: "", name: "", description: "", amount: "", proof: "" });

  const fetchIncome = useCallback(async () => {
    setIncomeLoading(true);
    setIncomeError(null);
    try {
      const res = await fetch("/api/income");
      if (!res.ok) throw new Error("Failed to load income");
      const data = await res.json();
      setIncomeRows(data.rows ?? []);
    } catch {
      setIncomeError("Could not load income data");
    } finally {
      setIncomeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "income" || tab === "summary") fetchIncome();
  }, [tab, fetchIncome]);

  const handleAddIncome = useCallback(async () => {
    if (!incomeForm.date || !incomeForm.amount) return;
    setIncomeError(null);
    try {
      const res = await fetch("/api/income", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: incomeForm.date,
          name: incomeForm.name || null,
          description: incomeForm.description || null,
          amount: parseFloat(incomeForm.amount),
          proof: incomeForm.proof || "",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to add income");
      }
      const row = await res.json();
      setIncomeRows((prev) => [row, ...prev]);
      setIncomeForm({ date: "", name: "", description: "", amount: "", proof: "" });
      setIncomeAdding(false);
    } catch (e) {
      setIncomeError(e instanceof Error ? e.message : "Failed to add income");
    }
  }, [incomeForm]);

  const handleDeleteIncome = useCallback(async (id: number) => {
    setIncomeError(null);
    try {
      const res = await fetch(`/api/income?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to delete");
      }
      setIncomeRows((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      setIncomeError(e instanceof Error ? e.message : "Failed to delete");
    }
  }, []);

  /* ---- Deductions CRUD ---- */
  const [deductionRows, setDeductionRows] = useState<LedgerRow[]>([]);
  const [deductionLoading, setDeductionLoading] = useState(false);
  const [deductionError, setDeductionError] = useState<string | null>(null);
  const [deductionAdding, setDeductionAdding] = useState(false);
  const [deductionForm, setDeductionForm] = useState({ date: "", name: "", description: "", amount: "", proof: "" });

  const fetchDeductions = useCallback(async () => {
    setDeductionLoading(true);
    setDeductionError(null);
    try {
      const res = await fetch("/api/deductions");
      if (!res.ok) throw new Error("Failed to load deductions");
      const data = await res.json();
      setDeductionRows(data.rows ?? []);
    } catch {
      setDeductionError("Could not load deductions data");
    } finally {
      setDeductionLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "deductions" || tab === "summary") fetchDeductions();
  }, [tab, fetchDeductions]);

  const [uncategorizedRows, setUncategorizedRows] = useState<UncategorizedRow[]>([]);
  const [uncategorizedLoading, setUncategorizedLoading] = useState(false);
  const [uncategorizedError, setUncategorizedError] = useState<string | null>(null);
  const [uncategorizedAdding, setUncategorizedAdding] = useState(false);
  const [uncategorizedForm, setUncategorizedForm] = useState({
    transaction_id: "",
    date: "",
    description: "",
    amount: "",
    reason: "",
  });

  const fetchUncategorized = useCallback(async () => {
    setUncategorizedLoading(true);
    setUncategorizedError(null);
    try {
      const res = await fetch("/api/uncategorized");
      if (!res.ok) throw new Error("Failed to load uncategorized");
      const data = await res.json();
      setUncategorizedRows(data.rows ?? []);
    } catch {
      setUncategorizedError("Could not load uncategorized data");
    } finally {
      setUncategorizedLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "uncategorized") fetchUncategorized();
  }, [tab, fetchUncategorized]);

  /** Start the classification run (progress polling + POST /api/agent/run). Used after Continue or after Clear. */
  const startClassifyRun = useCallback(() => {
    setClassifyStep("running");
    setClassifyRunning(true);
    setClassifyProgress(null);
    const controller = new AbortController();
    classifyAbortRef.current = controller;
    const progressInterval = setInterval(() => {
      fetch("/api/agent/progress")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && typeof data.current === "number" && typeof data.total === "number") {
            setClassifyProgress({
              current: data.current,
              total: data.total,
              description: data.description ?? null,
            });
          }
        })
        .catch(() => {});
    }, 800);
    classifyProgressIntervalRef.current = progressInterval;
    fetch("/api/agent/run", { method: "POST", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Run failed"))))
      .then(() => {
        fetchIncome();
        fetchDeductions();
        fetchUncategorized();
      })
      .catch((err) => {
        if (err?.name !== "AbortError") {
          console.error("[classify]", err);
        }
      })
      .finally(() => {
        if (classifyProgressIntervalRef.current) {
          clearInterval(classifyProgressIntervalRef.current);
          classifyProgressIntervalRef.current = null;
        }
        setClassifyRunning(false);
        setClassifyModalOpen(false);
        setClassifyProgress(null);
        setClassifyStep("choice");
        classifyAbortRef.current = null;
      });
  }, [fetchIncome, fetchDeductions, fetchUncategorized]);

  const handleAddUncategorized = useCallback(async () => {
    if (!uncategorizedForm.transaction_id || !uncategorizedForm.date || !uncategorizedForm.amount) return;
    setUncategorizedError(null);
    try {
      const res = await fetch("/api/uncategorized", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_id: uncategorizedForm.transaction_id,
          date: uncategorizedForm.date,
          description: uncategorizedForm.description || null,
          amount: parseFloat(uncategorizedForm.amount),
          reason: uncategorizedForm.reason || "",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to add uncategorized");
      }
      const row = await res.json();
      setUncategorizedRows((prev) => [row, ...prev]);
      setUncategorizedForm({ transaction_id: "", date: "", description: "", amount: "", reason: "" });
      setUncategorizedAdding(false);
    } catch (e) {
      setUncategorizedError(e instanceof Error ? e.message : "Failed to add uncategorized");
    }
  }, [uncategorizedForm]);

  const handleAddDeduction = useCallback(async () => {
    if (!deductionForm.date || !deductionForm.amount) return;
    setDeductionError(null);
    try {
      const res = await fetch("/api/deductions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: deductionForm.date,
          name: deductionForm.name || null,
          description: deductionForm.description || null,
          amount: parseFloat(deductionForm.amount),
          proof: deductionForm.proof || "",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to add deduction");
      }
      const row = await res.json();
      setDeductionRows((prev) => [row, ...prev]);
      setDeductionForm({ date: "", name: "", description: "", amount: "", proof: "" });
      setDeductionAdding(false);
    } catch (e) {
      setDeductionError(e instanceof Error ? e.message : "Failed to add deduction");
    }
  }, [deductionForm]);

  const handleDeleteDeduction = useCallback(async (id: number) => {
    setDeductionError(null);
    try {
      const res = await fetch(`/api/deductions?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to delete");
      }
      setDeductionRows((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      setDeductionError(e instanceof Error ? e.message : "Failed to delete");
    }
  }, []);

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

  /** Years available for filtering: from income, deductions, uncategorized, mileage, and transactions. */
  const ledgerYearOptions = useMemo(() => {
    const fromIncome = incomeRows.map((r) => new Date(r.date).getFullYear());
    const fromDeductions = deductionRows.map((r) => new Date(r.date).getFullYear());
    const fromUncategorized = uncategorizedRows.map((r) => new Date(r.date).getFullYear());
    const dateCol = mileageColumns.find((c) => c === "date" || c.includes("date"));
    const fromMileage =
      dateCol && mileageRows.length > 0
        ? mileageRows
            .map((r) => {
              const d = new Date(String(r[dateCol] ?? ""));
              return Number.isNaN(d.getTime()) ? null : d.getFullYear();
            })
            .filter((y): y is number => y != null)
        : [];
    const all = [
      ...fromIncome,
      ...fromDeductions,
      ...fromUncategorized,
      ...fromMileage,
      ...availableYears,
      new Date().getFullYear(),
    ];
    return [...new Set(all)].sort((a, b) => b - a);
  }, [incomeRows, deductionRows, uncategorizedRows, mileageRows, mileageColumns, availableYears]);

  /** Rows filtered by selected year for each ledger tab. */
  const incomeRowsFiltered = useMemo(
    () => incomeRows.filter((r) => new Date(r.date).getFullYear() === selectedYear),
    [incomeRows, selectedYear]
  );
  const deductionRowsFiltered = useMemo(
    () => deductionRows.filter((r) => new Date(r.date).getFullYear() === selectedYear),
    [deductionRows, selectedYear]
  );
  const uncategorizedRowsFiltered = useMemo(
    () => uncategorizedRows.filter((r) => new Date(r.date).getFullYear() === selectedYear),
    [uncategorizedRows, selectedYear]
  );
  const mileageRowsFiltered = useMemo(() => {
    const dateCol = mileageColumns.find((c) => c === "date" || c.includes("date"));
    if (!dateCol || mileageRows.length === 0) return mileageRows;
    return mileageRows.filter((row) => {
      const raw = row[dateCol];
      if (raw == null || raw === "") return false;
      const d = new Date(String(raw));
      return !Number.isNaN(d.getTime()) && d.getFullYear() === selectedYear;
    });
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
        className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900"
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
        <button
          type="button"
          onClick={() => {
            setClassifyModalOpen(true);
            setClassifyStep("choice");
            setClassifyProgress(null);
          }}
          disabled={classifyRunning}
          className="ml-auto flex items-center gap-1.5 rounded px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label="Run classifier"
          title="Run classifier"
        >
          <span aria-hidden className="text-base leading-none">
            ✦
          </span>
          Classify
        </button>
      </nav>

      {/* Classify modal: step 1 = Clear / Continue / Cancel; step 2 = running with progress. */}
      {classifyModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          aria-modal="true"
          role="dialog"
          aria-labelledby="classify-modal-title"
        >
          <div className="mx-4 w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {classifyStep === "choice" ? (
              <>
                <h2 id="classify-modal-title" className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  How do you want to classify?
                </h2>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      fetch("/api/agent/clear", { method: "POST" })
                        .then((r) => (r.ok ? undefined : Promise.reject(new Error("Clear failed"))))
                        .then(() => startClassifyRun())
                        .catch((err) => {
                          console.error("[classify] clear", err);
                          setClassifyModalOpen(false);
                        });
                    }}
                    className="rounded bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-500"
                  >
                    Clear tables and start from beginning
                  </button>
                  <button
                    type="button"
                    onClick={() => startClassifyRun()}
                    className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    Continue
                  </button>
                  <button
                    type="button"
                    onClick={() => setClassifyModalOpen(false)}
                    className="rounded bg-zinc-200 px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p id="classify-modal-title" className="mb-2 text-zinc-700 dark:text-zinc-300">
                  {classifyProgress && classifyProgress.total > 0
                    ? `Classifying item ${classifyProgress.current} of ${classifyProgress.total}`
                    : "Agent is classifying expenses…"}
                </p>
                {classifyProgress?.description ? (
                  <p className="mb-4 truncate text-sm text-zinc-500 dark:text-zinc-400" title={classifyProgress.description}>
                    {classifyProgress.description}
                  </p>
                ) : classifyProgress && classifyProgress.total > 0 ? (
                  <div className="mb-4" />
                ) : null}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      fetch("/api/agent/cancel", { method: "POST" }).catch(() => {});
                      classifyAbortRef.current?.abort();
                    }}
                    disabled={!classifyRunning}
                    className="rounded bg-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-300 disabled:opacity-50 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

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
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                  Deductions
                </h2>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-700 outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  aria-label="Filter by year"
                >
                  {ledgerYearOptions.map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => setDeductionAdding((v) => !v)}
                className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {deductionAdding ? "Cancel" : "Add"}
              </button>
            </div>

            {deductionError && (
              <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                {deductionError}
              </div>
            )}

            {deductionAdding && (
              <div className="mb-4 flex flex-wrap items-end gap-2 rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900">
                <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Date
                  <input type="date" value={deductionForm.date} onChange={(e) => setDeductionForm((f) => ({ ...f, date: e.target.value }))} className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Payee
                  <input type="text" placeholder="Who was paid" value={deductionForm.name} onChange={(e) => setDeductionForm((f) => ({ ...f, name: e.target.value }))} className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Description
                  <input type="text" placeholder="What was purchased" value={deductionForm.description} onChange={(e) => setDeductionForm((f) => ({ ...f, description: e.target.value }))} className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Amount
                  <input type="number" step="0.01" placeholder="0.00" value={deductionForm.amount} onChange={(e) => setDeductionForm((f) => ({ ...f, amount: e.target.value }))} className="w-28 rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Proof
                  <input type="text" placeholder="Receipt, txn ID, etc." value={deductionForm.proof} onChange={(e) => setDeductionForm((f) => ({ ...f, proof: e.target.value }))} className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" />
                </label>
                <button type="button" onClick={handleAddDeduction} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500">
                  Save
                </button>
              </div>
            )}

            {deductionLoading ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
            ) : deductionRowsFiltered.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No deductions for this year.</p>
            ) : (
              <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                    <tr>
                      <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">Date</th>
                      <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">Payee</th>
                      <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">Description</th>
                      <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-400">Amount</th>
                      <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">Proof</th>
                      <th className="w-16 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {deductionRowsFiltered.map((row) => (
                      <tr key={row.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                        <td className="whitespace-nowrap px-3 py-2 text-zinc-700 dark:text-zinc-300">
                          {new Date(row.date).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">{row.name ?? "—"}</td>
                        <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{row.description ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-zinc-700 dark:text-zinc-300">
                          ${Number(row.amount).toFixed(2)}
                        </td>
                        <td className="max-w-0 truncate px-3 py-2 font-mono text-xs text-zinc-500 dark:text-zinc-400" title={row.proof}>
                          {row.proof || "—"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button type="button" onClick={() => handleDeleteDeduction(row.id)} className="rounded px-1.5 py-0.5 text-xs text-red-500 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/30 dark:hover:text-red-300" title="Delete">
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
        {tab === "uncategorized" && (
          <section aria-label="Uncategorized">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                  Uncategorized
                </h2>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-700 outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  aria-label="Filter by year"
                >
                  {ledgerYearOptions.map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => setUncategorizedAdding((v) => !v)}
                className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {uncategorizedAdding ? "Cancel" : "Add"}
              </button>
            </div>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              Transactions the classification agent could not classify as income or deduction. Run the agent to populate, or add manually.
            </p>
            {uncategorizedError && (
              <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                {uncategorizedError}
              </div>
            )}
            {uncategorizedAdding && (
              <div className="mb-4 flex flex-wrap items-end gap-2 rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900">
                <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Transaction ID
                  <input type="text" placeholder="e.g. txn_abc123" value={uncategorizedForm.transaction_id} onChange={(e) => setUncategorizedForm((f) => ({ ...f, transaction_id: e.target.value }))} className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Date
                  <input type="date" value={uncategorizedForm.date} onChange={(e) => setUncategorizedForm((f) => ({ ...f, date: e.target.value }))} className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Description
                  <input type="text" placeholder="Transaction description" value={uncategorizedForm.description} onChange={(e) => setUncategorizedForm((f) => ({ ...f, description: e.target.value }))} className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Amount
                  <input type="number" step="0.01" placeholder="0.00" value={uncategorizedForm.amount} onChange={(e) => setUncategorizedForm((f) => ({ ...f, amount: e.target.value }))} className="w-28 rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Reason
                  <input type="text" placeholder="Why uncategorized" value={uncategorizedForm.reason} onChange={(e) => setUncategorizedForm((f) => ({ ...f, reason: e.target.value }))} className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" />
                </label>
                <button type="button" onClick={handleAddUncategorized} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500">
                  Save
                </button>
              </div>
            )}
            {uncategorizedLoading ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
            ) : uncategorizedRowsFiltered.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No uncategorized transactions for this year.</p>
            ) : (
              <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                    <tr>
                      <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">Date</th>
                      <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">Transaction ID</th>
                      <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">Description</th>
                      <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-400">Amount</th>
                      <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {uncategorizedRowsFiltered.map((row) => (
                      <tr key={row.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                        <td className="whitespace-nowrap px-3 py-2 text-zinc-700 dark:text-zinc-300">
                          {new Date(row.date).toLocaleDateString()}
                        </td>
                        <td className="max-w-0 truncate px-3 py-2 font-mono text-xs text-zinc-500 dark:text-zinc-400" title={row.transaction_id}>
                          {row.transaction_id || "—"}
                        </td>
                        <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{row.description ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-zinc-700 dark:text-zinc-300">
                          ${Number(row.amount).toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{row.reason || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
        {tab === "income" && (
          <section aria-label="Income">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                  Income
                </h2>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-700 outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  aria-label="Filter by year"
                >
                  {ledgerYearOptions.map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => setIncomeAdding((v) => !v)}
                className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {incomeAdding ? "Cancel" : "Add"}
              </button>
            </div>

            {incomeError && (
              <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                {incomeError}
              </div>
            )}

            {incomeAdding && (
              <div className="mb-4 flex flex-wrap items-end gap-2 rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900">
                <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Date
                  <input type="date" value={incomeForm.date} onChange={(e) => setIncomeForm((f) => ({ ...f, date: e.target.value }))} className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Payer / source
                  <input type="text" placeholder="Who paid you" value={incomeForm.name} onChange={(e) => setIncomeForm((f) => ({ ...f, name: e.target.value }))} className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Description
                  <input type="text" placeholder="Source of income" value={incomeForm.description} onChange={(e) => setIncomeForm((f) => ({ ...f, description: e.target.value }))} className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Amount
                  <input type="number" step="0.01" placeholder="0.00" value={incomeForm.amount} onChange={(e) => setIncomeForm((f) => ({ ...f, amount: e.target.value }))} className="w-28 rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Proof
                  <input type="text" placeholder="1099, deposit slip, etc." value={incomeForm.proof} onChange={(e) => setIncomeForm((f) => ({ ...f, proof: e.target.value }))} className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" />
                </label>
                <button type="button" onClick={handleAddIncome} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500">
                  Save
                </button>
              </div>
            )}

            {incomeLoading ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
            ) : incomeRowsFiltered.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No income records for this year.</p>
            ) : (
              <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                    <tr>
                      <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">Date</th>
                      <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">Payer / source</th>
                      <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">Description</th>
                      <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-400">Amount</th>
                      <th className="px-3 py-2 font-medium text-zinc-600 dark:text-zinc-400">Proof</th>
                      <th className="w-16 px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {incomeRowsFiltered.map((row) => (
                      <tr key={row.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                        <td className="whitespace-nowrap px-3 py-2 text-zinc-700 dark:text-zinc-300">
                          {new Date(row.date).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">{row.name ?? "—"}</td>
                        <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{row.description ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-zinc-700 dark:text-zinc-300">
                          ${Number(row.amount).toFixed(2)}
                        </td>
                        <td className="max-w-0 truncate px-3 py-2 font-mono text-xs text-zinc-500 dark:text-zinc-400" title={row.proof}>
                          {row.proof || "—"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button type="button" onClick={() => handleDeleteIncome(row.id)} className="rounded px-1.5 py-0.5 text-xs text-red-500 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/30 dark:hover:text-red-300" title="Delete">
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
        {tab === "mileage" && (
          <section aria-label="Mileage">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                Mileage
              </h2>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-700 outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                aria-label="Filter by year"
              >
                {ledgerYearOptions.map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>
            </div>
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
            ) : mileageRowsFiltered.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No mileage for this year.</p>
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
                    {mileageRowsFiltered.map((row, i) => (
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

            {/* CSV upload form for importing bank transaction exports. */}
            <form onSubmit={handleCsvUpload} className="mb-4 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
                Bank format
                <select
                  value={csvFormat}
                  onChange={(e) => setCsvFormat(e.target.value)}
                  className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  disabled={csvUploading}
                >
                  <option value="novo">Novo</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
                CSV file
                <input
                  type="file"
                  accept=".csv"
                  className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  disabled={csvUploading}
                />
              </label>
              <button
                type="submit"
                disabled={csvUploading}
                className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {csvUploading ? "Importing…" : "Import"}
              </button>
            </form>
            {csvError && (
              <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                {csvError}
              </div>
            )}
            {csvSuccess && (
              <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                {csvSuccess}
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
                      <th className="w-16 px-3 py-2" />
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
                        <td className="px-3 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleDeleteTransaction(txn.transaction_id)}
                            className="rounded px-1.5 py-0.5 text-xs text-red-500 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/30 dark:hover:text-red-300"
                            title="Delete transaction"
                          >
                            ✕
                          </button>
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
      </main>
    </div>
  );
}

