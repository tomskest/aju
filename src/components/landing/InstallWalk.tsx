"use client";

import { useEffect, useState } from "react";
import { Eyebrow, H2 } from "./LandingPrimitives";

/**
 * Stepped CLI demo with typed-out animation. Every command is real:
 *   - install.aju.sh install script (matches InstallBlock.tsx)
 *   - aju login device flow → /cli-auth
 *   - aju create with frontmatter parsing + FTS + 1024-dim voyage-4-large embeddings
 *   - aju deep-search --depth 2 (hybrid seeds + graph expansion)
 *   - aju skill install claude (writes ~/.claude/skills/aju/SKILL.md)
 */

type OutLine = { text: string; tone: "faint" | "ink" | "muted" | "accent" };

type Step = {
  title: string;
  subtitle: string;
  cmd: string;
  lines: OutLine[];
};

const STEPS: Step[] = [
  {
    title: "install the CLI",
    subtitle: "~/ · bash",
    cmd: "curl -fsSL install.aju.sh | sh",
    lines: [
      { text: "fetching installer...", tone: "faint" },
      { text: "→ darwin arm64 · v0.4.2", tone: "faint" },
      { text: "installed: /usr/local/bin/aju", tone: "ink" },
      { text: "✓ done. next: aju login", tone: "accent" },
    ],
  },
  {
    title: "sign in",
    subtitle: "~/ · aju login",
    cmd: "aju login",
    lines: [
      { text: "device code: WXTR-8J2K", tone: "faint" },
      { text: "opening aju.sh/cli-auth in browser...", tone: "faint" },
      { text: "waiting for confirmation", tone: "faint" },
      { text: "✓ signed in as you@somewhere.com", tone: "accent" },
      { text: "active brain: personal", tone: "muted" },
    ],
  },
  {
    title: "create a note",
    subtitle: "~/ · aju create",
    cmd: 'echo "shinjuku shrine, tuesday, quiet" | aju create trips/tokyo.md',
    lines: [
      { text: "parsing frontmatter... (none)", tone: "faint" },
      { text: "indexing FTS + embeddings (1024d)", tone: "faint" },
      { text: "resolving wikilinks... [[Trips]] ✓", tone: "faint" },
      { text: "✓ created trips/tokyo.md · brain=personal", tone: "accent" },
    ],
  },
  {
    title: "find it later",
    subtitle: "~/ · aju deep-search",
    cmd: 'aju deep-search "that quiet shrine place" --depth 2',
    lines: [
      { text: "hybrid seeds (FTS + vector · RRF)", tone: "faint" },
      { text: "graph expansion · depth=2", tone: "faint" },
      { text: "", tone: "faint" },
      { text: "  0.91 · trips/tokyo.md", tone: "ink" },
      { text: "         shinjuku shrine, tuesday, quiet", tone: "muted" },
      { text: "  0.74 · [[Tokyo-spring]]", tone: "ink" },
      { text: "  0.68 · [[Trips]] (via backlink)", tone: "ink" },
    ],
  },
  {
    title: "hand it to your agent",
    subtitle: "~/ · aju skill install",
    cmd: "aju skill install claude",
    lines: [
      { text: "writing ~/.claude/skills/aju/SKILL.md", tone: "faint" },
      { text: "teaching claude to shell out to: search, semantic,", tone: "faint" },
      { text: "        deep-search, read, create, update, backlinks", tone: "faint" },
      { text: "✓ aju is now a claude code skill", tone: "accent" },
      { text: "// restart claude to pick up", tone: "faint" },
    ],
  },
];

function toneClass(tone: OutLine["tone"]): string {
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

function TypedBlock({ step }: { step: Step }) {
  const [typed, setTyped] = useState("");
  const [revealed, setRevealed] = useState(-1);

  useEffect(() => {
    setTyped("");
    setRevealed(-1);
    let i = 0;
    const typeTimer = window.setInterval(() => {
      i++;
      setTyped(step.cmd.slice(0, i));
      if (i >= step.cmd.length) {
        window.clearInterval(typeTimer);
        let k = 0;
        const lineTimer = window.setInterval(() => {
          setRevealed(k);
          k++;
          if (k > step.lines.length) window.clearInterval(lineTimer);
        }, 280);
      }
    }, 28);
    return () => window.clearInterval(typeTimer);
  }, [step]);

  return (
    <div className="font-mono text-[12.5px] leading-[1.8]">
      <div>
        <span className="text-[var(--color-accent)]">$</span>{" "}
        <span className="text-[var(--color-ink)]">{typed}</span>
        <span className="ml-[2px] inline-block h-[14px] w-[7px] animate-[blink_1s_steps(2)_infinite] bg-[var(--color-accent)] align-middle" />
      </div>
      {step.lines.slice(0, revealed + 1).map((ln, i) => (
        <div key={i} className={`whitespace-pre ${toneClass(ln.tone)}`}>
          {ln.text || " "}
        </div>
      ))}
    </div>
  );
}

export default function InstallWalk() {
  const [step, setStep] = useState(0);

  return (
    <div>
      <Eyebrow>03 · first five minutes</Eyebrow>
      <H2>install. sign in. create. recall.</H2>
      <p className="mt-5 max-w-[640px] text-[18px] font-light leading-[1.55] text-[var(--color-muted)]">
        one binary, one hosted postgres (neon) with pgvector. stay in your
        terminal; hand the same tools to your agents via an MCP-installable
        skill.
      </p>

      <div className="mt-14 grid grid-cols-1 gap-7 md:grid-cols-[240px_1fr] md:gap-14">
        <div className="flex flex-col gap-0.5">
          {STEPS.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setStep(i)}
              className={`grid grid-cols-[28px_1fr] items-start gap-3.5 rounded-lg border px-3 py-3.5 text-left transition ${
                i === step
                  ? "border-white/10 bg-[rgba(14,15,18,0.7)]"
                  : "border-transparent hover:bg-white/[0.02]"
              }`}
            >
              <span
                className={`pt-0.5 font-mono text-[10px] uppercase tracking-[0.2em] ${
                  i === step
                    ? "text-[var(--color-accent)]"
                    : "text-[var(--color-faint)]"
                }`}
              >
                0{i + 1}
              </span>
              <span>
                <p
                  className={`m-0 text-[14px] font-medium leading-[1.3] ${
                    i === step
                      ? "text-[var(--color-ink)]"
                      : "text-[var(--color-muted)]"
                  }`}
                >
                  {s.title}
                </p>
                <p className="m-0 mt-1 font-mono text-[12px] tracking-[0.02em] text-[var(--color-faint)]">
                  {s.subtitle}
                </p>
              </span>
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-white/10 bg-[rgba(14,15,18,0.85)] shadow-[0_10px_40px_-20px_rgba(0,0,0,0.9)] backdrop-blur-md">
          <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3.5 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
            <span className="flex gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[var(--color-accent)]/40" />
              <span className="h-2 w-2 rounded-full bg-white/10" />
              <span className="h-2 w-2 rounded-full bg-white/10" />
            </span>
            <span className="font-mono normal-case tracking-wider text-[var(--color-muted)]">
              {STEPS[step].subtitle}
            </span>
            <span className="ml-auto">
              step {step + 1} / {STEPS.length}
            </span>
          </div>
          <div className="min-h-[260px] px-5 py-5">
            <TypedBlock step={STEPS[step]} />
          </div>
        </div>
      </div>
    </div>
  );
}
