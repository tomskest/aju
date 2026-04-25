"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Props = {
  organizationId: string;
  initialValue: boolean;
};

/**
 * Toggle for the org's `autoAcceptDomainRequests` flag. Optimistically flips
 * the UI, rolls back on error. Wired to PATCH /api/orgs/:id.
 */
export default function AutoAcceptToggle({
  organizationId,
  initialValue,
}: Props) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function onToggle() {
    if (submitting) return;
    const next = !value;
    setValue(next);
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/orgs/${encodeURIComponent(organizationId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ autoAcceptDomainRequests: next }),
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
      setValue(!next);
      setError(e instanceof Error ? e.message : "toggle failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-[var(--color-panel)]/60 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            auto-accept domain requests
          </p>
          <p className="max-w-[460px] text-[12px] leading-5 text-[var(--color-muted)]">
            When on, users signing up with a verified domain join this org
            automatically. When off, they must request access.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={value}
          aria-label="Toggle auto-accept domain requests"
          onClick={onToggle}
          disabled={submitting}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-white/10 transition disabled:cursor-not-allowed disabled:opacity-60 ${
            value ? "bg-[var(--color-accent)]/30" : "bg-[var(--color-panel)]"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 rounded-full shadow transition-transform ${
              value
                ? "translate-x-6 bg-[var(--color-accent)]"
                : "translate-x-1 bg-[var(--color-muted)]"
            }`}
          />
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)]"
        >
          {error}
        </p>
      )}
    </div>
  );
}
