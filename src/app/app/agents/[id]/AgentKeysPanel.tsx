"use client";

import { useEffect, useState } from "react";

/**
 * Keys panel on the agent detail page. Lists existing agent-scoped keys,
 * lets owners/admins mint a new one (one-time plaintext reveal), and revokes
 * via the existing `/api/keys/[id]` endpoint (any key the caller can see).
 */

type AgentKey = {
  id: string;
  prefix: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  mintedByUserId: string;
};

type ListResp = { keys: AgentKey[] };

type CreateResp = {
  key: {
    id: string;
    prefix: string;
    name: string;
    scopes: string[];
    createdAt: string;
    expiresAt: string | null;
    agentId: string;
  };
  plaintext: string;
  warning?: string;
};

type Props = {
  agentId: string;
  canManage: boolean;
};

function formatDate(s: string | null): string {
  if (!s) return "—";
  return s.slice(0, 10);
}

function formatRelative(s: string | null): string {
  if (!s) return "never";
  const d = new Date(s);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const dd = Math.floor(h / 24);
  if (dd < 30) return `${dd}d ago`;
  return d.toISOString().slice(0, 10);
}

function statusOf(k: AgentKey): "active" | "revoked" | "expired" {
  if (k.revokedAt) return "revoked";
  if (k.expiresAt && Date.parse(k.expiresAt) <= Date.now()) return "expired";
  return "active";
}

export default function AgentKeysPanel({ agentId, canManage }: Props) {
  const [keys, setKeys] = useState<AgentKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reveal, setReveal] = useState<CreateResp | null>(null);
  const [copied, setCopied] = useState(false);

  async function loadKeys() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/keys`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `failed (${res.status})`);
      }
      const data = (await res.json()) as ListResp;
      setKeys(data.keys);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setErr("name required");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/keys`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `failed (${res.status})`);
      }
      const data = (await res.json()) as CreateResp;
      setReveal(data);
      setName("");
      setOpen(false);
      loadKeys();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "create failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function onRevoke(id: string, label: string) {
    if (!confirm(`Revoke key ${label}?`)) return;
    try {
      const res = await fetch(`/api/keys/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `failed (${res.status})`);
      }
      loadKeys();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "revoke failed");
    }
  }

  async function copyPlaintext() {
    if (!reveal) return;
    try {
      await navigator.clipboard.writeText(reveal.plaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked — plaintext stays visible.
    }
  }

  const activeKeys = keys.filter((k) => statusOf(k) === "active").length;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
          api keys — {activeKeys} active · {keys.length} total
        </p>
        {canManage && !open && !reveal && (
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setErr(null);
            }}
            className="inline-flex items-center rounded-md bg-[var(--color-accent)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[#050608] transition hover:opacity-90"
          >
            create agent key
          </button>
        )}
      </div>

      {reveal && (
        <div className="flex flex-col gap-3 rounded-xl border border-[var(--color-accent)]/30 bg-[var(--color-panel)]/85 p-5">
          <div className="flex flex-col gap-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
              new key · copy now
            </p>
            <h3 className="text-[15px] font-light text-[var(--color-ink)]">
              {reveal.key.name}
            </h3>
            <p className="max-w-[560px] text-[12px] leading-6 text-[var(--color-muted)]">
              {reveal.warning ??
                "Save this key now. It will not be shown again."}
            </p>
          </div>
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
              onClick={() => setReveal(null)}
              className="inline-flex items-center rounded-md border border-white/10 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
            >
              I saved it
            </button>
          </div>
        </div>
      )}

      {open && !reveal && (
        <form
          onSubmit={onCreate}
          className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5"
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
              placeholder="e.g. ci bot, cron"
              className="rounded-md border border-white/10 bg-[var(--color-bg)] px-3 py-2 font-mono text-[13px] text-[var(--color-ink)] outline-none transition placeholder:text-[var(--color-faint)] focus:border-white/30 disabled:opacity-60"
            />
          </label>
          {err && (
            <p
              role="alert"
              className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)]"
            >
              {err}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center rounded-md bg-[var(--color-accent)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[#050608] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "minting…" : "create key"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setName("");
                setErr(null);
              }}
              disabled={submitting}
              className="inline-flex items-center rounded-md border border-white/10 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              cancel
            </button>
          </div>
        </form>
      )}

      {err && !open && (
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)]">
          {err}
        </p>
      )}

      {loading ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
          loading…
        </p>
      ) : keys.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 bg-[var(--color-panel)]/40 p-4 text-[13px] text-[var(--color-muted)]">
          No keys yet. Agents can&rsquo;t act on anything until you mint one.
        </p>
      ) : (
        <ul className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/10">
          {keys.map((k) => {
            const status = statusOf(k);
            const dim = status !== "active";
            return (
              <li
                key={k.id}
                className={`flex flex-col gap-2 bg-[var(--color-panel)]/40 px-5 py-3 md:flex-row md:items-center md:justify-between ${
                  dim ? "opacity-60" : ""
                }`}
              >
                <div className="flex flex-col gap-0.5">
                  <code className="font-mono text-[13px] text-[var(--color-ink)]">
                    {k.prefix}
                  </code>
                  <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                    {k.name} · {k.scopes.join(",")}
                  </span>
                </div>
                <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
                  <span>created {formatDate(k.createdAt)}</span>
                  <span>used {formatRelative(k.lastUsedAt)}</span>
                  <span
                    className={`rounded border px-1.5 py-0.5 ${
                      status === "active"
                        ? "border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 text-[var(--color-accent)]"
                        : "border-white/10 bg-black/30 text-[var(--color-faint)]"
                    }`}
                  >
                    {status}
                  </span>
                  {canManage && status === "active" && (
                    <button
                      type="button"
                      onClick={() => onRevoke(k.id, k.name)}
                      className="rounded border border-white/10 px-2 py-0.5 text-[var(--color-muted)] transition hover:border-[var(--color-accent)]/40 hover:text-[var(--color-accent)]"
                    >
                      revoke
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
