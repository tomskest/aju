"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  token: string;
  orgSlug: string;
};

/**
 * Paired accept/decline buttons for the public invitation page.
 *
 * Both actions hit JSON POST endpoints and then hand control back to the
 * browser via a full navigation (`window.location`) so the active-org cookie
 * the accept route sets is picked up by the next render.
 */
export default function AcceptControls({ token, orgSlug }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    if (busy) return;
    setBusy("accept");
    setError(null);
    try {
      const res = await fetch(
        `/api/invitations/${encodeURIComponent(token)}/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (res.status === 403 && body?.error === "email_mismatch") {
          throw new Error("this invitation is for a different email");
        }
        if (res.status === 404) {
          throw new Error("this invitation is no longer valid");
        }
        throw new Error(body?.error ?? `accept failed (${res.status})`);
      }
      // Use a real navigation so the freshly-set active-org cookie ships
      // with the next request.
      window.location.href = `/app/orgs/${orgSlug}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "something went wrong");
      setBusy(null);
    }
  }

  async function decline() {
    if (busy) return;
    setBusy("decline");
    setError(null);
    try {
      const res = await fetch(
        `/api/invitations/${encodeURIComponent(token)}/decline`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      // Decline is idempotent — any 2xx means done.
      if (!res.ok) {
        throw new Error(`decline failed (${res.status})`);
      }
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "something went wrong");
      setBusy(null);
    }
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {error && (
        <p
          role="alert"
          className="text-center font-mono text-[11px] text-red-400"
        >
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={accept}
        disabled={busy !== null}
        className="inline-flex items-center justify-center rounded-md bg-[var(--color-accent)] px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.2em] text-[#050608] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy === "accept" ? "accepting…" : "accept invitation"}
      </button>
      <button
        type="button"
        onClick={decline}
        disabled={busy !== null}
        className="inline-flex items-center justify-center rounded-md border border-white/10 px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy === "decline" ? "declining…" : "decline"}
      </button>
    </div>
  );
}
