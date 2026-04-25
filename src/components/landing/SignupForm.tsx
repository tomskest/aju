"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        options: {
          sitekey: string;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact" | "flexible";
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
    __ajuTurnstileLoaded?: boolean;
  }
}

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "sent" }
  | { kind: "waitlisted" }
  | { kind: "error"; message: string };

export default function SignupForm({
  siteKey,
  returnTo,
  initialEmail,
}: {
  siteKey: string;
  returnTo?: string;
  initialEmail?: string;
}) {
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState(initialEmail ?? "");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // In dev we often run without a Turnstile site key. The server fails open
  // when TURNSTILE_SECRET_KEY is also missing (see src/lib/turnstile.ts), so
  // we skip the widget entirely and let the form submit directly.
  const turnstileEnabled = siteKey.length > 0;

  useEffect(() => {
    if (!turnstileEnabled) return;

    const loadScript = () => {
      if (window.__ajuTurnstileLoaded) return Promise.resolve();
      if (document.querySelector(`script[src^="${TURNSTILE_SCRIPT_SRC}"]`)) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve, reject) => {
        const s = document.createElement("script");
        s.src = TURNSTILE_SCRIPT_SRC;
        s.async = true;
        s.defer = true;
        s.onload = () => {
          window.__ajuTurnstileLoaded = true;
          resolve();
        };
        s.onerror = () => reject(new Error("turnstile script failed to load"));
        document.head.appendChild(s);
      });
    };

    let cancelled = false;
    loadScript().then(() => {
      if (cancelled || !widgetRef.current || !window.turnstile) return;
      widgetIdRef.current = window.turnstile.render(widgetRef.current, {
        sitekey: siteKey,
        theme: "dark",
        size: "flexible",
        callback: (t) => setToken(t),
        "expired-callback": () => setToken(null),
        "error-callback": () => setToken(null),
      });
    });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, turnstileEnabled]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email || status.kind === "submitting") return;
    if (turnstileEnabled && !token) return;
    setStatus({ kind: "submitting" });

    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          turnstileToken: token,
          ...(returnTo ? { returnTo } : {}),
        }),
      });
      const data = (await res.json()) as { status?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `http_${res.status}`);
      if (data.status === "waitlisted") {
        setStatus({ kind: "waitlisted" });
      } else {
        setStatus({ kind: "sent" });
      }
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "unknown_error",
      });
      // Reset Turnstile so user can retry
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
        setToken(null);
      }
    }
  }

  if (status.kind === "sent") {
    return (
      <Panel>
        <p className="text-center text-[13px] text-[var(--color-ink)]">
          <span className="text-[var(--color-accent)]">✓</span> check your inbox
          for a sign-in link.
        </p>
        <p className="mt-1 text-center font-mono text-[11px] text-[var(--color-muted)]">
          click the link to claim your slot.
        </p>
      </Panel>
    );
  }

  if (status.kind === "waitlisted") {
    return (
      <Panel>
        <p className="text-center text-[13px] text-[var(--color-ink)]">
          beta cohort is full — you&apos;re on the waitlist.
        </p>
        <p className="mt-1 text-center font-mono text-[11px] text-[var(--color-muted)]">
          we&apos;ll email when paid signups open.
        </p>
      </Panel>
    );
  }

  const submitting = status.kind === "submitting";
  const disabled = submitting || !email || (turnstileEnabled && !token);

  return (
    <form
      id="signup-form"
      onSubmit={onSubmit}
      className="flex w-full max-w-[520px] flex-col items-stretch gap-3 scroll-mt-24"
    >
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-[var(--color-panel)]/85 px-4 py-3 font-mono text-[13px] backdrop-blur-sm shadow-[0_10px_40px_-20px_rgba(0,0,0,0.9)]">
        <span className="select-none text-[var(--color-accent)]">&gt;</span>
        <input
          type="email"
          required
          inputMode="email"
          autoComplete="email"
          placeholder="you@somewhere.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 bg-transparent text-[var(--color-ink)] placeholder:text-[var(--color-faint)] outline-none"
          aria-label="email"
        />
        <button
          type="submit"
          disabled={disabled}
          className="inline-flex items-center rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)] transition hover:border-[var(--color-accent)]/70 hover:bg-[var(--color-accent)]/20 disabled:opacity-40 disabled:pointer-events-none"
          aria-label="send link"
        >
          {submitting ? "sending…" : "send link"}
        </button>
      </div>

      {turnstileEnabled && (
        <div ref={widgetRef} className="flex justify-center" />
      )}

      <p className="text-center font-mono text-[11px] text-[var(--color-faint)]">
        new? reserves your beta slot · returning? sends a sign-in link
      </p>

      {status.kind === "error" && (
        <p className="text-center font-mono text-[11px] text-red-400">
          {status.message === "turnstile_failed"
            ? "bot check failed — try again"
            : "something went wrong — try again"}
        </p>
      )}
    </form>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-[520px] rounded-xl border border-white/10 bg-[var(--color-panel)]/85 px-4 py-4 backdrop-blur-sm shadow-[0_10px_40px_-20px_rgba(0,0,0,0.9)]">
      {children}
    </div>
  );
}
