const LABELS = [
  "[[Trips]]", "[[Goals]]", "[[Dreams]]", "[[Recipes]]", "[[Books]]",
  "[[Stanford]]", "[[Learnings]]", "[[2026-03]]", "[[Hackweek]]",
  "memory.md", "learnings.md", "journal.md", "scratchpad.md",
  "remember.md", "prompt.md", "agent.opus", "daily/",
  "search.md", "index.md", "graph.md", "tools_use.md",
  "embedding(1024)", "remember()", "recall()", "tool_use()",
  "ctx:200k", "chunk:512", "hop:2", "k=10", "top-2",
  "GraphRAG", "pgvector", "trigram", "bm25",
  "+ linked", "+ embedded", "+ remembered", "+ indexed",
  "annotation", "first_principles", "INSERT", "UPDATE",
  "\"the plot\"", "\"def remember(\"", "\"learned\"",
  "last_week", "context", "anchor=ctx",
  "source: agent", "mcp_stdio", "backfill",
  "schema", "api_key=...", "0.93", "✓ backed up",
];

type Variant = "hero" | "ambient";

type Props = {
  variant?: Variant;
  cols?: number;
  perCol?: number;
  seed?: number;
};

type ColumnSpec = {
  duration: number;
  delay: number;
  picks: string[];
};

function seededPicks(columnIndex: number, perCol: number, seed: number): string[] {
  const out: string[] = [];
  const step = 7 + columnIndex + seed;
  let idx = (columnIndex + seed) * 3;
  for (let i = 0; i < perCol; i++) {
    idx = (idx + step) % LABELS.length;
    out.push(LABELS[idx]);
  }
  return out;
}

function columnSpec(
  i: number,
  perCol: number,
  seed: number,
  variant: Variant,
): ColumnSpec {
  // Hero variant stays Matrix-fast (5–13s) because it's the signature
  // moment. Ambient runs slow (28–52s) so it reads as atmosphere across
  // the page without inducing motion fatigue when reading body copy.
  const duration =
    variant === "ambient"
      ? 28 + ((i * 11 + seed * 5) % 25)
      : 5 + ((i * 7 + seed * 3) % 9);
  return {
    duration,
    // Negative delays so columns start mid-animation.
    delay: -((i * 37 + seed * 11) % 30),
    picks: seededPicks(i, perCol, seed),
  };
}

export default function WikilinkRain({
  variant = "hero",
  cols = variant === "hero" ? 16 : 18,
  perCol = variant === "hero" ? 26 : 28,
  seed = 0,
}: Props = {}) {
  const columns = Array.from({ length: cols }, (_, i) =>
    columnSpec(i, perCol, seed, variant),
  );

  // Ambient is deliberately very dim — just enough motion to feel alive
  // but not enough to fight body copy for attention. Hero is loud.
  const tint =
    variant === "ambient"
      ? {
          head: "rgba(175, 255, 200, 0.16)",
          mid: "rgba(120, 232, 150, 0.08)",
          tail: "rgba(96, 232, 120, 0.04)",
          glow: undefined as string | undefined,
        }
      : {
          head: "rgba(195, 255, 215, 0.95)",
          mid: "rgba(120, 232, 150, 0.55)",
          tail: "rgba(96, 232, 120, 0.22)",
          glow: "0 0 16px rgba(120, 255, 160, 0.6)",
        };

  const maskImage =
    variant === "ambient"
      ? "linear-gradient(to bottom, transparent 0%, black 4%, black 96%, transparent 100%)"
      : "linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%)";

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden select-none"
      style={{ maskImage, WebkitMaskImage: maskImage }}
    >
      {columns.map((c, i) => (
        <div
          key={i}
          className={`absolute top-0 flex flex-col items-center whitespace-nowrap font-mono will-change-transform ${
            variant === "ambient" ? "gap-[26px] text-[11px]" : "gap-[22px] text-[11.5px]"
          }`}
          style={{
            left: `${(i / cols) * 100}%`,
            width: `${100 / cols}%`,
            animation: `aju-fall ${c.duration}s linear infinite`,
            animationDelay: `${c.delay}s`,
          }}
        >
          {/* Two copies — seamless loop when transform wraps from -50% → 0. */}
          {[...c.picks, ...c.picks].map((label, j) => {
            const pos = j % c.picks.length;
            const color = pos === 0 ? tint.head : pos === 1 ? tint.mid : tint.tail;
            const textShadow = pos === 0 ? tint.glow : undefined;
            return (
              <span key={j} style={{ color, textShadow }}>
                {label}
              </span>
            );
          })}
        </div>
      ))}

      {variant === "hero" && (
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 65% 52% at 50% 42%, rgba(5,6,8,0.88) 0%, rgba(5,6,8,0.5) 48%, rgba(5,6,8,0) 100%)",
          }}
        />
      )}
    </div>
  );
}
