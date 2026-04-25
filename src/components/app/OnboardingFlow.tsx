"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import CopyButton from "./CopyButton";

type Path = "cli" | "mcp" | "both";

type Step = {
  id: string;
  title: string;
  command?: string;
  endpoint?: string;
  body: React.ReactNode;
};

const STORAGE_KEY = "aju.onboarding.path";

function CodeLine({ command, kind = "cmd" }: { command: string; kind?: "cmd" | "url" }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-[var(--color-panel)]/85 px-4 py-3 font-mono text-[13px] shadow-[0_10px_40px_-20px_rgba(0,0,0,0.9)]">
      <span className="select-none text-[var(--color-accent)]">
        {kind === "url" ? "→" : "$"}
      </span>
      <span className="flex-1 truncate text-[var(--color-ink)]">{command}</span>
      <CopyButton value={command} />
    </div>
  );
}

const CLI_STEPS: Step[] = [
  {
    id: "cli-install",
    title: "Install the CLI",
    command: "curl -fsSL install.aju.sh | sh",
    body: (
      <p className="text-[13px] leading-6 text-[var(--color-muted)]">
        Installs the{" "}
        <span className="font-mono text-[var(--color-ink)]">aju</span> binary
        into <span className="font-mono">~/.aju/bin</span> and adds it to your{" "}
        <span className="font-mono">PATH</span>. macOS and Linux, x86_64 and
        arm64.
      </p>
    ),
  },
  {
    id: "cli-login",
    title: "Sign in with aju login",
    command: "aju login",
    body: (
      <>
        <p className="text-[13px] leading-6 text-[var(--color-muted)]">
          Opens a browser tab with a short device code. Paste it on aju.sh to
          approve the session — the CLI mints a scoped API key and writes it
          to{" "}
          <span className="font-mono text-[var(--color-ink)]">
            ~/.aju/config.json
          </span>
          .
        </p>
        <p className="mt-2 text-[13px] leading-6 text-[var(--color-muted)]">
          You can revoke the key anytime from the{" "}
          <Link
            href="/app/keys"
            className="text-[var(--color-ink)] underline-offset-4 hover:underline"
          >
            API Keys page
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    id: "cli-brain",
    title: "Create your first brain",
    command: "aju brains create my-first-brain",
    body: (
      <p className="text-[13px] leading-6 text-[var(--color-muted)]">
        A brain is a vault — its own namespace for documents, links, and
        files. Create one from the CLI, or use the{" "}
        <Link
          href="/app/brains"
          className="text-[var(--color-ink)] underline-offset-4 hover:underline"
        >
          Brains page
        </Link>
        .
      </p>
    ),
  },
  {
    id: "cli-doc",
    title: "Add a document",
    command: "aju create notes/hello.md < hello.md",
    body: (
      <p className="text-[13px] leading-6 text-[var(--color-muted)]">
        Pipe any markdown file in and aju parses frontmatter, extracts
        wikilinks, and generates embeddings in the background. Use{" "}
        <span className="font-mono">aju update</span> and{" "}
        <span className="font-mono">aju delete</span> for later edits.
      </p>
    ),
  },
  {
    id: "cli-skill",
    title: "Install the Claude Code skill",
    command: "aju skill install claude",
    body: (
      <p className="text-[13px] leading-6 text-[var(--color-muted)]">
        Drops an aju skill into your Claude Code config so the agent can read,
        search, and write memory with a single command. Lighter than a full
        MCP connection and Claude-Code-specific.
      </p>
    ),
  },
];

// Resolve the MCP endpoint URL. Production serves it at
// https://mcp.aju.sh/mcp (a dedicated subdomain rewriting to /api/mcp).
// Override with NEXT_PUBLIC_MCP_URL for local dev or staging.
const MCP_ENDPOINT_URL =
  process.env.NEXT_PUBLIC_MCP_URL ?? "https://mcp.aju.sh/mcp";

const MCP_STEPS: Step[] = [
  {
    id: "mcp-key",
    title: "Mint an API key",
    body: (
      <>
        <p className="text-[13px] leading-6 text-[var(--color-muted)]">
          MCP clients authenticate with a bearer token. Create one on the{" "}
          <Link
            href="/app/keys"
            className="text-[var(--color-ink)] underline-offset-4 hover:underline"
          >
            API Keys page
          </Link>
          . Treat it like a password — anyone with the token can read and
          write to your brains.
        </p>
        <Link
          href="/app/keys"
          className="mt-3 inline-flex w-fit items-center gap-2 rounded-md border border-white/10 bg-[var(--color-panel)]/60 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)] transition hover:border-[var(--color-accent)]/40 hover:text-[var(--color-accent)]"
        >
          <span>open keys</span>
          <span aria-hidden>→</span>
        </Link>
      </>
    ),
  },
  {
    id: "mcp-brain",
    title: "Create a brain",
    body: (
      <>
        <p className="text-[13px] leading-6 text-[var(--color-muted)]">
          Spin up a vault to hold your documents. Every MCP tool call accepts
          an optional <span className="font-mono">brain</span> argument — or
          set a default by appending{" "}
          <span className="font-mono">?brain=&lt;name&gt;</span> to the
          endpoint URL.
        </p>
        <Link
          href="/app/brains"
          className="mt-3 inline-flex w-fit items-center gap-2 rounded-md border border-white/10 bg-[var(--color-panel)]/60 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)] transition hover:border-[var(--color-accent)]/40 hover:text-[var(--color-accent)]"
        >
          <span>open brains</span>
          <span aria-hidden>→</span>
        </Link>
      </>
    ),
  },
  {
    id: "mcp-endpoint",
    title: "Point your client at the endpoint",
    endpoint: MCP_ENDPOINT_URL,
    body: (
      <>
        <p className="text-[13px] leading-6 text-[var(--color-muted)]">
          Any MCP-capable host — Claude Desktop, Claude.ai, Cursor, OpenCode,
          Zed — connects with the URL above and your bearer token. No local
          process to run.
        </p>
        <p className="mt-2 text-[13px] leading-6 text-[var(--color-muted)]">
          Full per-client config snippets live in the{" "}
          <Link
            href="/docs/mcp"
            className="text-[var(--color-ink)] underline-offset-4 hover:underline"
          >
            MCP docs
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    id: "mcp-try",
    title: "Try a tool call",
    body: (
      <>
        <p className="text-[13px] leading-6 text-[var(--color-muted)]">
          Restart your client so it picks up the new server, then ask it to
          create a document or run a search. The exposed tools:
        </p>
        <ul className="mt-2 flex flex-col gap-1 font-mono text-[12.5px] text-[var(--color-muted)]">
          <li>
            <span className="text-[var(--color-ink)]">aju_search</span>,{" "}
            <span className="text-[var(--color-ink)]">aju_semantic_search</span>
          </li>
          <li>
            <span className="text-[var(--color-ink)]">aju_read</span>,{" "}
            <span className="text-[var(--color-ink)]">aju_browse</span>
          </li>
          <li>
            <span className="text-[var(--color-ink)]">aju_create</span>,{" "}
            <span className="text-[var(--color-ink)]">aju_update</span>,{" "}
            <span className="text-[var(--color-ink)]">aju_delete</span>
          </li>
          <li>
            <span className="text-[var(--color-ink)]">aju_backlinks</span>,{" "}
            <span className="text-[var(--color-ink)]">aju_related</span>,{" "}
            <span className="text-[var(--color-ink)]">aju_brains_list</span>
          </li>
        </ul>
      </>
    ),
  },
];

const BOTH_STEPS: Step[] = [
  CLI_STEPS[0], // install
  CLI_STEPS[1], // aju login — also mints the key MCP clients can use
  CLI_STEPS[2], // create brain via CLI
  CLI_STEPS[3], // add a doc via CLI
  MCP_STEPS[2], // endpoint + docs link
  CLI_STEPS[4], // claude code skill
];

function stepsFor(path: Path): Step[] {
  if (path === "cli") return CLI_STEPS;
  if (path === "mcp") return MCP_STEPS;
  return BOTH_STEPS;
}

const PATH_COPY: Record<Path, { label: string; sub: string; blurb: string }> = {
  cli: {
    label: "CLI",
    sub: "terminal-first",
    blurb:
      "Install the aju binary and drive everything from your shell. Good fit if you live in the terminal and want scriptable memory.",
  },
  mcp: {
    label: "MCP",
    sub: "no install",
    blurb:
      "Skip the binary. Mint a bearer token and plug aju straight into Claude Desktop, Claude.ai, Cursor, OpenCode, Zed, or any MCP host.",
  },
  both: {
    label: "Both",
    sub: "recommended",
    blurb:
      "Run the CLI locally and expose the same brains to your MCP clients. The CLI login also mints the key MCP hosts will use.",
  },
};

export default function OnboardingFlow() {
  const [path, setPath] = useState<Path>("both");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "cli" || saved === "mcp" || saved === "both") {
        setPath(saved);
      }
    } catch {
      // localStorage can be unavailable (private mode, etc.) — fall back to default.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, path);
    } catch {
      // ignore
    }
  }, [path, hydrated]);

  const steps = stepsFor(path);
  const active = PATH_COPY[path];

  return (
    <>
      <section className="flex flex-col gap-4 rounded-xl border border-white/10 bg-[var(--color-panel)]/60 p-5">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            pick your path
          </p>
          <p className="text-[13px] leading-6 text-[var(--color-muted)]">
            How do you want to talk to aju? You can switch later — this only
            changes the steps shown below.
          </p>
        </div>

        <div
          role="radiogroup"
          aria-label="onboarding path"
          className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        >
          {(Object.keys(PATH_COPY) as Path[]).map((p) => {
            const copy = PATH_COPY[p];
            const selected = p === path;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPath(p)}
                className={`flex flex-col items-start gap-1 rounded-lg border px-4 py-3 text-left transition ${
                  selected
                    ? "border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10"
                    : "border-white/10 bg-[var(--color-bg)]/40 hover:border-white/20"
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <span
                    className={`font-mono text-[13px] ${
                      selected ? "text-[var(--color-accent)]" : "text-[var(--color-ink)]"
                    }`}
                  >
                    {copy.label}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
                    {copy.sub}
                  </span>
                </div>
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                  {p === "cli"
                    ? `${CLI_STEPS.length} steps`
                    : p === "mcp"
                      ? `${MCP_STEPS.length} steps`
                      : `${BOTH_STEPS.length} steps`}
                </span>
              </button>
            );
          })}
        </div>

        <p className="text-[13px] leading-6 text-[var(--color-muted)]">
          {active.blurb}
        </p>
      </section>

      <ol className="flex items-center gap-2 overflow-x-auto pb-2">
        {steps.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2">
            <span className="inline-flex size-7 items-center justify-center rounded-full border border-white/10 font-mono text-[11px] text-[var(--color-muted)]">
              {i + 1}
            </span>
            {i < steps.length - 1 && (
              <span className="h-px w-8 bg-white/10" aria-hidden />
            )}
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-8">
        {steps.map((s, i) => (
          <section
            key={s.id}
            className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5"
          >
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
                step {i + 1}
              </span>
              <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
                {s.title}
              </h2>
            </div>
            {s.command && <CodeLine command={s.command} kind="cmd" />}
            {s.endpoint && <CodeLine command={s.endpoint} kind="url" />}
            <div>{s.body}</div>
          </section>
        ))}
      </div>
    </>
  );
}
