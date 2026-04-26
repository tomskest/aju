"use client";

import { useEffect, useState, type RefObject } from "react";

type Heading = { id: string; text: string; level: number };

type Props = {
  articleRef: RefObject<HTMLElement | null>;
  scrollRoot: RefObject<HTMLElement | null>;
  contentKey: string;
};

const COMBINING_MARKS = /[̀-ͯ]/g;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

export default function DocToc({ articleRef, scrollRoot, contentKey }: Props) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;

    let cancelled = false;
    let cleanup: (() => void) | null = null;

    const setup = () => {
      if (cancelled) return;
      const headerEl = article.querySelector(":scope > header");
      const els = Array.from(
        article.querySelectorAll<HTMLElement>("h2, h3"),
      ).filter((el) => !headerEl || !headerEl.contains(el));

      const used = new Set<string>();
      const list: Heading[] = [];
      for (const el of els) {
        let id = el.id;
        if (!id) {
          const slug = slugify(el.textContent ?? "");
          let candidate = slug || `h-${list.length}`;
          let suffix = 1;
          while (used.has(candidate)) {
            candidate = `${slug || "h"}-${suffix++}`;
          }
          id = candidate;
          el.id = id;
        }
        used.add(id);
        list.push({
          id,
          text: el.textContent?.trim() ?? "",
          level: parseInt(el.tagName.slice(1), 10),
        });
      }

      setHeadings(list);
      if (list.length === 0) {
        setActiveId(null);
        return;
      }

      const root = scrollRoot.current;
      const triggerY = 96;

      const recompute = () => {
        let active = list[0].id;
        for (const h of list) {
          const el = document.getElementById(h.id);
          if (!el) continue;
          const top = el.getBoundingClientRect().top;
          if (top - triggerY <= 0) active = h.id;
          else break;
        }
        setActiveId(active);
      };

      recompute();

      const target: HTMLElement | Window = root ?? window;
      const onScroll = () => recompute();
      target.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll);

      cleanup = () => {
        target.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
      };
    };

    const raf = requestAnimationFrame(setup);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      cleanup?.();
    };
  }, [contentKey, articleRef, scrollRoot]);

  if (headings.length < 3) return null;

  return (
    <nav aria-label="Table of contents" className="w-full">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
        On this page
      </p>
      <ul className="border-l border-white/5">
        {headings.map((h) => {
          const active = h.id === activeId;
          return (
            <li key={h.id}>
              <a
                href={`#${h.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  const target = document.getElementById(h.id);
                  if (target) {
                    target.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                    setActiveId(h.id);
                  }
                }}
                style={{ paddingLeft: `${(h.level - 2) * 12 + 12}px` }}
                className={`-ml-px block border-l py-1 pr-2 text-[12px] leading-snug transition ${
                  active
                    ? "border-[var(--color-accent)] text-[var(--color-ink)]"
                    : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                }`}
              >
                {h.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
