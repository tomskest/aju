"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ORG_ROLES, type OrgRole } from "@/lib/tenant/types";

type Props = {
  organizationId: string;
};

/**
 * Inline invite form that toggles open from a button. Posts to the
 * invitations endpoint and shows a transient success message on completion.
 */
export default function InviteMemberForm({ organizationId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSuccess(null);

    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setError("enter a valid email");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/orgs/${encodeURIComponent(organizationId)}/invitations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmed, role }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const code = typeof data?.error === "string" ? data.error : null;
        throw new Error(code || `failed (${res.status})`);
      }
      setSuccess("Invitation sent");
      setEmail("");
      setRole("member");
      startTransition(() => router.refresh());
      // Keep the success toast visible briefly.
      setTimeout(() => setSuccess(null), 2400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "send failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center rounded-md bg-[var(--color-accent)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[#050608] transition hover:opacity-90"
        >
          invite member
        </button>
        {success && (
          <span
            role="status"
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)]"
          >
            {success}
          </span>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-4"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <label className="flex flex-1 flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            email
          </span>
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            placeholder="teammate@example.com"
            className="rounded-md border border-white/10 bg-[var(--color-bg)] px-3 py-2 font-mono text-[13px] text-[var(--color-ink)] outline-none transition placeholder:text-[var(--color-faint)] focus:border-white/30 disabled:opacity-60"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            role
          </span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as OrgRole)}
            disabled={submitting}
            className="rounded-md border border-white/10 bg-[var(--color-bg)] px-3 py-2 font-mono text-[12px] uppercase tracking-[0.18em] text-[var(--color-ink)] outline-none transition focus:border-white/30 disabled:opacity-60"
          >
            {ORG_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center rounded-md bg-[var(--color-accent)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[#050608] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "sending…" : "send invite"}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setError(null);
              setSuccess(null);
            }}
            disabled={submitting}
            className="inline-flex items-center rounded-md border border-white/10 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            cancel
          </button>
        </div>
      </div>

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
