"use client";

import { useEffect, useRef, useState } from "react";

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "sent" }
  | { kind: "waitlisted" }
  | { kind: "error"; message: string };

export default function LoginDropdown({
  siteKey,
  returnTo,
}: {
  siteKey: string;
  returnTo?: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const turnstileEnabled = siteKey.length > 0;

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
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
    if (open) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 40);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !turnstileEnabled) return;

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
      setToken(null);
    };
  }, [open, siteKey, turnstileEnabled]);

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
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
        setToken(null);
      }
    }
  }

  const submitting = status.kind === "submitting";
  const disabled = submitting || !email || (turnstileEnabled && !token);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-[var(--color-panel)]/85 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)] backdrop-blur-sm transition hover:border-[var(--color-accent)]/40 hover:text-[var(--color-accent)]"
      >
        <span>log in</span>
        <span
          aria-hidden
          className={`transition ${open ? "rotate-180" : ""}`}
        >
          ↓
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="log in"
          className="absolute right-0 top-[calc(100%+8px)] z-40 w-[320px] overflow-hidden rounded-xl border border-white/10 bg-[var(--color-panel)]/95 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)] backdrop-blur"
        >
          <div className="border-b border-white/5 px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
              sign in
            </p>
            <p className="mt-1 text-[12px] text-[var(--color-muted)]">
              we&apos;ll email you a magic link.
            </p>
          </div>

          {status.kind === "sent" ? (
            <div className="px-4 py-4">
              <p className="text-[13px] text-[var(--color-ink)]">
                <span className="text-[var(--color-accent)]">✓</span> check your
                inbox for a sign-in link.
              </p>
            </div>
          ) : status.kind === "waitlisted" ? (
            <div className="px-4 py-4">
              <p className="text-[13px] text-[var(--color-ink)]">
                beta cohort is full — you&apos;re on the waitlist.
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-3 px-4 py-3">
              <div className="flex items-center gap-2 rounded-md border border-white/10 bg-[var(--color-bg)]/60 px-3 py-2 font-mono text-[12px]">
                <span className="select-none text-[var(--color-accent)]">
                  &gt;
                </span>
                <input
                  ref={inputRef}
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
              </div>

              {turnstileEnabled && (
                <div ref={widgetRef} className="flex justify-center" />
              )}

              <button
                type="submit"
                disabled={disabled}
                className="inline-flex items-center justify-center rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)] transition hover:border-[var(--color-accent)]/70 hover:bg-[var(--color-accent)]/20 disabled:opacity-40 disabled:pointer-events-none"
              >
                {submitting ? "sending…" : "send link"}
              </button>

              {status.kind === "error" && (
                <p className="font-mono text-[11px] text-red-400">
                  {status.message === "turnstile_failed"
                    ? "bot check failed — try again"
                    : "something went wrong — try again"}
                </p>
              )}
            </form>
          )}
        </div>
      )}
    </div>
  );
}
