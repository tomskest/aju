"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type ScopeValue = "read" | "write" | "admin";

const ALL_SCOPES: ReadonlyArray<{ value: ScopeValue; label: string; hint: string }> = [
  { value: "read", label: "read", hint: "list + read notes, files, embeddings" },
  { value: "write", label: "write", hint: "create + update + delete notes" },
  { value: "admin", label: "admin", hint: "manage brains, keys, org settings" },
];

export type OrgOption = {
  id: string;
  name: string;
  slug: string;
  isPersonal: boolean;
};

type CreatedKey = {
  id: string;
  prefix: string;
  name: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
  organization: { id: string; name: string; slug: string } | null;
};

type CreateKeyResponse = {
  key: CreatedKey;
  plaintext: string;
  warning?: string;
};

/**
 * Inline "create API key" flow. Opens a panel with the form; on success it
 * swaps to a one-time plaintext reveal with a prominent copy button. We keep
 * all state local — the parent page re-renders via `router.refresh()` once
 * the user dismisses the reveal, so the new key shows up in the list.
 */
export default function CreateKeyForm({
  orgs,
  defaultOrgId,
}: {
  orgs: OrgOption[];
  defaultOrgId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ScopeValue[]>(["read", "write"]);
  const [expiresDays, setExpiresDays] = useState("");
  const [organizationId, setOrganizationId] = useState<string>(
    defaultOrgId ?? orgs[0]?.id ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reveal, setReveal] = useState<{ plaintext: string; key: CreatedKey } | null>(null);
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();

  function toggleScope(value: ScopeValue) {
    setScopes((curr) =>
      curr.includes(value) ? curr.filter((s) => s !== value) : [...curr, value],
    );
  }

  function reset() {
    setName("");
    setScopes(["read", "write"]);
    setExpiresDays("");
    setOrganizationId(defaultOrgId ?? orgs[0]?.id ?? "");
    setError(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError("name required");
      return;
    }
    if (scopes.length === 0) {
      setError("select at least one scope");
      return;
    }
    if (!organizationId) {
      setError("pick an organization");
      return;
    }

    let expiresInDays: number | undefined;
    if (expiresDays.trim()) {
      const n = Number(expiresDays);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        setError("expires must be a positive integer");
        return;
      }
      expiresInDays = n;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          scopes,
          expiresInDays,
          organizationId,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: unknown };
        throw new Error(
          typeof data.error === "string" ? data.error : `failed (${res.status})`,
        );
      }
      const data = (await res.json()) as CreateKeyResponse;
      setReveal({ plaintext: data.plaintext, key: data.key });
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyPlaintext() {
    if (!reveal) return;
    try {
      await navigator.clipboard.writeText(reveal.plaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API can be blocked — plaintext is visible, user can select.
    }
  }

  function dismissReveal() {
    setReveal(null);
    setOpen(false);
    setCopied(false);
    startTransition(() => router.refresh());
  }

  if (reveal) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-accent)]/30 bg-[var(--color-panel)]/85 p-5">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
            new key · copy now
          </p>
          <h3 className="text-[16px] font-light text-[var(--color-ink)]">
            {reveal.key.name}
          </h3>
          {reveal.key.organization && (
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
              pinned to {reveal.key.organization.name} ·{" "}
              <span className="text-[var(--color-faint)]">
                {reveal.key.organization.slug}
              </span>
            </p>
          )}
          <p className="max-w-[560px] text-[12px] leading-6 text-[var(--color-muted)]">
            Save this key now. It will not be shown again — if you lose it,
            revoke it from the list below and create a new one.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <code className="break-all rounded-md border border-white/10 bg-black/60 px-3 py-3 font-mono text-[13px] leading-6 text-[var(--color-ink)]">
            {reveal.plaintext}
          </code>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyPlaintext}
              className="inline-flex items-center rounded-md bg-[var(--color-accent)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[#050608] transition hover:opacity-90"
            >
              {copied ? "copied" : "copy key"}
            </button>
            <button
              type="button"
              onClick={dismissReveal}
              className="inline-flex items-center rounded-md border border-white/10 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
            >
              I saved it
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex self-start items-center rounded-md bg-[var(--color-accent)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[#050608] transition hover:opacity-90"
      >
        create api key
      </button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5"
    >
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
          name
        </span>
        <input
          type="text"
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={submitting}
          placeholder="e.g. laptop cli, ci bot, mcp client"
          className="rounded-md border border-white/10 bg-[var(--color-bg)] px-3 py-2 font-mono text-[13px] text-[var(--color-ink)] outline-none transition placeholder:text-[var(--color-faint)] focus:border-white/30 disabled:opacity-60"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
          scopes
        </legend>
        <div className="flex flex-col gap-1.5">
          {ALL_SCOPES.map((s) => (
            <label
              key={s.value}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-white/10 bg-[var(--color-bg)] px-3 py-2 transition hover:border-white/20"
            >
              <input
                type="checkbox"
                checked={scopes.includes(s.value)}
                onChange={() => toggleScope(s.value)}
                disabled={submitting}
                className="mt-1 size-3.5 accent-[var(--color-accent)]"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-mono text-[12px] uppercase tracking-[0.18em] text-[var(--color-ink)]">
                  {s.label}
                </span>
                <span className="text-[11px] leading-5 text-[var(--color-muted)]">
                  {s.hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
          organization
        </span>
        <select
          required
          value={organizationId}
          onChange={(e) => setOrganizationId(e.target.value)}
          disabled={submitting || orgs.length === 0}
          className="rounded-md border border-white/10 bg-[var(--color-bg)] px-3 py-2 font-mono text-[13px] text-[var(--color-ink)] outline-none transition focus:border-white/30 disabled:opacity-60"
        >
          {orgs.length === 0 ? (
            <option value="">no organizations available</option>
          ) : (
            orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.slug}){o.isPersonal ? " · personal" : ""}
              </option>
            ))
          )}
        </select>
        <span className="text-[11px] leading-5 text-[var(--color-muted)]">
          This key can only read and write inside this organization&rsquo;s
          database.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
          expires in (days, optional)
        </span>
        <input
          type="number"
          min={1}
          step={1}
          value={expiresDays}
          onChange={(e) => setExpiresDays(e.target.value)}
          disabled={submitting}
          placeholder="leave blank for no expiry"
          className="rounded-md border border-white/10 bg-[var(--color-bg)] px-3 py-2 font-mono text-[13px] text-[var(--color-ink)] outline-none transition placeholder:text-[var(--color-faint)] focus:border-white/30 disabled:opacity-60"
        />
      </label>

      {error && (
        <p
          role="alert"
          className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)]"
        >
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center rounded-md bg-[var(--color-accent)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[#050608] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "creating…" : "create key"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          disabled={submitting}
          className="inline-flex items-center rounded-md border border-white/10 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          cancel
        </button>
      </div>
    </form>
  );
}
