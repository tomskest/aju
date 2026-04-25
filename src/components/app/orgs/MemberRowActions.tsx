"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ORG_ROLES, type OrgRole } from "@/lib/tenant/types";

type Props = {
  organizationId: string;
  userId: string;
  email: string;
  currentRole: OrgRole;
  canManage: boolean;
  canChangeRole: boolean;
  canRemove: boolean;
};

/**
 * Inline actions for a single member row — role select + remove button.
 *
 * Both actions are wired directly to the member API and call
 * `router.refresh()` on success so the server component re-reads from the
 * database. Errors are surfaced inline in the row.
 */
export default function MemberRowActions({
  organizationId,
  userId,
  email,
  currentRole,
  canManage,
  canChangeRole,
  canRemove,
}: Props) {
  const router = useRouter();
  const [role, setRole] = useState<OrgRole>(currentRole);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  async function onChangeRole(next: OrgRole) {
    if (next === role) return;
    setError(null);
    const prev = role;
    setRole(next);
    try {
      const res = await fetch(
        `/api/orgs/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: next }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const code = typeof data?.error === "string" ? data.error : null;
        if (code === "last_owner") {
          throw new Error("cannot demote the last owner");
        }
        throw new Error(code || `failed (${res.status})`);
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setRole(prev);
      setError(e instanceof Error ? e.message : "change failed");
    }
  }

  async function onRemove() {
    setError(null);
    try {
      const res = await fetch(
        `/api/orgs/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const code = typeof data?.error === "string" ? data.error : null;
        if (code === "last_owner") {
          throw new Error("cannot remove the last owner");
        }
        throw new Error(code || `failed (${res.status})`);
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setConfirmingRemove(false);
      setError(e instanceof Error ? e.message : "remove failed");
    }
  }

  if (!canManage) {
    return (
      <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
        {currentRole}
      </span>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-1.5 md:flex-row md:items-center md:justify-end md:gap-2">
      {canChangeRole ? (
        <select
          value={role}
          disabled={pending}
          onChange={(e) => onChangeRole(e.target.value as OrgRole)}
          aria-label={`Change role for ${email}`}
          className="rounded-md border border-white/10 bg-[var(--color-panel)] px-2 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink)] outline-none transition hover:border-white/20 focus:border-white/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {ORG_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      ) : (
        <span className="inline-flex items-center justify-center rounded-md border border-white/5 bg-[var(--color-panel)]/60 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
          {currentRole}
        </span>
      )}

      {canRemove &&
        (confirmingRemove ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onRemove}
              disabled={pending}
              className="rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)] transition hover:bg-[var(--color-accent)]/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRemove(false)}
              disabled={pending}
              className="rounded-md border border-white/10 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingRemove(true)}
            disabled={pending}
            className="rounded-md border border-white/10 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            remove
          </button>
        ))}

      {error && (
        <p
          role="alert"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)] md:ml-2"
        >
          {error}
        </p>
      )}
    </div>
  );
}
