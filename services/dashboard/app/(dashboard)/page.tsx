"use client";

import { useState } from "react";

type TabId = "summary" | "expenses" | "income";

const TABS: { id: TabId; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "expenses", label: "Expenses" },
  { id: "income", label: "Income" },
];

export default function DashboardPage() {
  const [tab, setTab] = useState<TabId>("summary");

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          OpenBooks
        </h1>
        <form action="/api/auth/logout" method="POST">
          <button
            type="submit"
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Sign out
          </button>
        </form>
      </header>

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
      </main>
    </div>
  );
}
