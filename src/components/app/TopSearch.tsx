"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { usePathname, useRouter } from "next/navigation";

type FtsItem = {
  path: string;
  title: string;
  section: string | null;
  brain: string | null;
  rank: number;
  snippet: string;
};

type SemItem = {
  path: string;
  title: string;
  section: string | null;
  brain: string | null;
  similarity: number | null;
};

type Result = {
  path: string;
  title: string;
  section: string | null;
  brain: string;
  snippet?: string;
  source: "fts" | "semantic";
};

const PER_LIMIT = 8;
const TOTAL_LIMIT = 12;
const DEBOUNCE_MS = 180;

function buildDocUrl(brain: string, path: string): string {
  const encodedBrain = encodeURIComponent(brain);
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `/app/brain/${encodedBrain}/${encodedPath}`;
}

function mergeResults(
  fts: FtsItem[],
  sem: SemItem[],
  fallbackBrain: string | null,
): Result[] {
  const out: Result[] = [];
  const seen = new Set<string>();

  for (const r of fts) {
    const brain = r.brain ?? fallbackBrain;
    if (!brain) continue;
    const key = `${brain}|${r.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      path: r.path,
      title: r.title,
      section: r.section,
      brain,
      snippet: r.snippet,
      source: "fts",
    });
  }
  for (const r of sem) {
    const brain = r.brain ?? fallbackBrain;
    if (!brain) continue;
    const key = `${brain}|${r.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      path: r.path,
      title: r.title,
      section: r.section,
      brain,
      source: "semantic",
    });
  }
  return out.slice(0, TOTAL_LIMIT);
}

export default function TopSearch() {
  const pathname = usePathname();
  const router = useRouter();

  const currentBrain = useMemo(() => {
    if (!pathname) return null;
    const m = pathname.match(/^\/app\/brain\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }, [pathname]);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [shortcut, setShortcut] = useState("Ctrl K");
  const [fts, setFts] = useState<FtsItem[]>([]);
  const [sem, setSem] = useState<SemItem[]>([]);
  const [ftsLoading, setFtsLoading] = useState(false);
  const [semLoading, setSemLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(
    () => mergeResults(fts, sem, currentBrain),
    [fts, sem, currentBrain],
  );

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setFts([]);
      setSem([]);
      setFtsLoading(false);
      setSemLoading(false);
      return;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        q: trimmed,
        limit: String(PER_LIMIT),
      });
      if (currentBrain) params.set("brain", currentBrain);

      setFtsLoading(true);
      setSemLoading(true);

      fetch(`/api/vault/search?${params.toString()}`, {
        signal: ctrl.signal,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          setFts(Array.isArray(data?.results) ? data.results : []);
        })
        .catch(() => {
          /* aborted or failed */
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setFtsLoading(false);
        });

      fetch(`/api/vault/semantic-search?${params.toString()}`, {
        signal: ctrl.signal,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          setSem(Array.isArray(data?.results) ? data.results : []);
        })
        .catch(() => {
          /* aborted or failed */
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setSemLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, currentBrain]);

  useEffect(() => {
    setActiveIdx(0);
  }, [results.length]);

  useEffect(() => {
    const isMac = navigator.platform.toLowerCase().includes("mac");
    setShortcut(isMac ? "⌘K" : "Ctrl K");
    const onKey = (e: globalThis.KeyboardEvent) => {
      const cmd = isMac ? e.metaKey : e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const select = useCallback(
    (r: Result) => {
      router.push(buildDocUrl(r.brain, r.path));
      setOpen(false);
      setQuery("");
    },
    [router],
  );

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const r = results[activeIdx];
      if (r) {
        e.preventDefault();
        select(r);
      }
    }
  };

  const showDropdown = open && query.trim().length >= 2;
  const loading = ftsLoading || semLoading;
  const placeholder = currentBrain
    ? `Search ${currentBrain} (${shortcut})`
    : `Search brains (${shortcut})`;

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onInputKeyDown}
        spellCheck={false}
        placeholder={placeholder}
        className="w-full rounded-md border border-white/10 bg-[var(--color-panel)]/40 px-3 py-1.5 font-mono text-[12px] text-[var(--color-ink)] placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]/40 focus:outline-none"
        aria-autocomplete="list"
        aria-expanded={showDropdown}
      />
      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-[60vh] overflow-y-auto rounded-md border border-white/10 bg-[var(--color-bg)] shadow-2xl">
          {results.length === 0 ? (
            <p className="px-3 py-3 font-mono text-[11px] text-[var(--color-faint)]">
              {loading ? "searching…" : "no results"}
            </p>
          ) : (
            <>
              {results.map((r, i) => {
                const active = i === activeIdx;
                return (
                  <button
                    key={`${r.brain}|${r.path}|${r.source}`}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      select(r);
                    }}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={`block w-full border-b border-white/[0.04] px-3 py-2 text-left transition last:border-b-0 ${
                      active ? "bg-white/[0.04]" : "hover:bg-white/[0.02]"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="truncate text-[13px] text-[var(--color-ink)]">
                        {r.title}
                      </p>
                      <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
                        {r.source === "fts" ? "exact" : "related"}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--color-faint)]">
                      {r.brain !== currentBrain && (
                        <span className="text-[var(--color-muted)]">
                          {r.brain} ·{" "}
                        </span>
                      )}
                      {r.path}
                    </p>
                    {r.snippet && (
                      <p
                        className="search-snippet mt-1 line-clamp-2 text-[12px] text-[var(--color-muted)]"
                        dangerouslySetInnerHTML={{ __html: r.snippet }}
                      />
                    )}
                  </button>
                );
              })}
              {loading && (
                <p className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
                  loading more…
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
