"use client";

import { useEffect, useRef, useState } from "react";
import {
  ValidationBadge,
  type ValidationState,
  type ValidationStatus,
} from "./ValidationBadge";
import LocalDate from "@/components/kb/LocalDate";

type LogEntry = {
  id: string;
  fromStatus: string;
  toStatus: string;
  source: string;
  changedBy: string | null;
  actorType: string | null;
  reason: string | null;
  createdAt: string;
};

type Props = {
  brainName: string;
  docPath: string;
  state: ValidationState | null;
  /**
   * Whether the current user can mutate validation. Personal brains:
   * owner-only. Org brains: editor or owner. Determined server-side via
   * `canValidate`. When false, the picker still renders the badge but
   * doesn't open the popover.
   */
  canEdit: boolean;
  /**
   * Called after a successful POST. Parent should refetch the doc state
   * (or call router.refresh) so the badge updates and the breakdown bar
   * reflects the new counts.
   */
  onChanged: (next: ValidationState) => void;
};

const OPTIONS: Array<{
  value: ValidationStatus;
  label: string;
  hint: string;
}> = [
  {
    value: "validated",
    label: "validated",
    hint: "I've reviewed this and confirm it's correct.",
  },
  {
    value: "stale",
    label: "stale",
    hint: "Was true but the source has shifted; treat with caution.",
  },
  {
    value: "disqualified",
    label: "disqualified",
    hint: "This is wrong or actively misleading. Hide from default search.",
  },
  {
    value: "unvalidated",
    label: "clear",
    hint: "Reset to unvalidated. Removes prior validation/disqualification pointers.",
  },
];

export default function ValidationPicker({
  brainName,
  docPath,
  state,
  canEdit,
  onChanged,
}: Props) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [history, setHistory] = useState<LogEntry[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Lazy-load history on first toggle. The recentLog ride-along on
  // /api/vault/validation/status would also work; using /validation/log
  // keeps the picker self-contained and gives us pagination later.
  const loadHistory = async () => {
    if (history !== null || historyLoading) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(
        `/api/vault/validation/log?brain=${encodeURIComponent(brainName)}&path=${encodeURIComponent(docPath)}&limit=20`,
      );
      if (!res.ok) return;
      const body = (await res.json()) as { entries: LogEntry[] };
      setHistory(body.entries);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Outside-click + Escape close. Mirrors the pattern other inline panels
  // in the brain explorer use; no portal needed because the popover
  // anchors to the button in the doc header.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !popoverRef.current?.contains(target) &&
        !buttonRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const fallback: ValidationState = state ?? {
    status: "unvalidated",
    provenance: "human",
    validatedAt: null,
    validatedBy: null,
  };

  const submit = async (status: ValidationStatus) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/vault/validate?brain=${encodeURIComponent(brainName)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            path: docPath,
            status,
            reason: reason.trim() || undefined,
            source: "web",
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "validation_failed");
        return;
      }
      const body = (await res.json()) as { validation: ValidationState };
      onChanged(body.validation);
      setReason("");
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!canEdit) {
    return <ValidationBadge state={fallback} />;
  }

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer transition hover:brightness-125"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <ValidationBadge state={fallback} />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 z-30 mt-2 w-80 rounded-md border border-white/10 bg-[var(--color-panel)] p-3 shadow-lg"
        >
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
            Set validation
          </p>
          <ul className="space-y-1">
            {OPTIONS.map((opt) => {
              const active = fallback.status === opt.value;
              return (
                <li key={opt.value}>
                  <button
                    type="button"
                    disabled={submitting || active}
                    onClick={() => submit(opt.value)}
                    className={`w-full rounded-md border px-3 py-2 text-left transition ${
                      active
                        ? "cursor-default border-[var(--color-accent)]/40 text-[var(--color-accent)]"
                        : "border-white/10 text-[var(--color-ink)] hover:border-white/30"
                    } disabled:opacity-50`}
                  >
                    <div className="font-mono text-[11px] uppercase tracking-[0.14em]">
                      {opt.label}
                      {active && (
                        <span className="ml-2 text-[10px] opacity-70">
                          (current)
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] leading-snug text-[var(--color-muted)]">
                      {opt.hint}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional reason (saved to history)"
            maxLength={500}
            className="mt-3 min-h-[44px] w-full resize-y rounded-md border border-white/10 bg-[var(--color-bg)] p-2 font-mono text-[11px] text-[var(--color-ink)] placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]/40 focus:outline-none"
          />
          {error && (
            <p className="mt-2 font-mono text-[10px] text-red-400">{error}</p>
          )}
          {fallback.validatedAt && (
            <p className="mt-2 font-mono text-[10px] text-[var(--color-faint)]">
              Validated <LocalDate value={fallback.validatedAt} format="datetime" />
              {fallback.validatedBy ? ` by ${fallback.validatedBy}` : ""}
            </p>
          )}
          <div className="mt-3 border-t border-white/5 pt-2">
            <button
              type="button"
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              onClick={() => {
                const next = !historyOpen;
                setHistoryOpen(next);
                if (next) void loadHistory();
              }}
            >
              {historyOpen ? "hide history ▴" : "show history ▾"}
            </button>
            {historyOpen && (
              <div className="mt-2 max-h-48 overflow-y-auto">
                {historyLoading && (
                  <p className="font-mono text-[10px] text-[var(--color-faint)]">
                    Loading…
                  </p>
                )}
                {!historyLoading && history !== null && history.length === 0 && (
                  <p className="font-mono text-[10px] text-[var(--color-faint)]">
                    No validation events yet.
                  </p>
                )}
                {history?.map((e) => (
                  <div
                    key={e.id}
                    className="mb-1 font-mono text-[10px] text-[var(--color-muted)]"
                  >
                    <span className="text-[var(--color-faint)]">
                      <LocalDate value={e.createdAt} format="datetime" />
                    </span>{" "}
                    <span>
                      {e.fromStatus} → <strong>{e.toStatus}</strong>
                    </span>
                    <span className="ml-1 text-[var(--color-faint)]">
                      via {e.source}
                      {e.changedBy ? ` (${e.changedBy})` : ""}
                    </span>
                    {e.reason && (
                      <span className="ml-1 italic">— {e.reason}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
