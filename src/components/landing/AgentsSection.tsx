"use client";

import { useEffect, useState } from "react";
import { Eyebrow, H2 } from "./LandingPrimitives";

/**
 * Agent provisioning + scoping story.
 *
 * Left card: device-flow activation (`aju agent-provision <name>`). The
 * browser URL is `aju.sh/cli-auth?code=...` — the same page used for
 * `aju login`, branching on `intent=agent`. Don't invent a separate
 * `/activate-agent` path; that's not wired up.
 *
 * Right card: scoping guarantees. Every ungranted brain is filtered out
 * at the SQL layer (brain_id = ANY($accessible)), so ungranted brains
 * literally don't appear in responses.
 */

type ActivateStep = {
  label: string;
  cmd?: string;
  out: Array<{ text: string; tone: "faint" | "ink" | "muted" | "accent" }>;
};

const ACTIVATE_STEPS: ActivateStep[] = [
  {
    label: "on new machine",
    cmd: "aju agent-provision openclaw",
    out: [
      { text: "requesting device code...", tone: "faint" },
      { text: "", tone: "faint" },
      { text: "  code: WXTR-8J2K", tone: "ink" },
      { text: "  open: aju.sh/cli-auth?code=WXTR-8J2K", tone: "ink" },
      { text: "", tone: "faint" },
      { text: "waiting for approval...", tone: "faint" },
    ],
  },
  {
    label: "on your laptop",
    cmd: "→ aju.sh/cli-auth",
    out: [
      { text: "mint a key for \"openclaw\"?", tone: "faint" },
      { text: "  brain: openclaw-sandbox", tone: "faint" },
      { text: "  role:  editor", tone: "faint" },
      { text: "  approver: you@somewhere.com", tone: "faint" },
      { text: "  audit:    device_code + intent=agent", tone: "faint" },
      { text: "✓ approved · key minted", tone: "accent" },
    ],
  },
  {
    label: "back on the machine",
    out: [
      { text: "✓ Provisioned as agent \"openclaw\"", tone: "accent" },
      { text: "  key → ~/.config/aju/config.json", tone: "muted" },
      { text: "  profile: openclaw", tone: "muted" },
      { text: "  brains:  1 (openclaw-sandbox · editor)", tone: "muted" },
    ],
  },
];

function toneClass(tone: "faint" | "ink" | "muted" | "accent"): string {
  switch (tone) {
    case "faint":
      return "text-[var(--color-faint)]";
    case "muted":
      return "text-[var(--color-muted)]";
    case "accent":
      return "text-[var(--color-accent)]";
    default:
      return "text-[var(--color-ink)]";
  }
}

export default function AgentsSection() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => {
      setActive((a) => (a + 1) % ACTIVATE_STEPS.length);
    }, 3600);
    return () => window.clearInterval(t);
  }, []);

  return (
    <section
      id="agents"
      className="relative z-[2] bg-transparent py-24"
    >
      <div className="mx-auto max-w-[1120px] px-8">
        <Eyebrow>05 · connect agents</Eyebrow>
        <H2>
          give agents a key.
          <br />
          <em className="not-italic text-[var(--color-faint)]">
            never more than they need.
          </em>
        </H2>
        <p className="mt-5 max-w-[680px] text-[18px] font-light leading-[1.55] text-[var(--color-muted)]">
          each agent is a first-class identity — a named principal with its
          own keys, its own grants, its own audit trail. no shared
          credentials, no default access.
        </p>

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* LEFT — device-flow activation */}
          <div className="flex flex-col gap-4 rounded-[14px] border border-white/10 bg-[rgba(14,15,18,0.82)] p-7 shadow-[0_10px_40px_-20px_rgba(0,0,0,0.9)] backdrop-blur-md">
            <div className="flex items-center justify-between gap-3">
              <Eyebrow>device-flow activation</Eyebrow>
              <span className="rounded border border-white/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
                no pasted keys
              </span>
            </div>
            <p className="m-0 text-[13px] leading-[1.7] text-[var(--color-muted)]">
              mint per-machine keys without pasting. start provisioning on
              the remote box; approve in your browser. the plaintext key is
              delivered back over TLS — never in your shell history.
            </p>

            <div className="flex flex-col gap-1.5">
              {ACTIVATE_STEPS.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActive(i)}
                  className={`rounded-lg border px-3 py-2.5 text-left transition ${
                    i === active
                      ? "border-[var(--color-accent)]/45 bg-[var(--color-accent)]/5"
                      : "border-white/5 bg-[rgba(5,6,8,0.4)] hover:border-white/10"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`font-mono text-[10px] uppercase tracking-[0.22em] ${
                        i === active
                          ? "text-[var(--color-accent)]"
                          : "text-[var(--color-faint)]"
                      }`}
                    >
                      0{i + 1}
                    </span>
                    <span
                      className={`text-[13px] ${
                        i === active
                          ? "text-[var(--color-ink)]"
                          : "text-[var(--color-muted)]"
                      }`}
                    >
                      {s.label}
                    </span>
                  </div>
                  {s.cmd && (
                    <div className="mt-1.5 font-mono text-[12.5px] text-[var(--color-ink)]">
                      <span className="text-[var(--color-accent)]">$</span>{" "}
                      {s.cmd}
                    </div>
                  )}
                </button>
              ))}
            </div>

            <div className="mt-1 min-h-[130px] rounded-lg border border-white/5 bg-[rgba(5,6,8,0.6)] px-4 py-3.5 font-mono text-[12.5px] leading-[1.8]">
              {ACTIVATE_STEPS[active].out.map((ln, i) => (
                <div key={i} className={`whitespace-pre ${toneClass(ln.tone)}`}>
                  {ln.text || " "}
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT — scoping */}
          <div className="flex flex-col gap-4 rounded-[14px] border border-white/10 bg-[rgba(14,15,18,0.82)] p-7 shadow-[0_10px_40px_-20px_rgba(0,0,0,0.9)] backdrop-blur-md">
            <div className="flex items-center justify-between gap-3">
              <Eyebrow>scoping, structurally</Eyebrow>
              <span className="rounded border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
                zero by default
              </span>
            </div>
            <p className="m-0 text-[13px] leading-[1.7] text-[var(--color-muted)]">
              agents start with nothing. every brain access is an explicit
              grant, enforced at the query layer — ungranted brains are
              filtered out of <InlineCode>/api/vault/*</InlineCode> responses
              by SQL, not by a downstream policy check.
            </p>

            <div className="flex flex-col overflow-hidden rounded-lg border border-white/5">
              <ScopeRow name="openclaw-sandbox" role="editor" on />
              <ScopeRow name="personal" role="— no access —" />
              <ScopeRow name="engineering" role="— no access —" />
              <ScopeRow name="finance-2026" role="— invisible —" />
            </div>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-[12.5px]">
              <dt className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
                can&apos;t
              </dt>
              <dd className="m-0 text-[var(--color-ink)]">
                enumerate other brains
              </dd>
              <dt className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
                can&apos;t
              </dt>
              <dd className="m-0 text-[var(--color-ink)]">
                grant itself access
              </dd>
              <dt className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
                can&apos;t
              </dt>
              <dd className="m-0 text-[var(--color-ink)]">
                mint a second key
              </dd>
              <dt className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
                can&apos;t
              </dt>
              <dd className="m-0 text-[var(--color-ink)]">escape its org</dd>
            </dl>

            <p className="m-0 font-mono text-[12.5px] text-[var(--color-muted)]">
              <span className="text-[var(--color-faint)]">{"// verify once:"}</span>{" "}
              <span className="text-[var(--color-ink)]">
                AJU_PROFILE=openclaw aju brains list
              </span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ScopeRow({
  name,
  role,
  on = false,
}: {
  name: string;
  role: string;
  on?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-[20px_1fr_auto] items-center gap-2.5 border-b border-white/[0.04] px-3.5 py-2.5 font-mono text-[12.5px] last:border-b-0 ${
        on ? "" : "opacity-55"
      }`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          on
            ? "bg-[var(--color-accent)] shadow-[0_0_10px_rgba(34,197,94,0.7)]"
            : "bg-white/10"
        }`}
      />
      <span className="text-[var(--color-ink)]">{name}</span>
      <span
        className={`font-mono text-[10px] uppercase tracking-[0.2em] ${
          on ? "text-[var(--color-accent)]" : "text-[var(--color-faint)]"
        }`}
      >
        {role}
      </span>
    </div>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-sm border border-white/5 bg-[rgba(14,15,18,1)] px-1.5 py-0.5 font-mono text-[11.5px] text-[var(--color-ink)]">
      {children}
    </code>
  );
}
