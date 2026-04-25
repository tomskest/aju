"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  organizationId: string;
};

/**
 * Pair of buttons for the team-join prompt. Keeps the parent page a
 * pure server component — all interactivity lives here.
 */
export default function JoinActions({ organizationId }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestAccess() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/orgs/${encodeURIComponent(organizationId)}/access-requests`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `request failed (${res.status})`);
      }
      router.push("/app?access_requested=1");
    } catch (e) {
      setError(e instanceof Error ? e.message : "something went wrong");
      setSubmitting(false);
    }
  }

  function decline() {
    router.push("/app");
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <button
        type="button"
        onClick={requestAccess}
        disabled={submitting}
        className="inline-flex items-center justify-center rounded-md bg-[var(--color-accent)] px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.2em] text-[#050608] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "requesting…" : "request access"}
      </button>
      <button
        type="button"
        onClick={decline}
        disabled={submitting}
        className="inline-flex items-center justify-center rounded-md border border-white/10 px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        no thanks
      </button>
      {error && (
        <p
          role="alert"
          className="text-center font-mono text-[11px] text-[var(--color-accent)]"
        >
          {error}
        </p>
      )}
    </div>
  );
}
