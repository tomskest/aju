"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type KbSidebarArticle = {
  sectionSlug: string;
  fileSlug: string;
  title: string;
};

export type KbSidebarSection = {
  slug: string;
  title: string;
  articles: KbSidebarArticle[];
};

export type KbSidebarTree = KbSidebarSection[];

function articleHref(a: KbSidebarArticle): string {
  return `/kb/${a.sectionSlug}/${a.fileSlug}`;
}

function isArticleActive(
  pathname: string | null,
  a: KbSidebarArticle,
): boolean {
  if (!pathname) return false;
  return pathname === articleHref(a);
}

function isKbHomeActive(pathname: string | null): boolean {
  return pathname === "/kb";
}

function flatLabel(
  tree: KbSidebarTree,
  pathname: string | null,
): string {
  if (isKbHomeActive(pathname)) return "Welcome";
  for (const section of tree) {
    for (const article of section.articles) {
      if (isArticleActive(pathname, article)) {
        return `${section.title} / ${article.title}`;
      }
    }
  }
  return "Menu";
}

export default function KbSidebar({ tree }: { tree: KbSidebarTree }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeLabel = flatLabel(tree, pathname);

  return (
    <>
      {/* Mobile dropdown trigger */}
      <div className="md:hidden border-b border-white/5 bg-[var(--color-bg)]">
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="flex w-full items-center justify-between px-6 py-4 font-mono text-[12px] text-[var(--color-ink)]"
          aria-expanded={mobileOpen}
          aria-controls="kb-mobile-nav"
        >
          <span className="flex items-center gap-2">
            <span className="text-[var(--color-faint)]">kb /</span>
            <span>{activeLabel}</span>
          </span>
          <span
            aria-hidden
            className={`text-[var(--color-muted)] transition-transform ${
              mobileOpen ? "rotate-180" : ""
            }`}
          >
            v
          </span>
        </button>
        {mobileOpen && (
          <nav
            id="kb-mobile-nav"
            className="flex flex-col gap-3 border-t border-white/5 px-4 pb-4 pt-2"
          >
            <Link
              href="/kb"
              onClick={() => setMobileOpen(false)}
              className={`rounded-md px-3 py-2 font-mono text-[12.5px] transition ${
                isKbHomeActive(pathname)
                  ? "bg-[var(--color-panel)] text-[var(--color-ink)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              }`}
            >
              Welcome
            </Link>
            {tree.map((section) => (
              <div key={section.slug} className="flex flex-col gap-1">
                <p className="px-3 pt-2 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
                  {section.title}
                </p>
                {section.articles.length === 0 ? (
                  <p className="px-3 py-1 font-mono text-[11px] text-[var(--color-faint)]">
                    (empty)
                  </p>
                ) : (
                  section.articles.map((article) => {
                    const active = isArticleActive(pathname, article);
                    return (
                      <Link
                        key={`${article.sectionSlug}/${article.fileSlug}`}
                        href={articleHref(article)}
                        onClick={() => setMobileOpen(false)}
                        className={`rounded-md px-3 py-2 font-mono text-[12.5px] transition ${
                          active
                            ? "bg-[var(--color-panel)] text-[var(--color-ink)]"
                            : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                        }`}
                      >
                        {article.title}
                      </Link>
                    );
                  })
                )}
              </div>
            ))}
          </nav>
        )}
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden md:block md:w-[260px] md:shrink-0 md:border-r md:border-white/5">
        <div className="sticky top-[57px] max-h-[calc(100vh-57px)] overflow-y-auto px-6 py-10">
          <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
            Knowledge base
          </p>
          <nav className="flex flex-col gap-6">
            <Link
              href="/kb"
              className={`group flex items-center gap-2 rounded-md px-3 py-2 text-[13px] transition ${
                isKbHomeActive(pathname)
                  ? "bg-[var(--color-panel)] text-[var(--color-ink)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              }`}
            >
              <span
                aria-hidden
                className={`size-[6px] rounded-full transition ${
                  isKbHomeActive(pathname)
                    ? "bg-[var(--color-accent)] shadow-[0_0_8px_rgba(34,197,94,0.7)]"
                    : "bg-transparent group-hover:bg-[var(--color-faint)]"
                }`}
              />
              <span>Welcome</span>
            </Link>

            {tree.length === 0 ? (
              <p className="px-3 font-mono text-[11px] text-[var(--color-faint)]">
                No sections yet.
              </p>
            ) : (
              tree.map((section) => (
                <div key={section.slug} className="flex flex-col gap-1">
                  <p className="px-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
                    {section.title}
                  </p>
                  {section.articles.length === 0 ? (
                    <p className="px-3 py-1 font-mono text-[11px] text-[var(--color-faint)]">
                      (empty)
                    </p>
                  ) : (
                    section.articles.map((article) => {
                      const active = isArticleActive(pathname, article);
                      return (
                        <Link
                          key={`${article.sectionSlug}/${article.fileSlug}`}
                          href={articleHref(article)}
                          className={`group flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] transition ${
                            active
                              ? "bg-[var(--color-panel)] text-[var(--color-ink)]"
                              : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                          }`}
                        >
                          <span
                            aria-hidden
                            className={`size-[6px] rounded-full transition ${
                              active
                                ? "bg-[var(--color-accent)] shadow-[0_0_8px_rgba(34,197,94,0.7)]"
                                : "bg-transparent group-hover:bg-[var(--color-faint)]"
                            }`}
                          />
                          <span>{article.title}</span>
                        </Link>
                      );
                    })
                  )}
                </div>
              ))
            )}
          </nav>
        </div>
      </aside>
    </>
  );
}
