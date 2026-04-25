import { Eyebrow, H2, Section } from "./LandingPrimitives";

/**
 * Three agent archetypes showing how the same aju brain serves different
 * flavors of recall. Every CLI snippet is a real command shape — no
 * invented flags. `aju changes --since` takes ISO-8601 on the server, so
 * the research agent demonstrates `aju search` with a type filter
 * instead of the tempting-but-fake `--since 90d`.
 */

const CASES = [
  {
    tag: "personal assistant",
    question: "do i have that recipe from mom's place last christmas?",
    cmd: "aju semantic \"mom's recipe christmas\"",
    annotation: "  --brain personal",
    hit: "recipes/2025-12-24.md",
  },
  {
    tag: "coding agent",
    question: "what did we decide about retries in the ingest pipeline?",
    cmd: "aju deep-search \"ingest retry policy\"",
    annotation: "  --brain engineering --depth 2",
    hit: "adr/2026-02-retries.md",
  },
  {
    tag: "research agent",
    question: "papers i flagged on sparse autoencoders",
    cmd: "aju search \"sparse autoencoder\"",
    annotation: "  --type paper --brain research",
    hit: "papers/ · 12 items",
  },
];

export default function UseCases() {
  return (
    <Section id="cases">
      <Eyebrow>06 · in the wild</Eyebrow>
      <H2>
        agents that remember you
        <br />
        <em className="not-italic text-[var(--color-faint)]">
          across sessions, tools, and days.
        </em>
      </H2>

      <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-white/5 bg-white/5 md:grid-cols-3">
        {CASES.map((c) => (
          <div
            key={c.tag}
            className="flex min-h-[280px] flex-col gap-4 bg-[rgba(14,15,18,0.85)] p-7 transition-colors hover:bg-[rgba(14,15,18,1)]"
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-faint)]">
              {c.tag}
            </span>
            <p className="m-0 text-[17px] leading-[1.35] tracking-[-0.01em] text-[var(--color-ink)]">
              &quot;{c.question}&quot;
            </p>
            <div className="mt-auto rounded-md border border-white/5 bg-[rgba(5,6,8,0.6)] px-3 py-2.5 font-mono text-[12.5px] leading-[1.7] text-[var(--color-muted)]">
              <div>
                <span className="text-[var(--color-accent)]">$</span>{" "}
                <span className="text-[var(--color-ink)]">{c.cmd}</span>
              </div>
              <div className="text-[var(--color-faint)]">{c.annotation}</div>
              <div>
                <span className="text-[var(--color-accent)]">  ✓</span>{" "}
                <span className="text-[var(--color-ink)]">{c.hit}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
