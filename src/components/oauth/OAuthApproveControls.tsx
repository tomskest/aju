"use client";

import { useState } from "react";

type ApprovePayload = {
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string;
};

type Status =
  | { kind: "idle" }
  | { kind: "submitting"; action: "approve" | "deny" }
  | { kind: "error"; message: string };

export default function OAuthApproveControls({
  payload,
}: {
  payload: ApprovePayload;
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function send(action: "approve" | "deny") {
    if (status.kind === "submitting") return;
    setStatus({ kind: "submitting", action });
    try {
      const res = await fetch("/api/oauth/authorize/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, action }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        redirect_url?: string;
        error?: string;
      };
      if (!res.ok || !data.redirect_url) {
        throw new Error(data.error ?? `http_${res.status}`);
      }
      // Hand control to the OAuth client's redirect_uri.
      window.location.href = data.redirect_url;
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "unknown_error",
      });
    }
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
            : "something went wrong — try again"}
        </p>
      )}
    </div>
  );
}
