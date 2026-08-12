"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  tier: "pro" | "team";
  interval: "monthly" | "yearly";
  /** Required for the Team tier. Omitted means "ask the user to pick an org". */
  organizationId?: string;
  /**
   * Eligible orgs when the invoice target is ambiguous: someone who admins
   * several orgs still needs a way to buy Team, so given two or more entries
   * the button grows a chooser instead of the caller guessing for them.
   */
  orgs?: { id: string; name: string }[];
  signedIn: boolean;
  label: string;
  emphasis?: boolean;
};

/**
 * Starts a Checkout Session and hands the browser to Stripe.
 *
 * The redirect target is minted server-side and never trusted from props:
 * a price id living in the client would let anyone open a session against
 * whatever price they liked.
 */
export default function CheckoutButton({
  tier,
  interval,
  organizationId,
  orgs,
  signedIn,
  label,
  emphasis = false,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The org the checkout bills to: the explicit prop when the caller already
  // knew it, otherwise whichever entry of the chooser is selected.
  const [orgId, setOrgId] = useState(organizationId ?? orgs?.[0]?.id);

  const base =
    "inline-flex w-full items-center justify-center rounded-lg px-5 py-3 font-mono text-[12px] uppercase tracking-[0.2em] transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const tone = emphasis
    ? "bg-[var(--color-accent)] text-black hover:bg-[var(--color-accent)]/85"
    : "border border-white/15 text-[var(--color-ink)] hover:border-white/30 hover:bg-white/[0.04]";

  async function start() {
    if (!signedIn) {
      router.push("/?signup=1");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, interval, organizationId: orgId }),
      });
      const data = await res.json();

      if (!res.ok) {
        // 409 means they already hold this plan — the useful move is to send
        // them somewhere they can manage it, not to repeat the error.
        if (res.status === 409) {
          router.push(tier === "pro" ? "/app/usage" : "/app/orgs");
          return;
        }
        setError(
          data?.error === "organization_id_required"
            ? "Pick an organization to bill this to."
            : "Could not start checkout. Please try again.",
        );
        return;
      }

      if (data?.url) window.location.href = data.url;
      else setError("Could not start checkout. Please try again.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {orgs && orgs.length > 0 && (
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
            bill to
          </span>
          <select
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border border-white/10 bg-[var(--color-bg)] px-3 py-2 font-mono text-[12px] text-[var(--color-ink)] outline-none transition focus:border-white/30 disabled:opacity-60"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className={`${base} ${tone}`}
      >
        {busy ? "starting…" : label}
      </button>
      {error && (
        <p role="alert" className="text-[11px] leading-5 text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
