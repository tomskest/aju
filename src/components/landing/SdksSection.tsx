"use client";

import { useState } from "react";
import Link from "next/link";
import { Eyebrow, H2, Section } from "./LandingPrimitives";

/**
 * SDKs section. Pitches the three typed clients as a coordinated surface:
 *   1. One OpenAPI spec — the contract.
 *   2. Three generated SDKs — TypeScript, Python, Go — always in lockstep.
 *   3. Zero drift between languages because regeneration happens from one
 *      source.
 *
 * Visually mirrors McpSection: left column is the story (spec → clients,
 * coverage), right column is a tabbed picker with install + quickstart.
 */

type Sdk = {
  id: "typescript" | "python" | "go";
  label: string;
  install: string;
  snippet: string;
};

const SDKS: Sdk[] = [
  {
    id: "typescript",
    label: "TypeScript",
    install: "npm install @aju/sdk",
    snippet: `import { createAjuClient, api } from "@aju/sdk";

const client = createAjuClient({
  apiKey: process.env.AJU_API_KEY!,
});

const { data } = await api.searchVault({
  client,
  query: { q: "weekly notes", limit: 10 },
});`,
  },
  {
    id: "python",
    label: "Python",
    install: "pip install aju",
    snippet: `from aju import AjuClient
from aju._generated.api.vault import search_vault

client = AjuClient(api_key="aju_live_...")
resp = search_vault.sync(
    client=client,
    q="weekly notes",
    limit=10,
)`,
  },
  {
    id: "go",
    label: "Go",
    install: "go get github.com/tomskest/aju/client/openapi/go/ajuclient",
    snippet: `import "github.com/tomskest/aju/client/openapi/go/ajuclient"

c, _ := ajuclient.New("aju_live_...")
limit := 10
resp, _ := c.SearchVault(ctx,
    &ajuclient.SearchVaultParams{
        Q:     "weekly notes",
        Limit: &limit,
    })`,
  },
];

const COVERED = [
  "search",
  "semantic-search",
  "deep-search",
  "read",
  "browse",
  "create",
  "update",
  "delete",
  "backlinks",
  "related",
  "graph",
  "changes",
  "files",
  "brains",
];

export default function SdksSection() {
  const [active, setActive] = useState<Sdk["id"]>("typescript");
  const sdk = SDKS.find((s) => s.id === active)!;

  return (
    <Section id="sdks">
      <Eyebrow>05 · build with a typed SDK</Eyebrow>
      <H2>
        native SDKs. three languages.
        <br />
        <em className="not-italic text-[var(--color-faint)]">
          one spec keeping them in sync.
        </em>
      </H2>
      <p className="mt-5 max-w-[680px] text-[18px] font-light leading-[1.55] text-[var(--color-muted)]">
        drop <code className="font-mono text-[16px] text-[var(--color-ink)]">@aju/sdk</code>{" "}
        into a Node service, <code className="font-mono text-[16px] text-[var(--color-ink)]">aju</code>{" "}
        into a Python notebook, or{" "}
        <code className="font-mono text-[16px] text-[var(--color-ink)]">ajuclient</code>{" "}
        into a Go binary. all three are generated from a single OpenAPI
        spec — add an endpoint, regenerate, every client updates together.
      </p>

      <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-[0.9fr_1.1fr]">
        {/* LEFT — spec pitch + coverage */}
        <div className="flex flex-col gap-6">
          <div className="rounded-[14px] border border-white/10 bg-[rgba(14,15,18,0.82)] p-6 shadow-[0_10px_40px_-20px_rgba(0,0,0,0.9)] backdrop-blur-md">
            <p className="m-0 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
              the source of truth
            </p>
            <div className="mt-3 flex items-center gap-3 rounded-md border border-white/10 bg-[rgba(5,6,8,0.6)] px-3.5 py-2.5 font-mono text-[13px]">
              <span className="text-[var(--color-accent)]">→</span>
              <span className="flex-1 truncate text-[var(--color-ink)]">
                client/openapi/openapi.yaml
              </span>
            </div>
            <p className="mt-3 font-mono text-[11.5px] leading-[1.7] text-[var(--color-muted)]">
              one OpenAPI 3.0 spec describes every endpoint, request, and
              response. the SDKs are generated, not hand-written — so the
              typed client you import tomorrow matches the spec we merged
              today.
            </p>
          </div>

          <div className="rounded-[14px] border border-white/10 bg-[rgba(14,15,18,0.82)] p-6 shadow-[0_10px_40px_-20px_rgba(0,0,0,0.9)] backdrop-blur-md">
            <p className="m-0 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
              generation flow
            </p>
            <ol className="mt-3 flex flex-col gap-2 font-mono text-[12.5px] leading-[1.6] text-[var(--color-muted)]">
              <li>
                <span className="text-[var(--color-faint)]">01 </span>
                edit a route in{" "}
                <span className="text-[var(--color-ink)]">src/app/api</span>
              </li>
              <li>
                <span className="text-[var(--color-faint)]">02 </span>
                update{" "}
                <span className="text-[var(--color-ink)]">openapi.yaml</span>{" "}
                to match
              </li>
              <li>
                <span className="text-[var(--color-faint)]">03 </span>
                run{" "}
                <span className="text-[var(--color-ink)]">
                  ./client/openapi/sh/generate.sh
                </span>
              </li>
              <li>
                <span className="text-[var(--color-faint)]">04 </span>
                commit spec + regenerated code together — zero drift
              </li>
            </ol>
          </div>

          <div className="rounded-[14px] border border-white/10 bg-[rgba(14,15,18,0.82)] p-6 shadow-[0_10px_40px_-20px_rgba(0,0,0,0.9)] backdrop-blur-md">
            <p className="m-0 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
              what they wrap
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {COVERED.map((t) => (
                <span
                  key={t}
                  className="rounded border border-white/5 bg-[rgba(5,6,8,0.6)] px-2 py-1 font-mono text-[11px] text-[var(--color-muted)]"
                >
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-4 font-mono text-[11.5px] text-[var(--color-faint)]">
              full API reference at{" "}
              <Link
                href="/doc/sdks"
                className="text-[var(--color-accent)] underline-offset-4 hover:underline"
              >
                /doc/sdks
              </Link>
              .
            </p>
          </div>
        </div>

        {/* RIGHT — language picker */}
        <div className="flex flex-col overflow-hidden rounded-[14px] border border-white/10 bg-[rgba(14,15,18,0.82)] shadow-[0_10px_40px_-20px_rgba(0,0,0,0.9)] backdrop-blur-md">
          <div className="flex border-b border-white/5">
            {SDKS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActive(s.id)}
                className={`flex-1 border-r border-white/5 px-3 py-3 font-mono text-[10.5px] uppercase tracking-[0.22em] transition last:border-r-0 ${
                  s.id === active
                    ? "bg-[var(--color-accent)]/[0.06] text-[var(--color-accent)]"
                    : "text-[var(--color-faint)] hover:text-[var(--color-muted)]"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-5 p-6">
            <div className="flex flex-col gap-2">
              <p className="m-0 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
                install
              </p>
              <pre className="m-0 overflow-x-auto whitespace-pre rounded-md border border-white/5 bg-[rgba(5,6,8,0.6)] p-3.5 font-mono text-[12.5px] text-[var(--color-ink)]">
                {sdk.install}
              </pre>
            </div>

            <div className="flex flex-col gap-2">
              <p className="m-0 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
                first call
              </p>
              <pre className="m-0 overflow-x-auto whitespace-pre rounded-md border border-white/5 bg-[rgba(5,6,8,0.6)] p-4 font-mono text-[12.5px] leading-[1.7] text-[var(--color-ink)]">
                {sdk.snippet}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
