"use client";

import { useState } from "react";

type Status =
  | { kind: "idle" }
  | { kind: "submitting"; action: "approve" | "deny" }
  | { kind: "approved" }
  | { kind: "denied" }
  | { kind: "error"; message: string };

export default function ApproveControls({ userCode }: { userCode: string }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function send(action: "approve" | "deny") {
    if (status.kind === "submitting") return;
    setStatus({ kind: "submitting", action });
    try {
      const res = await fetch("/api/auth/device/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_code: userCode,
          deny: action === "deny",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? `http_${res.status}`);
      }
      setStatus({ kind: action === "deny" ? "denied" : "approved" });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "unknown_error",
      });
    }
  }

  if (status.kind === "approved") {
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-accent)]">
          authorized
        </p>
        <p className="text-[13px] text-[var(--color-ink)]">
          you can close this tab and return to your terminal.
        </p>
      </div>
    );
  }

  if (status.kind === "denied") {
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-muted)]">
          denied
        </p>
        <p className="text-[13px] text-[var(--color-ink)]">
          the request was rejected. your terminal will show an error.
        </p>
      </div>
    );
  }

  const submittingApprove =
    status.kind === "submitting" && status.action === "approve";
  const submittingDeny =
    status.kind === "submitting" && status.action === "deny";
  const disabled = status.kind === "submitting";

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex w-full flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => send("approve")}
          disabled={disabled}
          className="inline-flex flex-1 items-center justify-center rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)] transition hover:border-[var(--color-accent)]/70 hover:bg-[var(--color-accent)]/20 disabled:pointer-events-none disabled:opacity-40"
        >
          {submittingApprove ? "authorizing…" : "authorize"}
        </button>
        <button
          type="button"
          onClick={() => send("deny")}
          disabled={disabled}
          className="inline-flex flex-1 items-center justify-center rounded-md border border-white/10 bg-transparent px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-white/25 hover:text-[var(--color-ink)] disabled:pointer-events-none disabled:opacity-40"
        >
          {submittingDeny ? "denying…" : "deny"}
        </button>
      </div>

      {status.kind === "error" && (
        <p className="text-center font-mono text-[11px] text-red-400">
          {status.message === "unauthenticated"
            ? "session expired — sign in and retry"
            : status.message === "invalid_code" ||
                status.message === "expired" ||
                status.message === "already_resolved"
              ? "this request is no longer valid — start a new one from your terminal"
              : "something went wrong — try again"}
        </p>
      )}
    </div>
  );
}
