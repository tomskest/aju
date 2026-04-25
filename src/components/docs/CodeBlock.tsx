"use client";

import { useState } from "react";

type Props = {
  /** The command or code to display. If provided, it is also used as what's copied. */
  code: string;
  /** Optional language hint for visual styling (e.g. "bash", "json"). Not used for highlighting. */
  language?: string;
  /** Show a leading `$` prompt in front of the code (useful for single-line shell commands). */
  prompt?: boolean;
  /** Optional label for the copy button, defaults to "copy"/"copied". */
  copyLabel?: string;
};

export default function CodeBlock({
  code,
  language,
  prompt = false,
  copyLabel,
}: Props) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard API can be blocked; fall through silently.
    }
  }

  const isMultiline = code.includes("\n");

  if (!isMultiline && prompt) {
    // Single-line shell command — match InstallBlock styling.
    return (
      <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-[var(--color-panel)]/85 px-4 py-3 font-mono text-[13px]">
        <span className="select-none text-[var(--color-accent)]">$</span>
        <span className="flex-1 truncate text-[var(--color-ink)]">{code}</span>
        <button
          type="button"
          onClick={onCopy}
          className="ml-1 inline-flex items-center rounded-md border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
          aria-label="Copy command"
        >
          {copied ? "copied" : copyLabel ?? "copy"}
        </button>
      </div>
    );
  }

  // Multi-line or raw code block
  return (
    <div className="relative rounded-xl border border-white/10 bg-[var(--color-panel)]/85">
      <button
        type="button"
        onClick={onCopy}
        className="absolute right-3 top-3 inline-flex items-center rounded-md border border-white/10 bg-[var(--color-bg)]/60 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
        aria-label="Copy code"
      >
        {copied ? "copied" : copyLabel ?? "copy"}
      </button>
      {language && (
        <div className="border-b border-white/5 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
          {language}
        </div>
      )}
      <pre className="overflow-x-auto px-4 py-3 pr-16 font-mono text-[12.5px] leading-relaxed text-[var(--color-ink)]">
        <code>{code}</code>
      </pre>
    </div>
  );
}
