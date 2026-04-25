"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Props = {
  organizationId: string;
  domainId: string;
  domain: string;
};

/**
 * Delete a claimed domain. Two-click confirm to avoid accidents — losing a
 * verified domain means users with that email can't auto-join again.
 */
export default function RemoveDomainButton({
  organizationId,
  domainId,
  domain,
}: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRemove() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/orgs/${encodeURIComponent(organizationId)}/domains/${encodeURIComponent(domainId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          typeof data?.error === "string" ? data.error : `failed (${res.status})`,
        );
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setConfirming(false);
      setError(e instanceof Error ? e.message : "remove failed");
    } finally {
      setSubmitting(false);
    }
  }

  const busy = pending || submitting;

  return (
    <div className="flex items-center justify-end gap-2">
      {confirming ? (
        <>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            aria-label={`Confirm remove ${domain}`}
            className="rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)] transition hover:bg-[var(--color-accent)]/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "…" : "confirm"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="rounded-md border border-white/10 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={busy}
          className="rounded-md border border-white/10 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          remove
        </button>
      )}
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
