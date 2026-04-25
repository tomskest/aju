import Link from "next/link";
import { notFound } from "next/navigation";
import KbProse from "@/components/kb/KbProse";
import { renderMarkdown } from "@/lib/vault";
import {
  KB_GITHUB_URL,
  readKbArticle,
  readKbTree,
  type KbTree,
} from "@/lib/vault";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ slug: string[] }>;
};

function findAdjacent(
  tree: KbTree,
  sectionSlug: string,
  fileSlug: string,
): {
  prev: { href: string; title: string } | null;
  next: { href: string; title: string } | null;
} {
  const flat: { href: string; title: string }[] = [];
  for (const section of tree) {
    for (const article of section.articles) {
      flat.push({
        href: `/kb/${article.sectionSlug}/${article.fileSlug}`,
        title: article.title,
      });
    }
  }
  const idx = flat.findIndex(
    (a) => a.href === `/kb/${sectionSlug}/${fileSlug}`,
  );
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? flat[idx - 1]! : null,
    next: idx < flat.length - 1 ? flat[idx + 1]! : null,
  };
}

export default async function KbArticlePage({ params }: PageProps) {
  const { slug } = await params;
  if (!slug || slug.length !== 2) notFound();
  const [sectionSlug, fileSlug] = slug;
  if (!sectionSlug || !fileSlug) notFound();

  const article = await readKbArticle(sectionSlug, fileSlug);
  if (!article) notFound();

  const html = renderMarkdown(article.body);
  const tree = await readKbTree();
  const section = tree.find((s) => s.slug === sectionSlug);
  const { prev, next } = findAdjacent(tree, sectionSlug, fileSlug);

  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
          {section?.title ?? sectionSlug}
        </p>
        <h1 className="text-[32px] font-light leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)]">
          {article.meta.title}
        </h1>
        {article.meta.description && (
          <p className="text-[15px] leading-relaxed text-[var(--color-muted)]">
            {article.meta.description}
          </p>
        )}
      </header>

      <KbProse html={html} />

      {/* Prev / next nav */}
      {(prev || next) && (
        <nav className="mt-4 flex flex-col gap-3 border-t border-white/5 pt-6 sm:flex-row sm:justify-between">
          <div className="min-w-0">
            {prev && (
              <Link
                href={prev.href}
                className="group inline-flex flex-col gap-1 text-left"
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
                  ← previous
                </span>
                <span className="text-[13px] text-[var(--color-muted)] group-hover:text-[var(--color-ink)]">
                  {prev.title}
                </span>
              </Link>
            )}
          </div>
          <div className="min-w-0 sm:text-right">
            {next && (
              <Link
                href={next.href}
                className="group inline-flex flex-col gap-1 sm:items-end"
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
                  next →
                </span>
                <span className="text-[13px] text-[var(--color-muted)] group-hover:text-[var(--color-ink)]">
                  {next.title}
                </span>
              </Link>
            )}
          </div>
        </nav>
      )}

      {/* Self-host footer callout */}
      <aside className="rounded-xl border border-white/5 bg-[var(--color-panel)]/40 p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
          source
        </p>
        <p className="mt-1 text-[13px] text-[var(--color-muted)]">
          This page is markdown in a public repo. Edit it, PR it, or fork the
          whole thing and self-host at{" "}
          <a
            href={KB_GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--color-accent)] underline-offset-4 hover:underline"
          >
            github.com/tomskest/aju
          </a>
          .
        </p>
      </aside>
    </article>
  );
}
