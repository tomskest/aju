"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type OrgListItem = {
  id: string;
  name: string;
  slug: string;
  role: string;
  isPersonal: boolean;
  memberCount?: number;
  brainCount?: number;
};

type OrgsResponse = {
  orgs?: OrgListItem[];
  activeOrganizationId?: string | null;
};

type DecoratedOrg = OrgListItem & { isActive: boolean };

function normalizeOrgs(data: OrgsResponse): {
  items: DecoratedOrg[];
  activeId: string | null;
} {
  const raw = data.orgs ?? [];
  const activeId = data.activeOrganizationId ?? null;
  const items = raw.map((o) => ({
    ...o,
    isActive: activeId ? o.id === activeId : false,
  }));
  return { items, activeId };
}

export default function OrgSwitcher() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<DecoratedOrg[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const createInputRef = useRef<HTMLInputElement | null>(null);

  async function loadOrgs() {
    setLoading(true);
    try {
      const res = await fetch("/api/orgs", { credentials: "same-origin" });
      if (!res.ok) {
        setOrgs([]);
        setLoading(false);
        return;
      }
      const data = (await res.json()) as OrgsResponse;
      setOrgs(normalizeOrgs(data).items);
    } catch {
      setOrgs([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOrgs();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!createOpen) return;
    const id = window.setTimeout(() => createInputRef.current?.focus(), 40);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !creating) setCreateOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("keydown", onKey);
    };
  }, [createOpen, creating]);

  const active = orgs.find((o) => o.isActive);
  const others = orgs.filter((o) => !o.isActive);

  async function onSwitch(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${id}/switch`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setError(text || "failed to switch org");
        setBusyId(null);
        return;
      }
      setOpen(false);
      setBusyId(null);
      router.refresh();
      // Refresh the list so the active marker moves.
      loadOrgs();
    } catch {
      setError("failed to switch org");
      setBusyId(null);
    }
  }

  function openCreateModal() {
    setError(null);
    setNewOrgName("");
    setCreateOpen(true);
  }

  async function onCreateSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = newOrgName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/orgs", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setError(text || "failed to create org");
        setCreating(false);
        return;
      }
      const data = (await res.json()) as {
        id?: string;
        org?: { id?: string };
        organization?: { id?: string };
      };
      const newId =
        data.id ?? data.org?.id ?? data.organization?.id ?? null;
      setCreating(false);
      setCreateOpen(false);
      setOpen(false);
      setNewOrgName("");
      if (newId) {
        router.push(`/app/orgs/${newId}/settings`);
      } else {
        router.push("/app/orgs");
      }
      router.refresh();
    } catch {
      setError("failed to create org");
      setCreating(false);
    }
  }

  const label = active
    ? active.name
    : loading
      ? "loading…"
      : "no organization";
  const slug = active?.slug ?? "";

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex max-w-[240px] items-center gap-2 rounded-full border border-white/10 bg-[var(--color-panel)]/60 px-3 py-1.5 text-left transition hover:border-white/20 hover:bg-[var(--color-panel)]/90"
      >
        <span
          className="size-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
          aria-hidden
        />
        <span className="truncate text-[12px] text-[var(--color-ink)]">
          {label}
        </span>
        {slug && (
          <span className="hidden truncate font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-faint)] sm:inline">
            {slug}
          </span>
        )}
        <span
          aria-hidden
          className={`ml-1 select-none font-mono text-[10px] text-[var(--color-muted)] transition ${
            open ? "rotate-180" : ""
          }`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+8px)] z-30 w-[300px] overflow-hidden rounded-xl border border-white/10 bg-[var(--color-panel)]/95 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)] backdrop-blur"
        >
          <div className="border-b border-white/5 px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
              active organization
            </p>
            {active ? (
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] text-[var(--color-ink)]">
                    {active.name}
                  </span>
                  <span className="truncate font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
                    {active.slug} · {active.role}
                  </span>
                </div>
                <span
                  className="size-2 shrink-0 rounded-full bg-[var(--color-accent)]"
                  aria-hidden
                />
              </div>
            ) : (
              <p className="mt-1 text-[12px] text-[var(--color-muted)]">
                {loading ? "loading…" : "no organization selected"}
              </p>
            )}
          </div>

          {others.length > 0 && (
            <div className="max-h-[240px] overflow-y-auto border-b border-white/5 py-1">
              <p className="px-4 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
                switch to
              </p>
              <ul role="none" className="flex flex-col">
                {others.map((o) => {
                  const busy = busyId === o.id;
                  return (
                    <li key={o.id}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => onSwitch(o.id)}
                        disabled={busy}
                        className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left transition hover:bg-white/[0.04] disabled:opacity-60"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-[13px] text-[var(--color-ink)]">
                            {o.name}
                          </span>
                          <span className="truncate font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
                            {o.slug} · {o.role}
                            {o.isPersonal ? " · personal" : ""}
                          </span>
                        </span>
                        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
                          {busy ? "…" : "switch"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="flex flex-col">
            <button
              type="button"
              role="menuitem"
              onClick={openCreateModal}
              disabled={creating}
              className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-white/[0.04] disabled:opacity-60"
            >
              <span className="text-[13px] text-[var(--color-ink)]">
                {creating ? "creating…" : "Create organization"}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)]">
                new
              </span>
            </button>
            <Link
              href="/app/orgs"
              className="flex w-full items-center justify-between gap-3 border-t border-white/5 px-4 py-2.5 text-left transition hover:bg-white/[0.04]"
            >
              <span className="text-[12px] text-[var(--color-muted)]">
                manage organizations
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
                →
              </span>
            </Link>
          </div>

          {error && (
            <p className="border-t border-white/5 px-4 py-2 font-mono text-[11px] text-[var(--color-accent)]">
              {error}
            </p>
          )}
        </div>
      )}

      {createOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="create organization"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !creating) setCreateOpen(false);
          }}
        >
          <form
            onSubmit={onCreateSubmit}
            className="w-[min(420px,calc(100vw-32px))] overflow-hidden rounded-xl border border-white/10 bg-[var(--color-panel)]/95 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur"
          >
            <div className="border-b border-white/5 px-5 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
                new organization
              </p>
              <p className="mt-1 text-[14px] text-[var(--color-ink)]">
                name your new organization
              </p>
            </div>

            <div className="px-5 py-4">
              <div className="flex items-center gap-2 rounded-md border border-white/10 bg-[var(--color-bg)]/60 px-3 py-2 font-mono text-[13px] focus-within:border-[var(--color-accent)]/50">
                <span className="select-none text-[var(--color-accent)]">
                  &gt;
                </span>
                <input
                  ref={createInputRef}
                  type="text"
                  required
                  maxLength={120}
                  placeholder="acme inc."
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  className="flex-1 bg-transparent text-[var(--color-ink)] placeholder:text-[var(--color-faint)] outline-none"
                  aria-label="organization name"
                />
              </div>
              {error && (
                <p className="mt-2 font-mono text-[11px] text-red-400">
                  {error}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-white/5 bg-black/20 px-5 py-3">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
                className="inline-flex items-center rounded-md border border-white/10 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)] disabled:opacity-40"
              >
                cancel
              </button>
              <button
                type="submit"
                disabled={creating || !newOrgName.trim()}
                className="inline-flex items-center rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)] transition hover:border-[var(--color-accent)]/70 hover:bg-[var(--color-accent)]/20 disabled:opacity-40 disabled:pointer-events-none"
              >
                {creating ? "creating…" : "create"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
