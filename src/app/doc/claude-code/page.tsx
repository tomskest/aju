import CodeBlock from "@/components/doc/CodeBlock";

const SKILL_EXAMPLE = `---
name: aju
description: Search, read, write, and recall persistent memory from the user's aju brain — also referred to as the vault, notes, journal, archive, diary, notebook, or knowledge base. Use whenever the user mentions aju, brain, vault, notes, journal, memory, recall, remember… [~230 lines total]
allowed-tools: Bash
---

# aju — persistent memory

The aju CLI is already installed and authenticated on this machine. Use it
via Bash for every memory operation.

## Core principle
1. Search before writing. You don't know what's already there.
2. Update, don't duplicate. If a doc on this topic exists, expand it.
3. Link generously. Wikilinks build the graph.

## Search before anything else
\`\`\`
aju search "<keyword>"      # FTS keyword search with snippets
aju semantic "<phrasing>"   # meaning-based, catches paraphrases
aju browse <dir>            # list docs under a directory prefix
\`\`\`

## Writing well
- Stable paths: topics/<slug>.md, journal/<YYYY-MM-DD>.md, decisions/<slug>.md
- Frontmatter: tags, optional source: claude-code
- Wikilinks [[Like This]] to connect related docs
- Prefer \`update\` over creating duplicates

## …plus sections for graph navigation, files, multi-brain, common workflows, admin commands, output conventions, and explicit "Do NOT" guardrails.

Run \`aju help <command>\` for details on any command.
`;

export default function ClaudeCodePage() {
  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
          Claude Code
        </p>
        <h1 className="text-[32px] font-light leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)]">
          The easy path: skills.
        </h1>
        <p className="text-[14.5px] leading-relaxed text-[var(--color-muted)]">
          Skills are the simplest way to give Claude Code durable memory.
          Install one command, restart nothing, and Claude starts routing
          natural questions like &ldquo;what do we know about X&rdquo; through your brain.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-medium text-[var(--color-ink)]">
          One command
        </h2>
        <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">
          Run this inside a shell where{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            aju login
          </code>{" "}
          has already succeeded. It writes a{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            SKILL.md
          </code>{" "}
          file into Claude Code&rsquo;s skills directory — one per brain you
          have access to.
        </p>
        <CodeBlock code="aju skill install claude" prompt />
        <p className="text-[13px] text-[var(--color-muted)]">
          Generated path:{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            ~/.claude/skills/aju/SKILL.md
          </code>
          . The skill teaches Claude Code to route memory questions through the{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            aju
          </code>{" "}
          CLI, which already knows which brain you have selected locally.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-medium text-[var(--color-ink)]">
          How it works
        </h2>
        <ul className="flex flex-col gap-3 text-[14px] leading-relaxed text-[var(--color-muted)]">
          <li className="flex gap-3">
            <span
              aria-hidden
              className="mt-[7px] size-[6px] shrink-0 rounded-full bg-[var(--color-accent)]"
            />
            <span>
              Claude Code auto-discovers any{" "}
              <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
                SKILL.md
              </code>{" "}
              under{" "}
              <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
                ~/.claude/skills/
              </code>{" "}
              on startup. Nothing to configure.
            </span>
          </li>
          <li className="flex gap-3">
            <span
              aria-hidden
              className="mt-[7px] size-[6px] shrink-0 rounded-full bg-[var(--color-accent)]"
            />
            <span>
              When your intent matches the skill description (&ldquo;search my
              brain&rdquo;, &ldquo;recall that note about...&rdquo;), Claude
              loads the skill and follows its instructions.
            </span>
          </li>
          <li className="flex gap-3">
            <span
              aria-hidden
              className="mt-[7px] size-[6px] shrink-0 rounded-full bg-[var(--color-accent)]"
            />
            <span>
              The skill tells Claude to shell out to{" "}
              <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
                aju search
              </code>
              ,{" "}
              <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
                aju read
              </code>
              ,{" "}
              <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
                aju create
              </code>{" "}
              via the Bash tool.
            </span>
          </li>
          <li className="flex gap-3">
            <span
              aria-hidden
              className="mt-[7px] size-[6px] shrink-0 rounded-full bg-[var(--color-accent)]"
            />
            <span>
              No MCP client config, no restart, no background process. Works
              anywhere Claude can run bash.
            </span>
          </li>
          <li className="flex gap-3">
            <span
              aria-hidden
              className="mt-[7px] size-[6px] shrink-0 rounded-full bg-[var(--color-accent)]"
            />
            <span>
              One skill file covers every brain you have access to — the CLI
              handles brain selection locally, so the agent stays simple.
            </span>
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-medium text-[var(--color-ink)]">
          What the generated SKILL.md looks like
        </h2>
        <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">
          Trimmed for readability. The exact content is templated against your
          brain name and a few sensible defaults.
        </p>
        <CodeBlock code={SKILL_EXAMPLE} language="markdown" />
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-white/5 bg-[var(--color-panel)]/40 p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
          Prefer MCP?
        </p>
        <p className="text-[14px] leading-relaxed text-[var(--color-ink)]">
          Skills cover 95% of use cases. If you need tighter integration or are
          wiring up a non-Claude client, see the{" "}
          <a
            href="/doc/mcp"
            className="underline-offset-4 hover:underline"
          >
            MCP page
          </a>
          .
        </p>
      </section>
    </article>
  );
}
