"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Single-password login. No username; one shared password (DASHBOARD_PASSWORD).
 */
export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Login failed");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 dark:bg-zinc-900">
      <main className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6 shadow dark:border-zinc-700 dark:bg-zinc-800">
        <h1 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          OpenBooks
        </h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          Enter the dashboard password.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="sr-only" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            autoComplete="current-password"
            className="rounded border border-zinc-300 px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
            disabled={loading}
          />
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-zinc-900 px-3 py-2 font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </main>
    </div>
  );
}
