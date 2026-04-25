"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { isPublicEmailDomain } from "@/lib/billing/public-email-blocklist";

type Props = {
  organizationId: string;
  /** Pre-filled from the current user's email domain when applicable. */
  suggestedDomain: string | null;
};

/**
 * Single-input form to claim a new domain for the org. Warns up-front on
 * public/disposable domains before the API rejects them.
 */
export default function ClaimDomainForm({
  organizationId,
  suggestedDomain,
}: Props) {
  const router = useRouter();
  const [domain, setDomain] = useState(suggestedDomain ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const trimmed = domain.trim().toLowerCase();
  const looksPublic =
    trimmed.length > 0 && isPublicEmailDomain(`x@${trimmed}`);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSuccess(null);

    if (trimmed.includes("@")) {
      setError("enter the domain only (e.g. example.com), not an email address");
      return;
    }
    if (!trimmed || !trimmed.includes(".")) {
      setError("enter a valid domain (example.com)");
      return;
    }
    if (looksPublic) {
      setError("public email domains cannot be claimed");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/orgs/${encodeURIComponent(organizationId)}/domains`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: trimmed }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const code = typeof data?.error === "string" ? data.error : null;
        if (code === "public_email_domain") {
          throw new Error("public email domains cannot be claimed");
        }
        if (code === "email_domain_mismatch") {
          throw new Error(
            "domain must match your email for self-service claim",
          );
        }
        if (code === "domain_already_claimed") {
          throw new Error("this domain is already claimed by another org");
        }
        if (code === "invalid_domain") {
          throw new Error("enter a valid domain (example.com)");
        }
        throw new Error(code || `failed (${res.status})`);
      }
      setSuccess("Domain claimed");
      setDomain("");
      startTransition(() => router.refresh());
      setTimeout(() => setSuccess(null), 2400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "claim failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-4"
    >
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
          claim new domain
        </span>
        <p className="text-[12px] leading-5 text-[var(--color-muted)]">
          Add a domain your team controls. The claim is verified by matching
          against your email domain — public providers (gmail.com,
          outlook.com, etc.) are blocked.
        </p>
      </div>
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <input
          type="text"
          required
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          disabled={submitting}
          placeholder="example.com"
          className="flex-1 rounded-md border border-white/10 bg-[var(--color-bg)] px-3 py-2 font-mono text-[13px] text-[var(--color-ink)] outline-none transition placeholder:text-[var(--color-faint)] focus:border-white/30 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={submitting || trimmed.length === 0}
          className="inline-flex items-center justify-center rounded-md bg-[var(--color-accent)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[#050608] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "claiming…" : "claim domain"}
        </button>
      </div>

      {looksPublic && (
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)]">
          warning: this looks like a public email domain
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)]"
        >
          {error}
        </p>
      )}
      {success && (
        <p
          role="status"
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)]"
        >
          {success}
        </p>
      )}
    </form>
  );
}
