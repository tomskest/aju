import Link from "next/link";
import type { Metadata } from "next";
import KbSidebar, {
  type KbSidebarTree,
} from "@/components/kb/KbSidebar";
import { KB_GITHUB_URL, readKbTree } from "@/lib/vault";

export const metadata: Metadata = {
  title: "Knowledge base — aju",
  description:
    "Open, self-hostable knowledge base for aju — memory infrastructure for AI agents.",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function KbLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tree = await readKbTree();
  const sidebarTree: KbSidebarTree = tree.map((section) => ({
    slug: section.slug,
    title: section.title,
    articles: section.articles.map((a) => ({
      sectionSlug: a.sectionSlug,
      fileSlug: a.fileSlug,
      title: a.title,
    })),
  }));

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-ink)]">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-[var(--color-bg)]/90 backdrop-blur">
        <div className="flex items-center justify-between px-6 py-3">
          <Link
            href="/"
            className="inline-flex items-baseline gap-2 text-[18px] font-light tracking-[-0.03em] text-[var(--color-ink)] transition hover:text-[var(--color-ink)]"
          >
            <span>aju</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
              kb
            </span>
          </Link>
          <div className="hidden items-center gap-5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted)] md:flex">
            <Link
              href="/"
              className="transition hover:text-[var(--color-ink)]"
            >
              home
            </Link>
            <Link
              href="/docs"
              className="transition hover:text-[var(--color-ink)]"
            >
              docs
            </Link>
            <a
              href={KB_GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-[var(--color-ink)]"
            >
              github
            </a>
          </div>
        </div>
      </header>

      <div className="flex flex-col md:flex-row">
        <KbSidebar tree={sidebarTree} />

        <main className="min-w-0 flex-1 px-6 py-10 md:px-10 md:py-14">
          <div className="max-w-[720px]">{children}</div>
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/5 px-6 py-6">
        <div className="flex items-center justify-center gap-4 font-mono text-[11px] text-[var(--color-faint)]">
          <span>aju.sh © {new Date().getFullYear()}</span>
          <span>·</span>
          <a
            href={KB_GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="transition hover:text-[var(--color-muted)]"
          >
            github
          </a>
          <span>·</span>
          <Link
            href="/legal/terms"
            className="transition hover:text-[var(--color-muted)]"
          >
            terms
          </Link>
          <span>·</span>
          <Link
            href="/legal/privacy"
            className="transition hover:text-[var(--color-muted)]"
          >
            privacy
          </Link>
        </div>
      </footer>
    </div>
  );
}
