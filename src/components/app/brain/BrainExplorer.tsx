"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

type DocSummary = {
  id: string;
  path: string;
  title: string;
};

type DocFull = DocSummary & {
  content: string;
  rendered: string;
  updatedAt: string;
  wordCount: number;
};

type Props = {
  brainName: string;
  brainType: string;
  brainNames: string[];
  canWrite: boolean;
  docs: DocSummary[];
  currentDoc: DocFull | null;
  currentPath: string | null;
  missingHint: string | null;
};

/**
 * In-browser explorer for a single brain. Sidebar lists every doc grouped
 * by directory; main pane renders the currently-focused doc and toggles
 * into an editable textarea on demand. New-doc dialog posts to
 * `/api/vault/create` and navigates to the result; edits POST to
 * `/api/vault/update` and refresh the page so the rendered markdown
 * reflects the new content (including any auto-link insertions).
 *
 * Kept intentionally simple — single client component, no per-doc local
 * caching, no draft persistence. Every save round-trips through the API
 * so the server-side auto-link / rebuild-links / embedding pipeline runs.
 */
export default function BrainExplorer({
  brainName,
  brainType,
  brainNames,
  canWrite,
  docs,
  currentDoc,
  currentPath,
  missingHint,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [editorContent, setEditorContent] = useState(currentDoc?.content ?? "");
  const [creating, setCreating] = useState<{
    path: string;
    seed: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Group docs by directory for a tidy tree-ish sidebar.
  const grouped = useMemo(() => groupByDirectory(docs), [docs]);

  const dirty =
    editing && currentDoc !== null && editorContent !== currentDoc.content;

  const handleSave = async () => {
    if (!currentDoc) return;
    setError(null);
    const res = await fetch(
      `/api/vault/update?brain=${encodeURIComponent(brainName)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: currentDoc.path,
          content: editorContent,
          source: "web",
        }),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "save_failed");
      return;
    }
    setEditing(false);
    startTransition(() => router.refresh());
  };

  const handleCreate = async () => {
    if (!creating) return;
    setError(null);
    const path = creating.path.trim();
    if (!path || !path.endsWith(".md")) {
      setError("Path must end in .md");
      return;
    }
    const seedTitle = path.split("/").pop()?.replace(/\.md$/, "") || "Untitled";
    const seedBody = creating.seed
      ? creating.seed
      : `# ${seedTitle}\n\n`;
    const res = await fetch(
      `/api/vault/create?brain=${encodeURIComponent(brainName)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, content: seedBody, source: "web" }),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "create_failed");
      return;
    }
    setCreating(null);
    router.push(
      `/app/brain/${encodeURIComponent(brainName)}/${path
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
    );
  };

  const handleDelete = async () => {
    if (!currentDoc) return;
    if (!confirm(`Delete ${currentDoc.path}?`)) return;
    setError(null);
    const res = await fetch(
      `/api/vault/delete?brain=${encodeURIComponent(brainName)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: currentDoc.path, source: "web" }),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "delete_failed");
      return;
    }
    router.push(`/app/brain/${encodeURIComponent(brainName)}`);
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-0">
      {/* Sidebar */}
      <aside className="w-72 shrink-0 overflow-y-auto border-r border-[var(--color-line)] bg-[var(--color-shell)] px-3 py-4 text-sm">
        <div className="mb-3 flex items-center justify-between">
          <BrainSwitcher current={brainName} brains={brainNames} />
          {canWrite && (
            <button
              type="button"
              onClick={() =>
                setCreating({
                  path: missingHint
                    ? `${slugifyPath(missingHint)}.md`
                    : "untitled.md",
                  seed: "",
                })
              }
              title="New document"
              className="rounded border border-[var(--color-line)] px-2 py-0.5 text-xs hover:bg-[var(--color-tint)]"
            >
              + New
            </button>
          )}
        </div>

        <div className="mb-2 text-xs uppercase tracking-wider text-[var(--color-faint)]">
          {docs.length} document{docs.length === 1 ? "" : "s"} · {brainType}
        </div>

        {grouped.length === 0 && (
          <p className="mt-4 text-xs text-[var(--color-faint)]">
            No documents yet.
            {canWrite && " Click + New to start."}
          </p>
        )}

        <nav className="space-y-3">
          {grouped.map(({ dir, items }) => (
            <div key={dir}>
              {dir !== "" && (
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--color-faint)]">
                  {dir}
                </div>
              )}
              <ul className="space-y-0.5">
                {items.map((d) => {
                  const active = d.path === currentPath;
                  return (
                    <li key={d.id}>
                      <Link
                        href={`/app/brain/${encodeURIComponent(brainName)}/${d.path
                          .split("/")
                          .map(encodeURIComponent)
                          .join("/")}`}
                        className={`block truncate rounded px-2 py-1 text-sm leading-tight hover:bg-[var(--color-tint)] ${
                          active ? "bg-[var(--color-tint)] font-medium" : ""
                        }`}
                        title={d.path}
                      >
                        {d.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      {/* Main pane */}
      <main className="flex-1 overflow-y-auto bg-[var(--color-paper)]">
        {currentDoc ? (
          <div className="mx-auto max-w-[820px] px-8 py-6">
            <div className="mb-4 flex items-center justify-between gap-4 border-b border-[var(--color-line)] pb-3">
              <div className="min-w-0">
                <div className="truncate font-mono text-xs text-[var(--color-faint)]">
                  {currentDoc.path}
                </div>
                <div className="text-xs text-[var(--color-faint)]">
                  {currentDoc.wordCount} words · updated{" "}
                  {new Date(currentDoc.updatedAt).toLocaleString()}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                {canWrite && !editing && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(true);
                      setEditorContent(currentDoc.content);
                    }}
                    className="rounded border border-[var(--color-line)] px-3 py-1 text-sm hover:bg-[var(--color-tint)]"
                  >
                    Edit
                  </button>
                )}
                {canWrite && editing && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(false);
                        setEditorContent(currentDoc.content);
                      }}
                      className="rounded border border-[var(--color-line)] px-3 py-1 text-sm hover:bg-[var(--color-tint)]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={!dirty || isPending}
                      className="rounded bg-[var(--color-ink)] px-3 py-1 text-sm text-[var(--color-paper)] disabled:opacity-50"
                    >
                      {dirty ? "Save" : "Saved"}
                    </button>
                  </>
                )}
                {canWrite && !editing && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="rounded border border-[var(--color-line)] px-2 py-1 text-sm text-red-600 hover:bg-red-50"
                    title="Delete document"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>

            {error && (
              <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            {editing ? (
              <textarea
                value={editorContent}
                onChange={(e) => setEditorContent(e.target.value)}
                spellCheck={false}
                className="min-h-[60vh] w-full resize-y rounded border border-[var(--color-line)] bg-[var(--color-paper)] p-3 font-mono text-sm leading-relaxed focus:border-[var(--color-ink)] focus:outline-none"
              />
            ) : (
              <article
                className="prose prose-sm max-w-none [&_a.wikilink-missing]:text-red-600 [&_a.wikilink]:underline [&_a.wikilink]:decoration-dotted"
                dangerouslySetInnerHTML={{ __html: currentDoc.rendered }}
              />
            )}
          </div>
        ) : missingHint ? (
          <div className="mx-auto max-w-[640px] px-8 py-12 text-center">
            <h1 className="mb-3 text-xl font-semibold">Document not found</h1>
            <p className="mb-4 text-sm text-[var(--color-faint)]">
              No document exists at the path linked from another doc:
            </p>
            <code className="mb-4 block rounded bg-[var(--color-tint)] px-3 py-2 font-mono text-sm">
              {missingHint}
            </code>
            {canWrite && (
              <button
                type="button"
                onClick={() =>
                  setCreating({
                    path: `${slugifyPath(missingHint)}.md`,
                    seed: `# ${missingHint}\n\n`,
                  })
                }
                className="rounded bg-[var(--color-ink)] px-4 py-2 text-sm text-[var(--color-paper)]"
              >
                Create this document
              </button>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-[640px] px-8 py-12 text-center">
            <h1 className="mb-3 text-xl font-semibold">{brainName}</h1>
            <p className="text-sm text-[var(--color-faint)]">
              {docs.length === 0
                ? "This brain is empty."
                : "Pick a document from the sidebar."}
            </p>
            {canWrite && docs.length === 0 && (
              <button
                type="button"
                onClick={() =>
                  setCreating({ path: "untitled.md", seed: "" })
                }
                className="mt-4 rounded bg-[var(--color-ink)] px-4 py-2 text-sm text-[var(--color-paper)]"
              >
                Create first document
              </button>
            )}
          </div>
        )}
      </main>

      {/* Create dialog */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
            <h2 className="mb-3 text-lg font-semibold">New document</h2>
            <label className="mb-1 block text-xs uppercase tracking-wider text-[var(--color-faint)]">
              Path (must end in .md)
            </label>
            <input
              type="text"
              value={creating.path}
              onChange={(e) =>
                setCreating({ ...creating, path: e.target.value })
              }
              autoFocus
              className="mb-3 w-full rounded border border-[var(--color-line)] bg-[var(--color-paper)] px-2 py-1 font-mono text-sm focus:border-[var(--color-ink)] focus:outline-none"
              placeholder="topics/my-note.md"
            />
            {error && (
              <div className="mb-3 text-sm text-red-700">{error}</div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCreating(null);
                  setError(null);
                }}
                className="rounded border border-[var(--color-line)] px-3 py-1 text-sm hover:bg-[var(--color-tint)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                className="rounded bg-[var(--color-ink)] px-3 py-1 text-sm text-[var(--color-paper)]"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact dropdown to switch the active brain in the same explorer URL.
 */
function BrainSwitcher({
  current,
  brains,
}: {
  current: string;
  brains: string[];
}) {
  const router = useRouter();
  return (
    <select
      value={current}
      onChange={(e) =>
        router.push(`/app/brain/${encodeURIComponent(e.target.value)}`)
      }
      className="max-w-[180px] truncate rounded border border-[var(--color-line)] bg-[var(--color-paper)] px-2 py-1 font-mono text-xs"
    >
      {brains.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}

function groupByDirectory(
  docs: DocSummary[],
): Array<{ dir: string; items: DocSummary[] }> {
  const map = new Map<string, DocSummary[]>();
  for (const d of docs) {
    const idx = d.path.lastIndexOf("/");
    const dir = idx === -1 ? "" : d.path.slice(0, idx);
    const arr = map.get(dir) ?? [];
    arr.push(d);
    map.set(dir, arr);
  }
  // Sort: empty dir first, then alpha.
  const dirs = [...map.keys()].sort((a, b) => {
    if (a === "") return -1;
    if (b === "") return 1;
    return a.localeCompare(b);
  });
  return dirs.map((dir) => ({ dir, items: map.get(dir)! }));
}

function slugifyPath(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9/.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
