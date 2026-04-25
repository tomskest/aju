"use client";

import { CSSProperties, ReactNode, useEffect, useMemo, useRef, useState } from "react";

// ─── tokens ────────────────────────────────────────────────────────────────
const MONO =
  '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace';
const SANS =
  '"Geist", ui-sans-serif, system-ui, -apple-system, sans-serif';
const WIN_BG = "rgba(14,15,18,0.92)";
const WIN_BORDER = "1px solid rgba(255,255,255,0.10)";
const INK = "#ececee";
const MUTED = "#a8a8b0";
const FAINT = "#6e6e76";
const ACCENT = "#22c55e";

// ─── helpers ───────────────────────────────────────────────────────────────
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

// ─── timeline + scene plumbing ─────────────────────────────────────────────
type Scene = {
  id: number;
  name: string;
  label: string;
  start: number;
  end: number;
  render: (localTime: number, duration: number) => ReactNode;
};

type Caption = {
  start: number;
  end: number;
  eyebrow?: string;
  text: string;
};

// ─── atoms ─────────────────────────────────────────────────────────────────
function Eyebrow({
  children,
  color = FAINT,
  size = 11,
}: {
  children: ReactNode;
  color?: string;
  size?: number;
}) {
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: size,
        letterSpacing: "0.24em",
        textTransform: "uppercase",
        color,
      }}
    >
      {children}
    </div>
  );
}

function PulseDot({ size = 8, color = ACCENT }: { size?: number; color?: string }) {
  return (
    <span
      className="aju-pulse"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: size,
        background: color,
        boxShadow: `0 0 10px ${color}`,
      }}
    />
  );
}

function TerminalWindow({
  x,
  y,
  width,
  height,
  title = "~/aju",
  children,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
        background: WIN_BG,
        border: WIN_BORDER,
        borderRadius: 12,
        boxShadow:
          "0 20px 60px -20px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.02)",
        backdropFilter: "blur(8px)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <span style={{ width: 10, height: 10, borderRadius: 10, background: "rgba(255,255,255,0.12)" }} />
        <span style={{ width: 10, height: 10, borderRadius: 10, background: "rgba(255,255,255,0.12)" }} />
        <span style={{ width: 10, height: 10, borderRadius: 10, background: "rgba(255,255,255,0.12)" }} />
        <span
          style={{
            marginLeft: 10,
            fontFamily: MONO,
            fontSize: 11,
            color: FAINT,
            letterSpacing: "0.08em",
          }}
        >
          {title}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          padding: "18px 22px",
          fontFamily: MONO,
          fontSize: 15,
          lineHeight: 1.7,
          color: INK,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Typewriter({
  text,
  startT,
  endT,
  localTime,
  prefix,
}: {
  text: string;
  startT: number;
  endT: number;
  localTime: number;
  prefix?: string;
}) {
  const total = text.length;
  const span = Math.max(0.001, endT - startT);
  const raw = (localTime - startT) / span;
  const t = clamp(raw, 0, 1);
  const shown = Math.floor(t * total);
  const done = localTime >= endT;
  const active = localTime >= startT && localTime <= endT + 0.05;
  const blink = Math.floor(localTime * 2) % 2 === 0;

  return (
    <div
      style={{
        display: "flex",
        whiteSpace: "pre",
        opacity: localTime < startT ? 0 : 1,
        transition: "opacity 120ms",
      }}
    >
      {prefix && <span style={{ color: ACCENT, marginRight: 8 }}>{prefix}</span>}
      <span style={{ color: INK }}>{text.slice(0, shown)}</span>
      {(active || (done && blink)) && (
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 16,
            marginLeft: 2,
            marginTop: 3,
            background: ACCENT,
            opacity: done ? (blink ? 0.8 : 0) : 0.9,
          }}
        />
      )}
    </div>
  );
}

function TermLine({
  at,
  localTime,
  children,
  style = {},
}: {
  at: number;
  localTime: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const visible = localTime >= at;
  const age = localTime - at;
  const entry = clamp(age / 0.2, 0, 1);
  if (!visible) return <div style={{ height: 27 }} />;
  return (
    <div
      style={{
        opacity: entry,
        transform: `translateY(${(1 - entry) * 4}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── internal matrix rain (seeded, deterministic) ──────────────────────────
function mulberry32(a: number) {
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOKENS = [
  "[[Trips]]", "[[Memory]]", "[[Agent]]", "[[Notes]]", "[[Recall]]",
  "memory.md", "agent.md", "notes.md", "brain.md", "recall.md",
  "[[brain:42]]", "[[ref:8a2]]", "embedding(1536)", ".wikilink",
  "{ok:true}", "↳ chunk", "[[Plans]]", "[[Meeting]]", "[[Ideas]]",
  "mcp://aju", "$ aju recall", "vec[0.87]", "[[Standup]]",
  "// save", "brain.create", "tenant:org_x", "[[Person]]",
  "[[Project]]", "chunk[912]", "[[Company]]", "[[Doc]]",
];

type Col = {
  x: number;
  dur: number;
  delay: number;
  entries: { token: string; strong: boolean; gap: number }[];
};

function SceneRain({ intensity = 0.7 }: { intensity?: number }) {
  const cols = useMemo<Col[]>(() => {
    const rng = mulberry32(42);
    const colW = 140;
    const width = 1920;
    const count = Math.ceil(width / colW);
    return Array.from({ length: count }, (_, i) => {
      const dur = 28 + rng() * 22;
      const delay = -rng() * dur;
      const density = 14 + Math.floor(rng() * 8);
      const entries = Array.from({ length: density }, () => ({
        token: TOKENS[Math.floor(rng() * TOKENS.length)],
        strong: rng() > 0.72,
        gap: 40 + rng() * 40,
      }));
      return { x: i * colW, dur, delay, entries };
    });
  }, []);

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        opacity: intensity,
        maskImage:
          "linear-gradient(180deg, transparent 0%, black 8%, black 92%, transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(180deg, transparent 0%, black 8%, black 92%, transparent 100%)",
      }}
    >
      {cols.map((col, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: col.x,
            top: 0,
            width: 140,
            height: "200%",
            animation: `aju-fall ${col.dur}s linear ${col.delay}s infinite`,
            fontFamily: MONO,
            fontSize: 13,
            lineHeight: 1.8,
            whiteSpace: "nowrap",
          }}
        >
          {col.entries.map((e, j) => (
            <div
              key={j}
              style={{
                color: e.strong
                  ? "rgba(96, 232, 120, 0.34)"
                  : "rgba(96, 232, 120, 0.16)",
                paddingBottom: e.gap,
              }}
            >
              {e.token}
            </div>
          ))}
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 60% 55% at 50% 50%, rgba(5,6,8,0.85) 0%, rgba(5,6,8,0.4) 45%, transparent 80%)",
        }}
      />
    </div>
  );
}

// ─── scenes ────────────────────────────────────────────────────────────────
function SceneProblem(t: number) {
  const bubbles = [
    { at: 0.2, from: "user", text: "what did we decide about acme?" },
    { at: 1.1, from: "claude", text: "i don't have context from earlier chats." },
    { at: 2.2, from: "user", text: "we literally talked about it yesterday." },
    { at: 3.1, from: "claude", text: "sorry — new session, empty memory." },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 820, display: "flex", flexDirection: "column", gap: 14, padding: 40 }}>
        <Eyebrow color={FAINT}>every chat starts from zero</Eyebrow>
        <div style={{ height: 18 }} />
        {bubbles.map((b, i) => {
          const show = t >= b.at;
          const age = t - b.at;
          const entry = clamp(age / 0.35, 0, 1);
          const isAgent = b.from === "claude";
          return (
            <div
              key={i}
              style={{
                alignSelf: isAgent ? "flex-start" : "flex-end",
                maxWidth: "72%",
                opacity: entry,
                transform: `translateY(${(1 - entry) * 10}px)`,
                padding: "14px 18px",
                background: isAgent ? WIN_BG : "rgba(34,197,94,0.08)",
                border: `1px solid ${isAgent ? "rgba(255,255,255,0.08)" : "rgba(34,197,94,0.25)"}`,
                borderRadius: 14,
                fontFamily: SANS,
                fontSize: 20,
                fontWeight: 300,
                letterSpacing: "-0.01em",
                color: isAgent ? MUTED : INK,
                filter: show ? "none" : "blur(2px)",
              }}
            >
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: isAgent ? FAINT : ACCENT,
                  marginBottom: 6,
                }}
              >
                {isAgent ? "claude" : "you"}
              </div>
              {b.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SceneSolution(t: number, duration: number) {
  const wordT = easeOutCubic(Math.min(1, t / 1.4));
  const tagIn = clamp((t - 0.9) / 0.6, 0, 1);
  const underlineT = clamp((t - 1.7) / 0.8, 0, 1);
  const exit = clamp((duration - t) / 0.5, 0, 1);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity: exit,
      }}
    >
      <div
        style={{
          fontFamily: SANS,
          fontSize: 240,
          fontWeight: 300,
          letterSpacing: "-0.05em",
          color: INK,
          lineHeight: 0.95,
          transform: `translateY(${(1 - wordT) * 40}px)`,
          opacity: wordT,
        }}
      >
        aju
      </div>
      <div
        style={{
          width: 320,
          height: 1,
          background: ACCENT,
          transform: `scaleX(${underlineT})`,
          transformOrigin: "left",
          margin: "24px 0 28px",
          boxShadow: "0 0 14px rgba(34,197,94,0.6)",
        }}
      />
      <div
        style={{
          fontFamily: SANS,
          fontSize: 30,
          fontWeight: 300,
          letterSpacing: "-0.01em",
          color: MUTED,
          opacity: tagIn,
          transform: `translateY(${(1 - tagIn) * 12}px)`,
        }}
      >
        memory for AI agents
      </div>
    </div>
  );
}

function SceneInstall(t: number) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <TerminalWindow x={210} y={210} width={1500} height={620} title="~ — zsh">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 11,
              color: FAINT,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            {"// one-time setup"}
          </div>
          <Typewriter text="curl -fsSL install.aju.sh | sh" startT={0.3} endT={1.8} localTime={t} prefix="$" />
          <TermLine at={2.1} localTime={t} style={{ color: FAINT }}>↳ installed aju → /usr/local/bin/aju</TermLine>
          <div style={{ height: 14 }} />
          <Typewriter text="aju login" startT={2.8} endT={3.6} localTime={t} prefix="$" />
          <TermLine at={3.9} localTime={t} style={{ color: FAINT }}>↳ opening aju.sh/cli/auth …</TermLine>
          <TermLine at={4.5} localTime={t}>
            <span style={{ color: ACCENT }}>✓</span>
            <span style={{ color: INK, marginLeft: 10 }}>signed in as</span>
            <span style={{ color: ACCENT, marginLeft: 8 }}>you@somewhere.com</span>
          </TermLine>
          <TermLine at={4.9} localTime={t} style={{ color: FAINT }}>
            ↳ default brain: <span style={{ color: INK }}>personal</span>
          </TermLine>
        </div>
      </TerminalWindow>
    </div>
  );
}

function SceneSkill(t: number) {
  const fileIn = clamp((t - 2.2) / 0.6, 0, 1);
  const checkIn = clamp((t - 4.2) / 0.5, 0, 1);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <TerminalWindow x={120} y={200} width={880} height={680} title="~ — zsh">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 11,
              color: FAINT,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            {"// teach claude to use aju"}
          </div>
          <Typewriter text="aju skill install claude" startT={0.2} endT={1.8} localTime={t} prefix="$" />
          <TermLine at={2.2} localTime={t} style={{ color: FAINT }}>
            ↳ writing ~/.claude/skills/aju/SKILL.md
          </TermLine>
          <TermLine at={2.7} localTime={t} style={{ color: FAINT }}>
            ↳ registering mcp server: mcp://aju
          </TermLine>
          <TermLine at={3.2} localTime={t} style={{ color: FAINT }}>
            ↳ claude can now read + write your brains.
          </TermLine>
          <TermLine at={3.9} localTime={t}>
            <span style={{ color: ACCENT }}>✓</span>
            <span style={{ color: INK, marginLeft: 10 }}>skill installed.</span>
            <span style={{ color: FAINT, marginLeft: 14 }}>{"// open claude — it just works."}</span>
          </TermLine>
        </div>
      </TerminalWindow>

      <div
        style={{
          position: "absolute",
          right: 100,
          top: 220,
          width: 760,
          opacity: fileIn,
          transform: `translateY(${(1 - fileIn) * 20}px)`,
        }}
      >
        <Eyebrow color={FAINT}>~/.claude/skills/aju/SKILL.md</Eyebrow>
        <div style={{ height: 16 }} />
        <div
          style={{
            background: WIN_BG,
            border: WIN_BORDER,
            borderRadius: 12,
            padding: "22px 26px",
            fontFamily: MONO,
            fontSize: 14,
            lineHeight: 1.8,
            color: MUTED,
            boxShadow: "0 20px 60px -20px rgba(0,0,0,0.9)",
          }}
        >
          <div style={{ color: FAINT }}>---</div>
          <div><span style={{ color: FAINT }}>name:</span> <span style={{ color: INK }}>aju</span></div>
          <div style={{ display: "flex", gap: 4 }}>
            <span style={{ color: FAINT }}>description:</span>
            <span style={{ color: INK }}>persistent memory across chats.</span>
          </div>
          <div><span style={{ color: FAINT }}>auto-invoke:</span> <span style={{ color: ACCENT }}>true</span></div>
          <div style={{ color: FAINT }}>---</div>
          <div style={{ height: 10 }} />
          <div style={{ color: MUTED }}>## when to save</div>
          <div>· facts, decisions, preferences, names</div>
          <div>· things the user calls &quot;important&quot;</div>
          <div style={{ height: 8 }} />
          <div style={{ color: MUTED }}>## when to recall</div>
          <div>· user references past work (&quot;as we discussed&quot;)</div>
          <div>· ambiguous proper nouns (projects, people)</div>
          <div style={{ height: 8 }} />
          <div style={{ color: MUTED }}>## tools</div>
          <div>· <span style={{ color: ACCENT }}>aju.save</span>(brain, note, links)</div>
          <div>· <span style={{ color: ACCENT }}>aju.recall</span>(brain, query)</div>
        </div>
        <div
          style={{
            position: "absolute",
            top: 40,
            right: 0,
            display: "flex",
            alignItems: "center",
            gap: 10,
            opacity: checkIn,
            transform: `scale(${0.8 + checkIn * 0.2})`,
            padding: "6px 14px",
            background: "rgba(34,197,94,0.12)",
            border: "1px solid rgba(34,197,94,0.6)",
            borderRadius: 999,
            fontFamily: MONO,
            fontSize: 12,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: ACCENT,
            boxShadow: "0 0 18px rgba(34,197,94,0.35)",
          }}
        >
          <span>✓</span>
          <span>auto-invoke</span>
        </div>
      </div>
    </div>
  );
}

type AutoTurn =
  | { at: number; divider: true; text: string }
  | { at: number; divider?: false; from: "user" | "claude" | "tool"; kind?: "save" | "recall"; text: string };

function SceneAutoMemory(t: number) {
  const turns: AutoTurn[] = [
    { at: 0.2, from: "user", text: "we're shipping billing behind a flag for acme. blocker is the postgres 17 upgrade." },
    { at: 2.4, from: "tool", kind: "save", text: "aju.save → brain:personal · 2 chunks · [[Billing]] [[Acme]] [[Postgres]]" },
    { at: 3.3, from: "claude", text: "got it. i'll remember the acme billing flag + pg17 blocker." },
    { at: 5.0, from: "user", text: "pricing call with jordan is thursday 2pm." },
    { at: 6.4, from: "tool", kind: "save", text: "aju.save → brain:personal · 1 chunk · [[Jordan]] [[Pricing]]" },
    { at: 7.4, divider: true, text: "— new chat · next week —" },
    { at: 8.0, from: "user", text: "what did we decide about acme again?" },
    { at: 8.9, from: "tool", kind: "recall", text: 'aju.recall "acme" → 3 chunks · 42ms' },
    { at: 9.7, from: "claude", text: "ship billing behind a flag for acme — blocked on the pg17 upgrade." },
  ];

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "center" }}>
      <div
        style={{
          width: 1200,
          marginTop: 140,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          fontFamily: SANS,
        }}
      >
        <Eyebrow color={FAINT}>claude — chat</Eyebrow>
        <div style={{ height: 8 }} />
        {turns.map((turn, i) => {
          if (t < turn.at) return null;
          const age = t - turn.at;
          const entry = clamp(age / 0.35, 0, 1);

          if (turn.divider) {
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  margin: "14px 0 8px",
                  opacity: entry,
                }}
              >
                <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.10)" }} />
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    color: ACCENT,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <PulseDot size={6} />
                  {turn.text}
                </div>
                <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.10)" }} />
              </div>
            );
          }

          if (turn.from === "tool") {
            const isRecall = turn.kind === "recall";
            return (
              <div
                key={i}
                style={{
                  alignSelf: "flex-start",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginLeft: 8,
                  marginTop: 2,
                  marginBottom: 2,
                  opacity: entry,
                  transform: `translateY(${(1 - entry) * 6}px)`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 12px",
                    background: isRecall ? "rgba(34,197,94,0.10)" : "rgba(14,15,18,0.6)",
                    border: `1px solid ${isRecall ? "rgba(34,197,94,0.5)" : "rgba(255,255,255,0.10)"}`,
                    borderRadius: 999,
                    fontFamily: MONO,
                    fontSize: 12,
                    color: isRecall ? ACCENT : MUTED,
                    boxShadow: isRecall ? "0 0 14px rgba(34,197,94,0.3)" : "none",
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 6,
                      background: isRecall ? ACCENT : MUTED,
                    }}
                  />
                  {turn.text}
                </div>
              </div>
            );
          }

          const isAgent = turn.from === "claude";
          return (
            <div
              key={i}
              style={{
                alignSelf: isAgent ? "flex-start" : "flex-end",
                maxWidth: "78%",
                opacity: entry,
                transform: `translateY(${(1 - entry) * 10}px)`,
                padding: "12px 18px",
                background: isAgent ? WIN_BG : "rgba(34,197,94,0.08)",
                border: `1px solid ${isAgent ? "rgba(255,255,255,0.08)" : "rgba(34,197,94,0.25)"}`,
                borderRadius: 14,
                fontSize: 19,
                fontWeight: 300,
                letterSpacing: "-0.01em",
                color: INK,
              }}
            >
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: isAgent ? FAINT : ACCENT,
                  marginBottom: 6,
                }}
              >
                {isAgent ? "claude" : "you"}
              </div>
              {turn.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SceneRouting(t: number) {
  const body = `work      — projects, decisions, coworkers
personal  — defaults; health, ideas, plans
research  — papers, experiments, notes`;

  const total = body.length;
  const typeStart = 0.6;
  const typeEnd = 3.4;
  const chars = Math.max(
    0,
    Math.min(total, Math.floor(((t - typeStart) / (typeEnd - typeStart)) * total))
  );
  const typed = body.slice(0, chars);

  const cardsIn = clamp((t - 3.6) / 0.8, 0, 1);
  const routing = clamp((t - 5.0) / 1.5, 0, 1);

  const brains = [
    { id: "work", label: "work", note: "acme / billing / pg17", chunks: 14 },
    { id: "personal", label: "personal", note: "defaults", chunks: 32 },
    { id: "research", label: "research", note: "papers + exp", chunks: 8 },
  ];
  const activeIdx = routing > 0 ? Math.floor((t - 5.0) % 3) : -1;

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div
        style={{
          position: "absolute",
          left: 100,
          top: 170,
          width: 900,
          height: 780,
          background: WIN_BG,
          border: WIN_BORDER,
          borderRadius: 12,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: 10, background: "rgba(255,255,255,0.12)" }} />
          <span style={{ width: 10, height: 10, borderRadius: 10, background: "rgba(255,255,255,0.12)" }} />
          <span style={{ width: 10, height: 10, borderRadius: 10, background: "rgba(255,255,255,0.12)" }} />
          <span
            style={{
              marginLeft: 10,
              fontFamily: MONO,
              fontSize: 11,
              color: FAINT,
              letterSpacing: "0.08em",
            }}
          >
            ~/.claude/skills/aju/SKILL.md
          </span>
        </div>
        <div
          style={{
            flex: 1,
            padding: "28px 32px",
            fontFamily: MONO,
            fontSize: 15,
            lineHeight: 1.9,
            color: MUTED,
            whiteSpace: "pre",
          }}
        >
          <div style={{ color: FAINT }}>{"# … (earlier config)"}</div>
          <div style={{ height: 16 }} />
          <div style={{ color: INK }}>## brains</div>
          <div style={{ color: FAINT, marginBottom: 14 }}># auto-route based on topic</div>
          <div style={{ color: INK }}>
            {typed.split("\n").map((line, i) => {
              const m = line.match(/^(\S+)(\s+—\s+.*)$/);
              if (m) {
                return (
                  <div key={i}>
                    <span style={{ color: ACCENT }}>{m[1]}</span>
                    <span style={{ color: MUTED }}>{m[2]}</span>
                  </div>
                );
              }
              return <div key={i} style={{ color: MUTED }}>{line}</div>;
            })}
            {t < typeEnd && (
              <span
                style={{
                  display: "inline-block",
                  width: 9,
                  height: 18,
                  background: ACCENT,
                  opacity: Math.floor(t * 2) % 2 === 0 ? 0.9 : 0.2,
                  verticalAlign: "middle",
                }}
              />
            )}
          </div>
          <div style={{ height: 18 }} />
          <div style={{ color: FAINT }}>{"# claude picks the brain based on topic."}</div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          right: 100,
          top: 200,
          width: 760,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          opacity: cardsIn,
          transform: `translateX(${(1 - cardsIn) * 30}px)`,
        }}
      >
        <Eyebrow color={FAINT}>brains · 3 live</Eyebrow>
        <div style={{ height: 4 }} />
        {brains.map((b, i) => {
          const isActive = i === activeIdx;
          return (
            <div
              key={b.id}
              style={{
                background: WIN_BG,
                border: isActive ? "1px solid rgba(34,197,94,0.6)" : WIN_BORDER,
                borderRadius: 12,
                padding: "18px 22px",
                display: "flex",
                alignItems: "center",
                gap: 20,
                boxShadow: isActive
                  ? "0 0 24px rgba(34,197,94,0.3)"
                  : "0 20px 60px -20px rgba(0,0,0,0.9)",
                transition: "all 200ms",
              }}
            >
              <PulseDot size={8} color={isActive ? ACCENT : FAINT} />
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontFamily: SANS,
                    fontSize: 22,
                    fontWeight: 400,
                    letterSpacing: "-0.01em",
                    color: INK,
                  }}
                >
                  {b.label}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 12, color: FAINT, marginTop: 4 }}>
                  {b.note}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    color: FAINT,
                  }}
                >
                  chunks
                </div>
                <div
                  style={{
                    fontFamily: SANS,
                    fontSize: 22,
                    fontWeight: 300,
                    color: isActive ? ACCENT : INK,
                  }}
                >
                  {b.chunks}
                  {isActive ? " +1" : ""}
                </div>
              </div>
            </div>
          );
        })}

        {routing > 0 && activeIdx >= 0 && (
          <div
            style={{
              marginTop: 10,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 14px",
              background: "rgba(34,197,94,0.10)",
              border: "1px solid rgba(34,197,94,0.4)",
              borderRadius: 999,
              fontFamily: MONO,
              fontSize: 12,
              color: ACCENT,
              alignSelf: "flex-start",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 6, background: ACCENT }} />
            aju.save → <span style={{ color: INK }}>{brains[activeIdx].label}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function SceneOutro(t: number) {
  const lineIn = clamp((t - 0.2) / 0.6, 0, 1);
  const ctaIn = clamp((t - 1.2) / 0.6, 0, 1);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 36,
      }}
    >
      <div
        style={{
          fontFamily: SANS,
          fontSize: 48,
          fontWeight: 300,
          letterSpacing: "-0.03em",
          color: INK,
          opacity: lineIn,
          transform: `translateY(${(1 - lineIn) * 14}px)`,
          textAlign: "center",
        }}
      >
        stop repeating yourself.<br />
        <span style={{ color: MUTED }}>let your agents remember.</span>
      </div>
      <div
        style={{
          opacity: ctaIn,
          transform: `translateY(${(1 - ctaIn) * 14}px)`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 22,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "16px 28px",
            background: WIN_BG,
            border: WIN_BORDER,
            borderRadius: 12,
            fontFamily: MONO,
            fontSize: 20,
            color: INK,
          }}
        >
          <span style={{ color: ACCENT }}>$</span>
          <span>curl -fsSL install.aju.sh | sh</span>
        </div>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 20,
            fontWeight: 300,
            letterSpacing: "0.02em",
            color: MUTED,
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <PulseDot size={7} />
          <span>aju.sh — memory for AI agents</span>
        </div>
      </div>
    </div>
  );
}

const SCENES: Scene[] = [
  { id: 1, name: "problem", label: "the problem", start: 0, end: 5, render: (t) => SceneProblem(t) },
  { id: 2, name: "solution", label: "meet aju", start: 5, end: 10, render: (t, d) => SceneSolution(t, d) },
  { id: 3, name: "install", label: "install + login", start: 10, end: 16, render: (t) => SceneInstall(t) },
  { id: 4, name: "skill", label: "claude skill", start: 16, end: 23, render: (t) => SceneSkill(t) },
  { id: 5, name: "auto", label: "auto memory", start: 23, end: 34, render: (t) => SceneAutoMemory(t) },
  { id: 6, name: "routing", label: "route brains", start: 34, end: 41, render: (t) => SceneRouting(t) },
  { id: 7, name: "outro", label: "install", start: 41, end: 45, render: (t) => SceneOutro(t) },
];

const CAPTIONS: Caption[] = [
  { start: 0.6, end: 4.8, eyebrow: "01 · the problem", text: "claude forgets. every new chat starts from zero." },
  { start: 5.4, end: 9.6, eyebrow: "02 · meet aju", text: "aju is persistent memory your agents read + write." },
  { start: 10.3, end: 13.0, eyebrow: "03 · setup", text: "one curl to install." },
  { start: 13.2, end: 15.8, eyebrow: "03 · setup", text: "`aju login` ties this device to your account." },
  { start: 16.3, end: 19.0, eyebrow: "04 · claude skill", text: "now — the point. you never write aju commands yourself." },
  { start: 19.2, end: 22.8, eyebrow: "04 · claude skill", text: "drop a skill in `~/.claude/skills/aju/` and claude takes over." },
  { start: 23.4, end: 27.0, eyebrow: "05 · auto memory", text: "talk to claude normally. it decides what to save." },
  { start: 27.2, end: 30.5, eyebrow: "05 · auto memory", text: "facts, decisions, names — saved as markdown + wikilinks." },
  { start: 30.7, end: 33.8, eyebrow: "05 · auto memory", text: "next session — claude recalls before you even ask." },
  { start: 34.3, end: 37.5, eyebrow: "06 · route brains", text: "edit the skill to split memory by topic." },
  { start: 37.7, end: 40.8, eyebrow: "06 · route brains", text: "claude picks work / personal / research automatically." },
  { start: 41.3, end: 44.8, text: "aju.sh — memory for AI agents" },
];

const DURATION = 45;
const CANVAS_W = 1920;
const CANVAS_H = 1080;

export default function OnboardingAnimation() {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [scale, setScale] = useState(1);
  const [inView, setInView] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  // scale canvas to fit container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const s = el.clientWidth / CANVAS_W;
      setScale(s);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // pause when off-screen
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setInView(e.isIntersecting);
      },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // pause when tab hidden
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) setPlaying(false);
      else setPlaying(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // raf loop
  useEffect(() => {
    if (!playing || !inView) {
      lastTsRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    const step = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      setTime((prev) => {
        let next = prev + dt;
        if (next >= DURATION) next = next % DURATION;
        return next;
      });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTsRef.current = null;
    };
  }, [playing, inView]);

  const activeScene = SCENES.find((s) => time >= s.start && time < s.end) ?? SCENES[0];
  const activeCaption = CAPTIONS.find((c) => time >= c.start && time < c.end);

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#050608] shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]"
      style={{ aspectRatio: "16 / 9" }}
      aria-label="aju onboarding — memory for AI agents"
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: CANVAS_W,
          height: CANVAS_H,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {/* matrix rain behind every scene */}
        <SceneRain intensity={0.7} />

        {/* active scene */}
        {activeScene.render(time - activeScene.start, activeScene.end - activeScene.start)}

        {/* scene label (top-left) */}
        <div
          style={{
            position: "absolute",
            top: 48,
            left: 56,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <PulseDot />
          <Eyebrow color={MUTED} size={11}>
            {`0${activeScene.id}`} — {activeScene.label}
          </Eyebrow>
        </div>

        {/* top-right wordmark watermark after scene 2 */}
        {time > 10 && (
          <div
            style={{
              position: "absolute",
              top: 48,
              right: 56,
              fontFamily: SANS,
              fontSize: 24,
              fontWeight: 300,
              letterSpacing: "-0.04em",
              color: "rgba(236,236,238,0.5)",
            }}
          >
            aju
          </div>
        )}

        {/* captions */}
        {activeCaption && (
          <div
            style={{
              position: "absolute",
              bottom: 120,
              left: "50%",
              transform: "translateX(-50%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
              pointerEvents: "none",
            }}
          >
            {activeCaption.eyebrow && (
              <Eyebrow color={ACCENT} size={12}>
                {activeCaption.eyebrow}
              </Eyebrow>
            )}
            <div
              style={{
                fontFamily: SANS,
                fontSize: 28,
                fontWeight: 300,
                letterSpacing: "-0.02em",
                color: INK,
                textAlign: "center",
                maxWidth: 1100,
                lineHeight: 1.3,
                padding: "14px 32px",
                background: "rgba(14,15,18,0.75)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12,
                backdropFilter: "blur(10px)",
              }}
            >
              {activeCaption.text}
            </div>
          </div>
        )}

        {/* progress dots */}
        <div
          style={{
            position: "absolute",
            bottom: 40,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            gap: 10,
          }}
        >
          {SCENES.map((s) => {
            const isActive = time >= s.start && time < s.end;
            const done = time >= s.end;
            return (
              <div
                key={s.id}
                style={{
                  width: isActive ? 28 : 6,
                  height: 6,
                  borderRadius: 3,
                  background: isActive
                    ? ACCENT
                    : done
                    ? "rgba(34,197,94,0.4)"
                    : "rgba(255,255,255,0.14)",
                  boxShadow: isActive ? "0 0 10px rgba(34,197,94,0.6)" : "none",
                  transition: "all 250ms",
                }}
              />
            );
          })}
        </div>
      </div>

      {/* play/pause overlay button (bottom-right) */}
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? "pause" : "play"}
        className="absolute right-3 bottom-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-[#0e0f12]/80 text-[var(--color-muted)] backdrop-blur-md transition hover:border-[var(--color-accent)]/40 hover:text-[var(--color-accent)]"
      >
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <rect x="3" y="2" width="3" height="10" fill="currentColor" />
            <rect x="8" y="2" width="3" height="10" fill="currentColor" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M3 2l9 5-9 5V2z" fill="currentColor" />
          </svg>
        )}
      </button>
    </div>
  );
}
