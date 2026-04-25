/**
 * Agent-calling-aju terminal card. Static (no client JS) — the copy itself
 * sells the point. Uses the real MCP tool name `aju_deep_search` rather
 * than an invented `aju.deep_search()` pseudocall.
 */
export default function HeroTerminal() {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[rgba(14,15,18,0.85)] p-[18px] font-mono shadow-[0_10px_40px_-20px_rgba(0,0,0,0.9)] backdrop-blur-md">
      <div className="mb-3.5 flex items-center justify-between border-b border-white/5 pb-3.5 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
        <span className="flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[var(--color-accent)]/40" />
          <span className="h-2 w-2 rounded-full bg-white/10" />
          <span className="h-2 w-2 rounded-full bg-white/10" />
        </span>
        <span className="font-mono text-[10px] normal-case tracking-wider text-[var(--color-muted)]">
          agent · claude
        </span>
        <span>live</span>
      </div>

      <div className="text-[12.5px] leading-[1.65]">
        <Line tone="faint">{"// user asks the agent"}</Line>
        <Line>
          <span className="text-[var(--color-faint)]">you</span>{" "}
          <span className="text-[var(--color-ink)]">
            what did i decide about the tokyo trip?
          </span>
        </Line>
        <div className="h-1.5" />

        <Line tone="faint">{"// agent calls aju over MCP"}</Line>
        <Line>
          <span className="text-[var(--color-accent)]">&gt;</span>{" "}
          <span className="text-[var(--color-ink)]">
            aju_deep_search(
          </span>
          <span className="text-[var(--color-muted)]">
            &quot;tokyo trip decisions&quot;
          </span>
          <span className="text-[var(--color-ink)]">, depth=2)</span>
        </Line>
        <Line tone="faint">   · hybrid seeds · graph expansion</Line>
        <div className="h-1.5" />

        <Line>
          <span className="text-[var(--color-accent)]">  0.93</span>{" "}
          <span className="text-[var(--color-ink)]">
            trips/2026-03-11.md#2
          </span>
        </Line>
        <Line tone="faint">
          {"        \"stay 6 nights. skip disneyland.\""}
        </Line>
        <Line>
          <span className="text-[var(--color-accent)]">  0.81</span>{" "}
          <span className="text-[var(--color-ink)]">[[Tokyo-spring]]</span>
        </Line>
        <Line>
          <span className="text-[var(--color-accent)]">  0.67</span>{" "}
          <span className="text-[var(--color-ink)]">[[Budget-q2]]</span>
        </Line>
        <div className="h-1.5" />

        <Line>
          <span className="text-[var(--color-faint)]">claude</span>{" "}
          <span className="text-[var(--color-ink)]">
            you planned 6 nights, skipping disneyland — per notes from
            march 11.
          </span>
        </Line>
      </div>
    </div>
  );
}

function Line({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "faint";
}) {
  return (
    <div
      className={`py-[3px] ${
        tone === "faint" ? "text-[var(--color-faint)]" : "text-[var(--color-ink)]"
      }`}
    >
      {children}
    </div>
  );
}
