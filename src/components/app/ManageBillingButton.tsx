"use client";

import { useState } from "react";

type Props = {
  /** Omit to manage your own Pro plan; pass an org id for its Team plan. */
  organizationId?: string;
  label?: string;
};

/**
 * Opens a Stripe Customer Portal session.
 *
 * Everything a subscriber might want to change — card, billing address, VAT
 * id, monthly/yearly, invoices, cancellation — lives in the portal. Rebuilding
 * any of it here would mean reimplementing proration and dunning UI that
 * Stripe already maintains.
 */
export default function ManageBillingButton({
  organizationId,
  label = "manage billing",
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(organizationId ? { organizationId } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data?.error === "no_subscription"
            ? "No subscription to manage yet."
            : "Could not open the billing portal.",
        );
        return;
      }
      if (data?.url) window.location.href = data.url;
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className="inline-flex items-center justify-center rounded-lg border border-white/15 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-ink)] transition-colors hover:border-white/30 hover:bg-white/[0.04] disabled:opacity-50"
      >
        {busy ? "opening…" : label}
      </button>
      {error && (
        <p role="alert" className="text-[11px] leading-5 text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
