"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Props = {
  requestId: string;
};

/**
 * Paired approve/deny buttons for a pending access request. Single click to
 * act — both mutations are low-risk in that a denied request can be re-sent.
 */
export default function AccessRequestActions({ requestId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "approve" | "deny") {
    if (submitting) return;
    setSubmitting(action);
    setError(null);
    try {
      const res = await fetch(
        `/api/access-requests/${encodeURIComponent(requestId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          typeof data?.error === "string" ? data.error : `failed (${res.status})`,
        );
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : `${action} failed`);
    } finally {
      setSubmitting(null);
    }
  }

  const busy = pending || submitting !== null;

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={() => run("approve")}
        disabled={busy}
        className="rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)] transition hover:bg-[var(--color-accent)]/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting === "approve" ? "approving…" : "approve"}
      </button>
      <button
        type="button"
        onClick={() => run("deny")}
        disabled={busy}
        className="rounded-md border border-white/10 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting === "deny" ? "denying…" : "deny"}
      </button>
      {error && (
        <span
          role="alert"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)]"
        >
          {error}
        </span>
      )}
    </div>
  );
}
