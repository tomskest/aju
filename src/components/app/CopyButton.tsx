"use client";

import { useState } from "react";

type Props = {
  value: string;
  label?: string;
  className?: string;
};

export default function CopyButton({ value, label = "copy", className }: Props) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard API can be blocked — fall through silently.
    }
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      className={
        className ??
        "inline-flex items-center rounded-md border border-white/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
      }
      aria-label={`Copy ${label}`}
    >
      {copied ? "copied" : label}
    </button>
  );
}
