"use client";

import { useEffect, useState } from "react";

type OS = "unix" | "windows";

const COMMANDS: Record<OS, { prompt: string; cmd: string; label: string }> = {
  unix: {
    prompt: "$",
    cmd: "curl -fsSL install.aju.sh | sh",
    label: "macOS / Linux",
  },
  windows: {
    prompt: ">",
    cmd: "irm install.aju.sh/ps1 | iex",
    label: "Windows",
  },
};

function detectOS(): OS {
  if (typeof navigator === "undefined") return "unix";
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ??
    navigator.platform ??
    navigator.userAgent;
  return /win/i.test(platform) ? "windows" : "unix";
}

export default function InstallBlock() {
  const [os, setOs] = useState<OS>("unix");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOs(detectOS());
  }, []);

  const { prompt, cmd } = COMMANDS[os];

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard API can be blocked in some browsers; fall through silently.
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1 self-start rounded-lg border border-white/10 bg-[var(--color-panel)]/50 p-0.5 text-[10px] uppercase tracking-[0.18em]">
        {(Object.keys(COMMANDS) as OS[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setOs(key)}
            aria-pressed={os === key}
            className={`rounded-md px-2.5 py-1 transition ${
              os === key
                ? "bg-white/[0.06] text-[var(--color-ink)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            }`}
          >
            {COMMANDS[key].label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-[var(--color-panel)]/85 backdrop-blur-sm px-4 py-3 font-mono text-[13px] shadow-[0_10px_40px_-20px_rgba(0,0,0,0.9)]">
        <span className="select-none text-[var(--color-accent)]">{prompt}</span>
        <span className="flex-1 truncate text-[var(--color-ink)]">{cmd}</span>
        <button
          type="button"
          onClick={onCopy}
          className="ml-1 inline-flex items-center rounded-md border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
          aria-label="Copy install command"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
    </div>
  );
}
