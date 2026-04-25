"use client";

import { useState } from "react";
import Link from "next/link";
import { Eyebrow, H2, Section } from "./LandingPrimitives";

/**
 * MCP section. Pitches two things in one beat:
 *   1. One URL — `https://mcp.aju.sh/mcp` — hit from any MCP-capable host.
 *   2. OAuth sign-in on hosts that support it (Claude.ai hosted
 *      integrations are the canonical example), static-bearer config on
 *      the rest (Claude Desktop, Cursor, OpenCode).
 *
 * Configs mirror the shapes documented at /doc/mcp verbatim.
 */

const MCP_URL = "https://mcp.aju.sh/mcp";

type Client = {
  id: "claudeai" | "desktop" | "cursor" | "opencode";
  label: string;
  auth: "oauth" | "bearer";
  configPath?: string;
  snippet: string;
};

const CLIENTS: Client[] = [
  {
    id: "claudeai",
    label: "Claude.ai",
    auth: "oauth",
    snippet: `# Settings → Integrations → Add custom integration
# Paste the server URL:

${MCP_URL}

# Click "Sign in with aju" → redirected to aju.sh.
# Approve in your browser. Done — no key to copy.`,
  },
  {
    id: "desktop",
    label: "Claude Desktop",
    auth: "bearer",
    configPath: "~/Library/Application Support/Claude/claude_desktop_config.json",
    snippet: `{
  "mcpServers": {
    "aju": {
      "url": "${MCP_URL}",
      "headers": {
        "Authorization": "Bearer aju_live_<your key>"
      }
    }
  }
}`,
  },
  {
    id: "cursor",
    label: "Cursor",
    auth: "bearer",
    configPath: "~/.cursor/mcp.json",
    snippet: `{
  "mcpServers": {
    "aju": {
      "url": "${MCP_URL}",
      "headers": {
        "Authorization": "Bearer aju_live_<your key>"
      }
    }
  }
}`,
  },
  {
    id: "opencode",
    label: "OpenCode",
    auth: "bearer",
    configPath: "~/.config/opencode/config.json",
    snippet: `{
  "mcp": {
    "aju": {
      "url": "${MCP_URL}",
      "headers": {
        "Authorization": "Bearer aju_live_<your key>"
      }
    }
  }
}`,
  },
];

const TOOLS = [
  "aju_search",
  "aju_semantic_search",
  "aju_deep_search",
  "aju_read",
  "aju_browse",
  "aju_create",
  "aju_update",
  "aju_delete",
  "aju_backlinks",
  "aju_related",
  "aju_graph",
  "aju_changes",
  "aju_files_list",
  "aju_files_read",
  "aju_files_upload",
  "aju_brains_list",
];

export default function McpSection() {
  const [active, setActive] = useState<Client["id"]>("claudeai");
  const client = CLIENTS.find((c) => c.id === active)!;

  return (
    <Section id="mcp">
      <Eyebrow>04 · connect over MCP</Eyebrow>
      <H2>
        every MCP host. one URL.
        <br />
        <em className="not-italic text-[var(--color-faint)]">
          OAuth sign-in where it&apos;s supported.
        </em>
      </H2>
      <p className="mt-5 max-w-[680px] text-[18px] font-light leading-[1.55] text-[var(--color-muted)]">
        paste the endpoint into any MCP-capable client — Claude.ai,
        Claude Desktop, Cursor, OpenCode, or anything that speaks the
        protocol. hosts that support OAuth (Claude.ai&rsquo;s hosted
        integrations) get a sign-in-through-browser flow; the rest take a
        static bearer token from your dashboard.
      </p>

      <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-[0.9fr_1.1fr]">
        {/* LEFT — endpoint + OAuth story + tools */}
        <div className="flex flex-col gap-6">
          <div className="rounded-[14px] border border-white/10 bg-[rgba(14,15,18,0.82)] p-6 shadow-[0_10px_40px_-20px_rgba(0,0,0,0.9)] backdrop-blur-md">
            <p className="m-0 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
              the endpoint
            </p>
            <div className="mt-3 flex items-center gap-3 rounded-md border border-white/10 bg-[rgba(5,6,8,0.6)] px-3.5 py-2.5 font-mono text-[14px]">
              <span className="text-[var(--color-accent)]">→</span>
              <span className="flex-1 truncate text-[var(--color-ink)]">
                {MCP_URL}
              </span>
              <CopyButton value={MCP_URL} />
            </div>
            <p className="mt-3 font-mono text-[11.5px] leading-[1.7] text-[var(--color-muted)]">
              streamable HTTP. bearer auth and OAuth 2.1 both supported on
              the same URL — client picks.
            </p>
          </div>

          <div className="rounded-[14px] border border-white/10 bg-[rgba(14,15,18,0.82)] p-6 shadow-[0_10px_40px_-20px_rgba(0,0,0,0.9)] backdrop-blur-md">
            <p className="m-0 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
              OAuth flow
            </p>
            <ol className="mt-3 flex flex-col gap-2 font-mono text-[12.5px] leading-[1.6] text-[var(--color-muted)]">
              <li>
                <span className="text-[var(--color-faint)]">01 </span>
                host redirects to{" "}
                <span className="text-[var(--color-ink)]">aju.sh</span> with
                an authorize request
              </li>
              <li>
                <span className="text-[var(--color-faint)]">02 </span>
                you sign in (magic link) and approve the scopes
              </li>
              <li>
                <span className="text-[var(--color-faint)]">03 </span>
                aju mints a per-user API key pinned to your active org
              </li>
              <li>
                <span className="text-[var(--color-faint)]">04 </span>
                host stores the token; subsequent calls hit{" "}
                <span className="text-[var(--color-ink)]">mcp.aju.sh/mcp</span>{" "}
                with it
              </li>
            </ol>
            <p className="mt-4 font-mono text-[11.5px] text-[var(--color-faint)]">
              revoke a host any time with{" "}
              <span className="text-[var(--color-ink)]">aju keys revoke</span>{" "}
              or from the dashboard.
            </p>
          </div>

          <div className="rounded-[14px] border border-white/10 bg-[rgba(14,15,18,0.82)] p-6 shadow-[0_10px_40px_-20px_rgba(0,0,0,0.9)] backdrop-blur-md">
            <p className="m-0 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
              tools exposed
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {TOOLS.map((t) => (
                <span
                  key={t}
                  className="rounded border border-white/5 bg-[rgba(5,6,8,0.6)] px-2 py-1 font-mono text-[11px] text-[var(--color-muted)]"
                >
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-4 font-mono text-[11.5px] text-[var(--color-faint)]">
              same surface as the CLI. full parameter docs at{" "}
              <Link
                href="/doc/mcp"
                className="text-[var(--color-accent)] underline-offset-4 hover:underline"
              >
                /doc/mcp
              </Link>
              .
            </p>
          </div>
        </div>

        {/* RIGHT — client config picker */}
        <div className="flex flex-col overflow-hidden rounded-[14px] border border-white/10 bg-[rgba(14,15,18,0.82)] shadow-[0_10px_40px_-20px_rgba(0,0,0,0.9)] backdrop-blur-md">
          <div className="flex border-b border-white/5">
            {CLIENTS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActive(c.id)}
                className={`flex-1 border-r border-white/5 px-3 py-3 font-mono text-[10.5px] uppercase tracking-[0.22em] transition last:border-r-0 ${
                  c.id === active
                    ? "bg-[var(--color-accent)]/[0.06] text-[var(--color-accent)]"
                    : "text-[var(--color-faint)] hover:text-[var(--color-muted)]"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-4 p-6">
            <div className="flex items-center gap-3">
              <span
                className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.22em] ${
                  client.auth === "oauth"
                    ? "border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 text-[var(--color-accent)]"
                    : "border-white/5 text-[var(--color-faint)]"
                }`}
              >
                {client.auth === "oauth" ? "OAuth" : "bearer token"}
              </span>
              {client.configPath && (
                <span className="font-mono text-[11px] text-[var(--color-faint)]">
                  {client.configPath}
                </span>
              )}
            </div>

            <pre className="m-0 overflow-x-auto whitespace-pre rounded-md border border-white/5 bg-[rgba(5,6,8,0.6)] p-4 font-mono text-[12.5px] leading-[1.7] text-[var(--color-ink)]">
              {client.snippet}
            </pre>

            {client.auth === "bearer" && (
              <p className="m-0 font-mono text-[11.5px] text-[var(--color-faint)]">
                <span className="text-[var(--color-muted)]">
                  need a key?
                </span>{" "}
                <Link
                  href="/app/keys"
                  className="text-[var(--color-accent)] underline-offset-4 hover:underline"
                >
                  mint one in the dashboard
                </Link>{" "}
                — or{" "}
                <span className="text-[var(--color-ink)]">
                  aju keys create &lt;name&gt; --org &lt;slug&gt;
                </span>{" "}
                from the CLI.
              </p>
            )}
            {client.auth === "oauth" && (
              <p className="m-0 font-mono text-[11.5px] text-[var(--color-faint)]">
                <span className="text-[var(--color-muted)]">
                  no key to copy.
                </span>{" "}
                your aju account signs in once; Claude stores the returned
                token and refreshes it when it expires.
              </p>
            )}
          </div>
        </div>
      </div>
    </Section>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        } catch {
          // Clipboard API can be blocked; fail silently.
        }
      }}
      className="rounded border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}
