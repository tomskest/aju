import Link from "next/link";

export default function DocsWelcome() {
  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
          Welcome
        </p>
        <h1 className="text-[34px] font-light leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)]">
          Memory for AI agents.
        </h1>
        <p className="text-[15px] leading-relaxed text-[var(--color-muted)]">
          aju is a durable, queryable memory layer for AI agents and the humans
          who work with them. You store markdown in a brain, link documents
          with wikilinks, and search by keyword or meaning. Agents call the
          same surface through the CLI or MCP.
        </p>
      </header>

      <ul className="flex flex-col gap-3 text-[14px] text-[var(--color-ink)]">
        <li className="flex items-start gap-3 rounded-xl border border-white/5 bg-[var(--color-panel)]/50 px-4 py-3">
          <span
            aria-hidden
            className="mt-[7px] size-[6px] shrink-0 rounded-full bg-[var(--color-accent)] shadow-[0_0_8px_rgba(34,197,94,0.6)]"
          />
          <span>
            <span className="font-medium text-[var(--color-ink)]">
              CLI-first.
            </span>{" "}
            <span className="text-[var(--color-muted)]">
              Everything you can do in the UI, you can do in the terminal. Pipe
              files in, grep output, script anything.
            </span>
          </span>
        </li>
        <li className="flex items-start gap-3 rounded-xl border border-white/5 bg-[var(--color-panel)]/50 px-4 py-3">
          <span
            aria-hidden
            className="mt-[7px] size-[6px] shrink-0 rounded-full bg-[var(--color-accent)] shadow-[0_0_8px_rgba(34,197,94,0.6)]"
          />
          <span>
            <span className="font-medium text-[var(--color-ink)]">
              Agent-first.
            </span>{" "}
            <span className="text-[var(--color-muted)]">
              Claude Code, Cursor, and any MCP-aware tool can read and write to
              a brain with scoped API keys.
            </span>
          </span>
        </li>
        <li className="flex items-start gap-3 rounded-xl border border-white/5 bg-[var(--color-panel)]/50 px-4 py-3">
          <span
            aria-hidden
            className="mt-[7px] size-[6px] shrink-0 rounded-full bg-[var(--color-accent)] shadow-[0_0_8px_rgba(34,197,94,0.6)]"
          />
          <span>
            <span className="font-medium text-[var(--color-ink)]">
              Native SDKs.
            </span>{" "}
            <span className="text-[var(--color-muted)]">
              Typed clients for TypeScript, Python, and Go, generated from
              one OpenAPI spec so every language stays in sync.
            </span>
          </span>
        </li>
        <li className="flex items-start gap-3 rounded-xl border border-white/5 bg-[var(--color-panel)]/50 px-4 py-3">
          <span
            aria-hidden
            className="mt-[7px] size-[6px] shrink-0 rounded-full bg-[var(--color-accent)] shadow-[0_0_8px_rgba(34,197,94,0.6)]"
          />
          <span>
            <span className="font-medium text-[var(--color-ink)]">
              Fully open source.
            </span>{" "}
            <span className="text-[var(--color-muted)]">
              Apache 2.0. Use the hosted service at aju.sh, or self-host the
              whole stack on your own infra.
            </span>
          </span>
        </li>
      </ul>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Link
          href="/docs/getting-started"
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] px-5 py-3 font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--color-accent)] transition hover:border-[var(--color-accent)]/80 hover:text-[var(--color-ink)]"
        >
          Get started
          <span aria-hidden>-&gt;</span>
        </Link>
        <Link
          href="/docs/concepts"
          className="inline-flex items-center gap-2 px-2 py-3 font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--color-muted)] transition hover:text-[var(--color-ink)]"
        >
          Read the concepts
        </Link>
      </div>
    </article>
  );
}
