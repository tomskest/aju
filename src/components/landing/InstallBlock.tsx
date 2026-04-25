"use client";

import { useState } from "react";

const COMMAND = "curl -fsSL install.aju.sh | sh";

export default function InstallBlock() {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard API can be blocked in some browsers; fall through silently.
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-[var(--color-panel)]/85 backdrop-blur-sm px-4 py-3 font-mono text-[13px] shadow-[0_10px_40px_-20px_rgba(0,0,0,0.9)]">
      <span className="select-none text-[var(--color-accent)]">$</span>
      <span className="flex-1 truncate text-[var(--color-ink)]">{COMMAND}</span>
      <button
        type="button"
        onClick={onCopy}
        className="ml-1 inline-flex items-center rounded-md border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
        aria-label="Copy install command"
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}
