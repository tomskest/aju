"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Eyebrow, H2 } from "./LandingPrimitives";

/**
 * Interactive mental-model graph. Three modes:
 *   - wikilinks: hover/click a node, 1-hop neighborhood lights up.
 *   - vector: embedding similarity for a cycling set of queries, no edges.
 *   - markdown: the underlying file representation, to hammer home that
 *     brains are just directories of .md.
 *
 * Embedding dimensionality is 1024 — aju uses Voyage AI voyage-4-large.
 */

type NodeId =
  | "trips"
  | "stanford"
  | "tokyo"
  | "hackweek"
  | "books"
  | "2026"
  | "recipes"
  | "goals"
  | "journal"
  | "memory";

type GraphNode = {
  id: NodeId;
  label: string;
  x: number;
  y: number;
};

const NODES: GraphNode[] = [
  { id: "trips", label: "[[Trips]]", x: 50, y: 48 },
  { id: "stanford", label: "[[Stanford-2025]]", x: 22, y: 28 },
  { id: "tokyo", label: "[[Tokyo-spring]]", x: 78, y: 30 },
  { id: "hackweek", label: "[[Hackweek]]", x: 15, y: 62 },
  { id: "books", label: "[[Books-read]]", x: 85, y: 62 },
  { id: "2026", label: "[[2026-03]]", x: 50, y: 82 },
  { id: "recipes", label: "[[Recipes]]", x: 30, y: 82 },
  { id: "goals", label: "[[Goals]]", x: 70, y: 82 },
  { id: "journal", label: "journal.md", x: 35, y: 14 },
  { id: "memory", label: "memory.md", x: 65, y: 14 },
];

const EDGES: Array<[NodeId, NodeId]> = [
  ["trips", "stanford"],
  ["trips", "tokyo"],
  ["trips", "hackweek"],
  ["trips", "2026"],
  ["stanford", "hackweek"],
  ["tokyo", "recipes"],
  ["stanford", "books"],
  ["trips", "goals"],
  ["journal", "trips"],
  ["memory", "trips"],
  ["2026", "goals"],
  ["stanford", "journal"],
  ["hackweek", "memory"],
  ["books", "goals"],
];

type VectorHit = { id: NodeId; score: number };

const VECTOR_SCORES: Record<string, VectorHit[]> = {
  "what did i learn in tokyo": [
    { id: "tokyo", score: 0.94 },
    { id: "trips", score: 0.81 },
    { id: "recipes", score: 0.72 },
    { id: "journal", score: 0.68 },
    { id: "2026", score: 0.41 },
  ],
  "notes about stanford hackweek": [
    { id: "stanford", score: 0.96 },
    { id: "hackweek", score: 0.93 },
    { id: "memory", score: 0.71 },
    { id: "journal", score: 0.64 },
    { id: "books", score: 0.39 },
  ],
  "goals for this year": [
    { id: "goals", score: 0.92 },
    { id: "2026", score: 0.84 },
    { id: "trips", score: 0.55 },
    { id: "books", score: 0.48 },
  ],
};
const VECTOR_QUERIES = Object.keys(VECTOR_SCORES);

const MARKDOWN_SAMPLE = `# Trips

backlinks: [[Stanford-2025]] · [[Tokyo-spring]] · [[Hackweek]]

## Stanford — march 2026
went for the [[Hackweek]]. stayed near campus.
took [[Notes-on-trigram-search]] — still good.

## Tokyo — apr 2026
ramen in shinjuku. shrine on a tuesday.
saved three [[Recipes]].

> source: agent=claude · 2026-04-18`;

type Mode = "links" | "vector" | "markdown";

export default function MentalModel() {
  const [mode, setMode] = useState<Mode>("links");
  const [active, setActive] = useState<NodeId>("trips");
  const [query, setQuery] = useState<string>(VECTOR_QUERIES[0]);

  const linked = useMemo(() => {
    const s = new Set<NodeId>();
    for (const [a, b] of EDGES) {
      if (a === active) s.add(b);
      if (b === active) s.add(a);
    }
    return s;
  }, [active]);

  const scores = mode === "vector" ? VECTOR_SCORES[query] : null;
  const scoreMap = useMemo(() => {
    const m: Partial<Record<NodeId, number>> = {};
    if (scores) for (const s of scores) m[s.id] = s.score;
    return m;
  }, [scores]);

  useEffect(() => {
    if (mode !== "vector") return;
    const t = window.setInterval(() => {
      setQuery((q) => {
        const i = VECTOR_QUERIES.indexOf(q);
        return VECTOR_QUERIES[(i + 1) % VECTOR_QUERIES.length];
      });
    }, 4200);
    return () => window.clearInterval(t);
  }, [mode]);

  const nodeById = (id: NodeId) => NODES.find((n) => n.id === id)!;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-8">
        <div>
          <Eyebrow>02 · the mental model</Eyebrow>
          <H2>
            it&apos;s just files and links.
            <br />
            <em className="not-italic text-[var(--color-faint)]">
              with memory super-powers.
            </em>
          </H2>
          <p className="mt-5 max-w-[520px] text-[18px] font-light leading-[1.55] text-[var(--color-muted)]">
            markdown notes. a wikilink graph between them. 1024-dim vector
            embeddings for semantic recall. all scoped per-tenant, all
            queryable from your agent.
          </p>
        </div>
      </div>

      <div className="relative mt-14 grid min-h-[520px] grid-cols-1 overflow-hidden rounded-[14px] border border-white/10 bg-[rgba(14,15,18,0.5)] md:grid-cols-[1fr_320px]">
        <div className="relative min-h-[520px]">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 block h-full w-full"
          >
            {EDGES.map(([a, b], i) => {
              const na = nodeById(a);
              const nb = nodeById(b);
              let opacity = 0.08;
              let stroke = "rgba(255,255,255,0.12)";
              if (mode === "links") {
                if (a === active || b === active) {
                  opacity = 0.9;
                  stroke = "rgba(34,197,94,0.65)";
                }
              } else if (mode === "vector") {
                opacity = 0.04;
              }
              return (
                <line
                  key={i}
                  x1={na.x}
                  y1={na.y}
                  x2={nb.x}
                  y2={nb.y}
                  stroke={stroke}
                  strokeWidth={0.18}
                  opacity={opacity}
                  vectorEffect="non-scaling-stroke"
                  style={{ transition: "opacity .25s ease" }}
                />
              );
            })}
          </svg>

          {NODES.map((n) => {
            const isRoot =
              (mode === "links" && n.id === active) ||
              (mode === "markdown" && n.id === "trips");
            const isActive =
              (mode === "links" && linked.has(n.id)) ||
              (mode === "markdown" && linked.has(n.id));
            const vectorScore = mode === "vector" ? scoreMap[n.id] : undefined;

            const base =
              "absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-md border px-2.5 py-1.5 font-mono text-[12.5px] leading-[1.65] transition-all duration-200 select-none whitespace-nowrap";

            let classes = `${base} border-white/10 bg-[rgba(14,15,18,0.9)] text-[var(--color-muted)] hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-accent)]/10 hover:text-[var(--color-ink)]`;
            const styles: React.CSSProperties = {
              left: `${n.x}%`,
              top: `${n.y}%`,
            };

            if (isRoot) {
              classes = `${base} border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 font-medium text-[var(--color-accent)]`;
            } else if (isActive) {
              classes = `${base} border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]`;
            } else if (mode === "vector") {
              if (vectorScore != null) {
                classes = `${base} border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]`;
                styles.boxShadow = `0 0 ${Math.round(vectorScore * 40)}px rgba(34,197,94,${vectorScore * 0.35})`;
                styles.borderColor = `rgba(34,197,94,${0.25 + vectorScore * 0.5})`;
                styles.color = `rgba(236,236,238,${0.5 + vectorScore * 0.5})`;
              } else {
                styles.opacity = 0.3;
              }
            } else if (mode === "links" || mode === "markdown") {
              styles.opacity = 0.45;
            }

            return (
              <div
                key={n.id}
                className={classes}
                style={styles}
                onMouseEnter={() => mode === "links" && setActive(n.id)}
                onClick={() => mode === "links" && setActive(n.id)}
              >
                {n.label}
                {mode === "vector" && vectorScore != null && (
                  <span className="ml-2 text-[10px] tracking-[0.1em] text-[var(--color-accent)]">
                    {vectorScore.toFixed(2)}
                  </span>
                )}
              </div>
            );
          })}

          <div className="absolute bottom-4 left-5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-faint)]">
            {mode === "links" && (
              <>
                <span className="rounded border border-white/10 px-1.5 py-0.5 text-[var(--color-muted)]">
                  hover
                </span>
                any node to traverse
              </>
            )}
            {mode === "vector" && <>semantic search · cycling queries</>}
            {mode === "markdown" && <>all nodes are just markdown files</>}
          </div>
        </div>

        <aside className="flex flex-col gap-6 border-l border-white/5 bg-[rgba(5,6,8,0.4)] p-7">
          <div className="flex gap-1">
            {(
              [
                ["links", "wikilinks"],
                ["vector", "vector"],
                ["markdown", "markdown"],
              ] as Array<[Mode, string]>
            ).map(([m, label]) => {
              const selected = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-md border px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.22em] transition ${
                    selected
                      ? "border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 text-[var(--color-accent)]"
                      : "border-white/5 bg-transparent text-[var(--color-faint)] hover:border-white/10 hover:text-[var(--color-muted)]"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div>
            {mode === "links" && (
              <div>
                <h4 className="m-0 mb-2.5 text-[16px] font-medium leading-[1.3] text-[var(--color-ink)]">
                  graph traversal
                </h4>
                <p className="m-0 mb-3.5 text-[13px] leading-[1.7] text-[var(--color-muted)]">
                  every <InlineCode>[[wikilink]]</InlineCode> is an edge.{" "}
                  <InlineCode>aju deep-search</InlineCode> can follow them —
                  one hop, two hops, whatever <InlineCode>--depth</InlineCode>{" "}
                  asks for.
                </p>
                <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 font-mono text-[12.5px]">
                  <dt className="text-[var(--color-faint)]">node</dt>
                  <dd className="m-0 text-[var(--color-ink)]">
                    {nodeById(active).label}
                  </dd>
                  <dt className="text-[var(--color-faint)]">hops</dt>
                  <dd className="m-0 text-[var(--color-ink)]">1</dd>
                  <dt className="text-[var(--color-faint)]">links</dt>
                  <dd className="m-0 text-[var(--color-accent)]">
                    {linked.size}
                  </dd>
                </dl>
              </div>
            )}

            {mode === "vector" && scores && (
              <div>
                <h4 className="m-0 mb-2.5 text-[16px] font-medium leading-[1.3] text-[var(--color-ink)]">
                  semantic recall
                </h4>
                <p className="m-0 mb-3.5 text-[13px] leading-[1.7] text-[var(--color-muted)]">
                  every note gets a 1024-dim embedding (voyage-4-large).
                  queries match on meaning — not keywords.
                </p>
                <div className="rounded-md border border-white/5 bg-[rgba(5,6,8,0.6)] px-3 py-2.5 font-mono text-[12.5px] text-[var(--color-ink)]">
                  <span className="text-[var(--color-accent)]">&gt;</span>{" "}
                  {query}
                </div>
                <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 font-mono text-[12.5px]">
                  {scores.slice(0, 4).map((s) => (
                    <Fragment key={s.id}>
                      <dt className="text-[var(--color-faint)]">
                        {nodeById(s.id).label}
                      </dt>
                      <dd className="m-0 text-[var(--color-accent)]">
                        {s.score.toFixed(2)}
                      </dd>
                    </Fragment>
                  ))}
                </dl>
              </div>
            )}

            {mode === "markdown" && (
              <div>
                <h4 className="m-0 mb-2.5 text-[16px] font-medium leading-[1.3] text-[var(--color-ink)]">
                  files all the way down
                </h4>
                <p className="m-0 mb-3.5 text-[13px] leading-[1.7] text-[var(--color-muted)]">
                  no proprietary format. every brain is a postgres-backed
                  set of <InlineCode>.md</InlineCode> files + attachments
                  in R2. <InlineCode>aju export</InlineCode> gives you a
                  portable JSON dump any time.
                </p>
                <pre className="m-0 whitespace-pre-wrap rounded-md border border-white/5 bg-[rgba(5,6,8,0.6)] p-3 font-mono text-[11.5px] leading-[1.7] text-[var(--color-ink)]">
                  {MARKDOWN_SAMPLE}
                </pre>
              </div>
            )}
          </div>
        </aside>
      </div>
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
