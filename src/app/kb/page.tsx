import Link from "next/link";
import { KB_GITHUB_URL, readKbTree } from "@/lib/vault";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function KbWelcomePage() {
  const tree = await readKbTree();
  const isEmpty =
    tree.length === 0 || tree.every((s) => s.articles.length === 0);

  return (
    <article className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
          Knowledge base
        </p>
        <h1 className="text-[34px] font-light leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)]">
          Everything we know, in the open.
        </h1>
        <p className="text-[15px] leading-relaxed text-[var(--color-muted)]">
          This is the aju knowledge base. Notes on data, auth, agents, search —
          the moving parts behind a durable memory layer for AI agents. The
          source lives in a public repo. Fork it, host it, rewrite it.
        </p>
      </header>

      {/* Self-host callout */}
      <section className="rounded-xl border border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
          self-host this
        </p>
        <h2 className="mt-2 text-[18px] font-medium text-[var(--color-ink)]">
          aju is fully open source.
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-muted)]">
          Every line of this page, every article in this knowledge base, and
          the memory engine behind it ship under Apache 2.0. Clone the repo,
          deploy on your own infra, and point your agents at it.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <a
            href={KB_GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--color-accent)] transition hover:border-[var(--color-accent)]/80 hover:text-[var(--color-ink)]"
          >
            github.com/tomskest/aju
            <span aria-hidden>-&gt;</span>
          </a>
          <Link
            href="/docs/self-host"
            className="inline-flex items-center gap-2 px-2 py-2.5 font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--color-muted)] transition hover:text-[var(--color-ink)]"
          >
            self-host guide
          </Link>
        </div>
      </section>

      {/* Section listing */}
      <section className="flex flex-col gap-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
            Sections
          </h2>
          <span className="font-mono text-[10px] text-[var(--color-faint)]">
            {tree.length} {tree.length === 1 ? "section" : "sections"}
          </span>
        </div>

        {isEmpty ? (
          <div className="rounded-xl border border-white/5 bg-[var(--color-panel)]/40 p-6 text-[14px] text-[var(--color-muted)]">
            This knowledge base is being written. Check back soon, or see the
            source on{" "}
            <a
              href={KB_GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--color-accent)] underline-offset-4 hover:underline"
            >
              GitHub
            </a>
            .
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {tree.map((section) => (
              <li
                key={section.slug}
                className="flex flex-col gap-3 rounded-xl border border-white/5 bg-[var(--color-panel)]/40 p-5"
              >
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[16px] font-medium text-[var(--color-ink)]">
                    {section.title}
                  </h3>
                  <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
                    {section.articles.length}{" "}
                    {section.articles.length === 1 ? "article" : "articles"}
                  </span>
                </div>
                {section.articles.length === 0 ? (
                  <p className="font-mono text-[12px] text-[var(--color-faint)]">
                    This section is being written. Check back soon, or see the
                    source on{" "}
                    <a
                      href={KB_GITHUB_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--color-muted)] underline-offset-4 hover:text-[var(--color-ink)] hover:underline"
                    >
                      GitHub
                    </a>
                    .
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {section.articles.map((article) => (
                      <li key={`${article.sectionSlug}/${article.fileSlug}`}>
                        <Link
                          href={`/kb/${article.sectionSlug}/${article.fileSlug}`}
                          className="group flex items-baseline justify-between gap-4 rounded-md px-2 py-1.5 transition hover:bg-white/[0.03]"
                        >
                          <span className="flex items-baseline gap-3">
                            <span
                              aria-hidden
                              className="select-none font-mono text-[11px] text-[var(--color-faint)] group-hover:text-[var(--color-muted)]"
                            >
                              ·
                            </span>
                            <span className="text-[14px] text-[var(--color-ink)]">
                              {article.title}
                            </span>
                          </span>
                          {article.description && (
                            <span className="hidden max-w-[360px] truncate font-mono text-[11px] text-[var(--color-faint)] md:inline">
                              {article.description}
                            </span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
