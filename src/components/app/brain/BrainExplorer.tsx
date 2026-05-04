"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import KbProse from "@/components/kb/KbProse";
import DocToc from "@/components/kb/DocToc";
import LocalDate from "@/components/kb/LocalDate";
import ValidationPicker from "./ValidationPicker";
import ValidationBar from "./ValidationBar";
import type { ValidationState } from "./ValidationBadge";

type DocSummary = {
  id: string;
  path: string;
  title: string;
};

type DocFull = DocSummary & {
  content: string;
  contentHash: string;
  rendered: string;
  updatedAt: string;
  wordCount: number;
  validation: {
    status: string;
    provenance: string;
    validatedAt: string | null;
    validatedBy: string | null;
  };
};

type VersionMeta = {
  id: string;
  versionN: number;
  contentHash: string;
  parentHash: string | null;
  mergeParentHash: string | null;
  source: string;
  changedBy: string | null;
  message: string | null;
  createdAt: string;
};

type VersionDetail = VersionMeta & { content: string };

type Props = {
  brainName: string;
  brainType: string;
  canWrite: boolean;
  canValidate: boolean;
  docs: DocSummary[];
  currentDoc: DocFull | null;
  currentPath: string | null;
  missingHint: string | null;
};

type FolderNode = {
  type: "folder";
  name: string;
  path: string;
  children: TreeNode[];
};
type DocNode = {
  type: "doc";
  name: string;
  path: string;
  doc: DocSummary;
};
type TreeNode = FolderNode | DocNode;

type CreateMode = "doc" | "folder";

/**
 * In-browser explorer for a single brain. Sidebar renders a recursive
 * folder tree inferred from doc paths; main pane shows the focused doc
 * and toggles into an edit textarea on demand.
 *
 * Styled to match the public KB chrome — dark theme, mono labels,
 * accent-green active dots — so brain editing feels like a lightweight
 * cloud wiki rather than a generic CRUD app.
 */
export default function BrainExplorer({
  brainName,
  brainType,
  canWrite,
  canValidate,
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
    mode: CreateMode;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(() =>
    initialOpenFolders(docs, currentPath),
  );

  // History panel — shows the version DAG for the focused doc and lets the
  // user preview/restore any past commit. Versions are loaded lazily on
  // first open and refreshed after each restore so the list stays current.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<VersionMeta[] | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<VersionDetail | null>(
    null,
  );
  const [versionDetailLoading, setVersionDetailLoading] = useState(false);

  // Validation state. Server-rendered initial value comes through
  // currentDoc.validation; ValidationPicker calls onChanged after a
  // successful POST so the badge updates without a full router.refresh().
  // We still refresh after a state change to keep the breakdown bar (which
  // ships in Phase 4) in sync once it lands.
  const [validation, setValidation] = useState<ValidationState | null>(
    currentDoc?.validation
      ? {
          status: (currentDoc.validation.status as ValidationState["status"]) ?? "unvalidated",
          provenance: currentDoc.validation.provenance,
          validatedAt: currentDoc.validation.validatedAt,
          validatedBy: currentDoc.validation.validatedBy,
        }
      : null,
  );

  // Re-sync validation state whenever the focused doc changes (sidebar
  // navigation between docs without a full reload).
  useEffect(() => {
    setValidation(
      currentDoc?.validation
        ? {
            status: (currentDoc.validation.status as ValidationState["status"]) ?? "unvalidated",
            provenance: currentDoc.validation.provenance,
            validatedAt: currentDoc.validation.validatedAt,
            validatedBy: currentDoc.validation.validatedBy,
          }
        : null,
    );
  }, [currentDoc?.id, currentDoc?.validation]);

  const mainRef = useRef<HTMLElement | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);

  const tree = useMemo(() => buildTree(docs), [docs]);

  const dirty =
    editing && currentDoc !== null && editorContent !== currentDoc.content;

  const toggleFolder = (path: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const openCreateDoc = (folder?: string) => {
    const prefix = folder ? `${folder}/` : "";
    setCreating({
      path: missingHint
        ? `${slugifyPath(missingHint)}.md`
        : `${prefix}untitled.md`,
      seed: missingHint ? `# ${missingHint}\n\n` : "",
      mode: "doc",
    });
  };

  const openCreateFolder = () => {
    setCreating({
      path: "new-folder/README.md",
      seed: "",
      mode: "folder",
    });
  };

  const handleSave = async () => {
    if (!currentDoc) return;
    setError(null);
    // CAS: send the head we read alongside its content. The server fast-paths
    // when the hash still matches, attempts a three-way merge on a stale
    // base, and returns 409 only when the merge has unresolved conflicts.
    const res = await fetch(
      `/api/vault/update?brain=${encodeURIComponent(brainName)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: currentDoc.path,
          content: editorContent,
          source: "web",
          baseHash: currentDoc.contentHash,
          baseContent: currentDoc.content,
        }),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // Either a stale-base CAS reject or an unresolved merge conflict.
        // Surface a focused message and refresh so the editor reloads with
        // the current head — the user can re-apply their intent on top.
        setError(
          body.error === "merge_conflict"
            ? "Merge conflict — someone else edited the same lines. Reload and reapply your changes."
            : "Document changed since you opened it. Reload to see the latest version.",
        );
        return;
      }
      setError(body.error || "save_failed");
      return;
    }
    setEditing(false);
    startTransition(() => router.refresh());
  };

  // ── History / versions ──────────────────────────────────────
  const fetchVersions = async () => {
    if (!currentDoc) return;
    setVersionsLoading(true);
    try {
      const params = new URLSearchParams({
        brain: brainName,
        path: currentDoc.path,
        limit: "100",
      });
      const res = await fetch(`/api/vault/document/versions?${params}`);
      if (!res.ok) {
        setError("Failed to load history");
        return;
      }
      const body = (await res.json()) as { versions: VersionMeta[] };
      setVersions(body.versions);
    } finally {
      setVersionsLoading(false);
    }
  };

  const openHistory = () => {
    setHistoryOpen(true);
    setSelectedVersion(null);
    if (versions === null) void fetchVersions();
  };

  const closeHistory = () => {
    setHistoryOpen(false);
    setSelectedVersion(null);
  };

  const selectVersion = async (v: VersionMeta) => {
    if (!currentDoc) return;
    setVersionDetailLoading(true);
    setSelectedVersion(null);
    try {
      const params = new URLSearchParams({
        brain: brainName,
        path: currentDoc.path,
        n: String(v.versionN),
      });
      const res = await fetch(`/api/vault/document/version?${params}`);
      if (!res.ok) {
        setError("Failed to load version content");
        return;
      }
      const body = (await res.json()) as VersionDetail;
      setSelectedVersion(body);
    } finally {
      setVersionDetailLoading(false);
    }
  };

  const restoreVersion = async (v: VersionDetail) => {
    if (!currentDoc) return;
    if (
      !confirm(
        `Restore ${currentDoc.path} to version v${v.versionN} (${v.contentHash.slice(0, 10)}…)?\n\nThis writes a new version on top — the current head stays in history.`,
      )
    ) {
      return;
    }
    setError(null);
    // Restore = a CAS update against the current head, with the
    // historical content as the new body. The diff is the rollback.
    const res = await fetch(
      `/api/vault/update?brain=${encodeURIComponent(brainName)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: currentDoc.path,
          content: v.content,
          source: "web",
          baseHash: currentDoc.contentHash,
          baseContent: currentDoc.content,
        }),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(
        res.status === 409
          ? "Document changed while you were viewing history. Reload and try again."
          : body.error || "restore_failed",
      );
      return;
    }
    // Refresh: server-side props re-fetch will pick up the new head,
    // and we drop the history overlay so the user sees the restored doc.
    closeHistory();
    setVersions(null);
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
    const seedTitle =
      path.split("/").pop()?.replace(/\.md$/, "") || "Untitled";
    const folderTitle = path.split("/").slice(-2, -1)[0] || seedTitle;
    const seedBody = creating.seed
      ? creating.seed
      : creating.mode === "folder"
        ? `# ${humanize(folderTitle)}\n\nLanding doc for the \`${folderTitle}\` folder.\n`
        : `# ${humanize(seedTitle)}\n\n`;
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
    <div className="flex h-[calc(100vh-56px)]">
      {/* Sidebar */}
      <aside className="hidden w-[260px] shrink-0 flex-col overflow-hidden border-r border-white/5 bg-[var(--color-bg)] md:flex">
        <div className="border-b border-white/5 px-5 py-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-ink)]">
            {brainName}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
            {brainType} · {docs.length} doc{docs.length === 1 ? "" : "s"}
          </p>
          {canWrite && (
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => openCreateDoc()}
                className="flex-1 rounded-md border border-white/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
              >
                + doc
              </button>
              <button
                type="button"
                onClick={openCreateFolder}
                className="flex-1 rounded-md border border-white/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
              >
                + folder
              </button>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-4">
          {tree.length === 0 ? (
            <p className="px-3 font-mono text-[11px] text-[var(--color-faint)]">
              empty brain
              {canWrite && " — click + doc to start"}
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {tree.map((node) => (
                <TreeRow
                  key={node.path}
                  node={node}
                  depth={0}
                  brainName={brainName}
                  currentPath={currentPath}
                  openFolders={openFolders}
                  canWrite={canWrite}
                  onToggleFolder={toggleFolder}
                  onAddInFolder={openCreateDoc}
                />
              ))}
            </div>
          )}
        </nav>
      </aside>

      {/* Main pane */}
      <main
        ref={mainRef}
        className="flex-1 overflow-y-auto bg-[var(--color-bg)]"
      >
        {currentDoc ? (
          <div className="mx-auto flex max-w-[1400px] gap-10 px-6 md:px-12">
          <article
            ref={articleRef}
            className="mx-auto min-w-0 max-w-[960px] flex-1 py-10"
          >
            <header className="mb-8 border-b border-white/5 pb-6">
              <div className="mb-3">
                <ValidationBar
                  brainName={brainName}
                  refreshKey={`${currentDoc.id}:${validation?.status ?? "x"}`}
                />
              </div>
              <p className="font-mono text-[11px] text-[var(--color-faint)]">
                {currentDoc.path}
              </p>
              <div className="mt-3 flex items-baseline justify-between gap-4">
                <h1 className="text-[32px] font-light leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
                  {currentDoc.title}
                </h1>
                <p className="shrink-0 font-mono text-[11px] text-[var(--color-faint)]">
                  {currentDoc.wordCount} words ·{" "}
                  <LocalDate value={currentDoc.updatedAt} />
                </p>
              </div>
              {canWrite && (
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  {!editing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(true);
                          setEditorContent(currentDoc.content);
                        }}
                        className="rounded-md border border-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
                      >
                        edit
                      </button>
                      <button
                        type="button"
                        onClick={historyOpen ? closeHistory : openHistory}
                        className={`rounded-md border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition ${
                          historyOpen
                            ? "border-[var(--color-accent)]/40 text-[var(--color-accent)]"
                            : "border-white/10 text-[var(--color-muted)] hover:border-white/20 hover:text-[var(--color-ink)]"
                        }`}
                      >
                        history
                      </button>
                      <button
                        type="button"
                        onClick={handleDelete}
                        className="rounded-md border border-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-red-500/40 hover:text-red-400"
                      >
                        delete
                      </button>
                      <ValidationPicker
                        brainName={brainName}
                        docPath={currentDoc.path}
                        state={validation}
                        canEdit={canValidate}
                        onChanged={(next) => {
                          setValidation(next);
                          // Refresh so search-result rankings, count
                          // breakdowns, and the (Phase 4) bar pick up the
                          // new state. The picker handles its own UI;
                          // refresh is for everything else on the page.
                          startTransition(() => router.refresh());
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(false);
                          setEditorContent(currentDoc.content);
                          setError(null);
                        }}
                        className="rounded-md border border-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
                      >
                        cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={!dirty || isPending}
                        className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-bg)] transition hover:brightness-110 disabled:opacity-40"
                      >
                        {isPending ? "saving" : dirty ? "save" : "saved"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </header>

            {error && (
              <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 font-mono text-[11px] text-red-400">
                {error}
              </div>
            )}

            {editing ? (
              <textarea
                value={editorContent}
                onChange={(e) => setEditorContent(e.target.value)}
                spellCheck={false}
                className="min-h-[60vh] w-full resize-y rounded-md border border-white/10 bg-[var(--color-panel)] p-4 font-mono text-[13px] leading-relaxed text-[var(--color-ink)] focus:border-[var(--color-accent)]/40 focus:outline-none"
              />
            ) : selectedVersion ? (
              <VersionPreview
                version={selectedVersion}
                isHead={selectedVersion.contentHash === currentDoc.contentHash}
                canRestore={canWrite}
                onClose={() => setSelectedVersion(null)}
                onRestore={() => restoreVersion(selectedVersion)}
              />
            ) : (
              <KbProse html={currentDoc.rendered} />
            )}
          </article>
            {!editing && (
              <aside className="sticky top-10 hidden h-[calc(100vh-7rem)] w-72 shrink-0 self-start overflow-y-auto py-10 xl:block">
                {historyOpen ? (
                  <HistoryPanel
                    versions={versions}
                    loading={versionsLoading}
                    headHash={currentDoc.contentHash}
                    selectedHash={selectedVersion?.contentHash ?? null}
                    detailLoading={versionDetailLoading}
                    onSelect={selectVersion}
                    onClose={closeHistory}
                  />
                ) : (
                  <DocToc
                    articleRef={articleRef}
                    scrollRoot={mainRef}
                    contentKey={`${currentDoc.path}|${currentDoc.updatedAt}`}
                  />
                )}
              </aside>
            )}
          </div>
        ) : missingHint ? (
          <div className="mx-auto max-w-[640px] px-6 py-20 md:px-10">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
              not found
            </p>
            <h1 className="mt-3 text-[28px] font-light tracking-[-0.02em] text-[var(--color-ink)]">
              No document at this path
            </h1>
            <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-muted)]">
              Another doc links to{" "}
              <code className="rounded bg-[var(--color-panel)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--color-ink)]">
                {missingHint}
              </code>{" "}
              but it doesn&rsquo;t exist yet.
            </p>
            {canWrite && (
              <button
                type="button"
                onClick={() =>
                  setCreating({
                    path: `${slugifyPath(missingHint)}.md`,
                    seed: `# ${missingHint}\n\n`,
                    mode: "doc",
                  })
                }
                className="mt-6 inline-flex rounded-md bg-[var(--color-accent)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-bg)] transition hover:brightness-110"
              >
                create this doc
              </button>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-[640px] px-6 py-20 md:px-10">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
              {brainType} brain
            </p>
            <h1 className="mt-3 text-[40px] font-light tracking-[-0.03em] text-[var(--color-ink)]">
              {brainName}
            </h1>
            <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-muted)]">
              {docs.length === 0
                ? "Empty for now."
                : "Pick a document from the tree to read or edit."}
              {canWrite &&
                docs.length === 0 &&
                " Click + doc in the sidebar to create the first one."}
            </p>
            {canWrite && docs.length === 0 && (
              <button
                type="button"
                onClick={() => openCreateDoc()}
                className="mt-6 inline-flex rounded-md bg-[var(--color-accent)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-bg)] transition hover:brightness-110"
              >
                + new doc
              </button>
            )}
          </div>
        )}
      </main>

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-white/10 bg-[var(--color-panel)] p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
              {creating.mode === "folder" ? "new folder" : "new doc"}
            </p>
            <h2 className="mt-2 text-[20px] font-light tracking-[-0.02em] text-[var(--color-ink)]">
              {creating.mode === "folder"
                ? "Create a folder"
                : "Create a document"}
            </h2>
            <p className="mt-2 font-mono text-[11px] leading-relaxed text-[var(--color-faint)]">
              {creating.mode === "folder"
                ? "Folders are virtual — pick a path; we'll seed it with a README."
                : "Path must end in .md. Use slashes for folders."}
            </p>
            <input
              type="text"
              value={creating.path}
              onChange={(e) =>
                setCreating({ ...creating, path: e.target.value })
              }
              autoFocus
              spellCheck={false}
              className="mt-4 w-full rounded-md border border-white/10 bg-[var(--color-bg)] px-3 py-2 font-mono text-[13px] text-[var(--color-ink)] focus:border-[var(--color-accent)]/40 focus:outline-none"
              placeholder={
                creating.mode === "folder"
                  ? "folder-name/README.md"
                  : "topics/my-note.md"
              }
            />
            {error && (
              <p className="mt-3 font-mono text-[11px] text-red-400">{error}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCreating(null);
                  setError(null);
                }}
                className="rounded-md border border-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
              >
                cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-bg)] transition hover:brightness-110"
              >
                create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  brainName,
  currentPath,
  openFolders,
  canWrite,
  onToggleFolder,
  onAddInFolder,
}: {
  node: TreeNode;
  depth: number;
  brainName: string;
  currentPath: string | null;
  openFolders: Set<string>;
  canWrite: boolean;
  onToggleFolder: (path: string) => void;
  onAddInFolder: (folder: string) => void;
}) {
  const indent = depth * 12;
  if (node.type === "doc") {
    const active = node.path === currentPath;
    return (
      <Link
        href={`/app/brain/${encodeURIComponent(brainName)}/${node.path
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`}
        title={node.path}
        className={`group flex items-center gap-2 rounded-md py-1 pr-3 text-[13px] transition ${
          active
            ? "bg-[var(--color-panel)] text-[var(--color-ink)]"
            : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        }`}
        style={{ paddingLeft: 12 + indent }}
      >
        <span
          aria-hidden
          className={`size-[6px] shrink-0 rounded-full transition ${
            active
              ? "bg-[var(--color-accent)] shadow-[0_0_8px_rgba(34,197,94,0.7)]"
              : "bg-transparent group-hover:bg-[var(--color-faint)]"
          }`}
        />
        <span className="truncate">{node.doc.title}</span>
      </Link>
    );
  }

  const open = openFolders.has(node.path);
  const docCount = countDocs(node);
  return (
    <div className="flex flex-col">
      <div
        className="group flex items-center gap-1.5 rounded-md py-1 pr-2 transition hover:bg-white/[0.03]"
        style={{ paddingLeft: 8 + indent }}
      >
        <button
          type="button"
          onClick={() => onToggleFolder(node.path)}
          className="flex flex-1 items-center gap-1.5 truncate text-left font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-faint)] transition group-hover:text-[var(--color-ink)]"
        >
          <span
            aria-hidden
            className={`inline-block w-2 text-[8px] transition-transform ${
              open ? "rotate-90" : ""
            }`}
          >
            ▶
          </span>
          <span className="truncate">{node.name}</span>
          <span className="ml-1 text-[var(--color-faint)]/70">{docCount}</span>
        </button>
        {canWrite && (
          <button
            type="button"
            onClick={() => onAddInFolder(node.path)}
            title={`New doc in ${node.path}/`}
            className="opacity-0 transition-opacity text-[var(--color-faint)] group-hover:opacity-100 hover:text-[var(--color-ink)]"
          >
            <span className="font-mono text-[12px] leading-none">+</span>
          </button>
        )}
      </div>
      {open &&
        node.children.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            brainName={brainName}
            currentPath={currentPath}
            openFolders={openFolders}
            canWrite={canWrite}
            onToggleFolder={onToggleFolder}
            onAddInFolder={onAddInFolder}
          />
        ))}
    </div>
  );
}

function buildTree(docs: DocSummary[]): TreeNode[] {
  const root: TreeNode[] = [];

  function findOrCreateFolder(
    parent: TreeNode[],
    name: string,
    path: string,
  ): FolderNode {
    let folder = parent.find(
      (n): n is FolderNode => n.type === "folder" && n.name === name,
    );
    if (!folder) {
      folder = { type: "folder", name, path, children: [] };
      parent.push(folder);
    }
    return folder;
  }

  for (const doc of docs) {
    const parts = doc.path.split("/");
    if (parts.length === 1) {
      root.push({ type: "doc", name: parts[0], path: doc.path, doc });
      continue;
    }
    let level = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const segPath = parts.slice(0, i + 1).join("/");
      const folder = findOrCreateFolder(level, parts[i], segPath);
      level = folder.children;
    }
    level.push({
      type: "doc",
      name: parts[parts.length - 1],
      path: doc.path,
      doc,
    });
  }

  function sortRecursive(level: TreeNode[]) {
    level.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of level) {
      if (n.type === "folder") sortRecursive(n.children);
    }
  }
  sortRecursive(root);

  return root;
}

function initialOpenFolders(
  _docs: DocSummary[],
  currentPath: string | null,
): Set<string> {
  const open = new Set<string>();
  if (currentPath) {
    const parts = currentPath.split("/");
    for (let i = 1; i < parts.length; i++) {
      open.add(parts.slice(0, i).join("/"));
    }
  }
  return open;
}

function countDocs(node: FolderNode): number {
  let count = 0;
  for (const c of node.children) {
    if (c.type === "doc") count++;
    else count += countDocs(c);
  }
  return count;
}

function slugifyPath(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9/.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function humanize(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\.md$/, "")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

// ── History panel ──────────────────────────────────────────
function HistoryPanel({
  versions,
  loading,
  headHash,
  selectedHash,
  detailLoading,
  onSelect,
  onClose,
}: {
  versions: VersionMeta[] | null;
  loading: boolean;
  headHash: string;
  selectedHash: string | null;
  detailLoading: boolean;
  onSelect: (v: VersionMeta) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 px-2">
      <div className="flex items-center justify-between border-b border-white/5 pb-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
          history
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="close history"
          className="font-mono text-[11px] text-[var(--color-faint)] transition hover:text-[var(--color-ink)]"
        >
          ×
        </button>
      </div>
      {loading && (
        <p className="font-mono text-[11px] text-[var(--color-faint)]">
          loading…
        </p>
      )}
      {!loading && versions !== null && versions.length === 0 && (
        <p className="font-mono text-[11px] text-[var(--color-faint)]">
          no versions recorded
        </p>
      )}
      {!loading && versions !== null && versions.length > 0 && (
        <ol className="flex flex-col gap-1.5">
          {versions.map((v) => {
            const isHead = v.contentHash === headHash;
            const isSelected = v.contentHash === selectedHash;
            return (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => onSelect(v)}
                  disabled={detailLoading}
                  className={`flex w-full flex-col gap-0.5 rounded-md border px-2.5 py-2 text-left transition ${
                    isSelected
                      ? "border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5"
                      : "border-white/5 hover:border-white/15"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-[var(--color-ink)]">
                      v{v.versionN}
                    </span>
                    {isHead && (
                      <span className="rounded-sm bg-[var(--color-accent)]/15 px-1 py-px font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                        head
                      </span>
                    )}
                    {v.mergeParentHash && (
                      <span
                        title="three-way merge commit"
                        className="rounded-sm bg-blue-400/15 px-1 py-px font-mono text-[9px] uppercase tracking-[0.18em] text-blue-300"
                      >
                        merge
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-[10px] text-[var(--color-faint)]">
                    {v.contentHash.slice(0, 10)}…
                  </p>
                  <p className="font-mono text-[10px] text-[var(--color-muted)]">
                    <LocalDate value={v.createdAt} format="datetime" />
                  </p>
                  <p className="font-mono text-[10px] text-[var(--color-faint)]">
                    {v.source}
                    {v.changedBy ? ` · ${v.changedBy}` : ""}
                  </p>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ── Version preview ────────────────────────────────────────
function VersionPreview({
  version,
  isHead,
  canRestore,
  onClose,
  onRestore,
}: {
  version: VersionDetail;
  isHead: boolean;
  canRestore: boolean;
  onClose: () => void;
  onRestore: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-md border border-white/10 bg-[var(--color-panel)] px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <p className="font-mono text-[11px] text-[var(--color-ink)]">
            viewing v{version.versionN}
            {isHead && (
              <span className="ml-2 rounded-sm bg-[var(--color-accent)]/15 px-1 py-px text-[9px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
                head
              </span>
            )}
          </p>
          <p className="font-mono text-[10px] text-[var(--color-faint)]">
            {version.contentHash.slice(0, 16)}… ·{" "}
            <LocalDate value={version.createdAt} format="datetime" /> ·{" "}
            {version.source}
            {version.changedBy ? ` · ${version.changedBy}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {canRestore && !isHead && (
            <button
              type="button"
              onClick={onRestore}
              className="rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)] transition hover:bg-[var(--color-accent)]/20"
            >
              restore
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
          >
            close
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto rounded-md border border-white/10 bg-[var(--color-panel)] p-4 font-mono text-[12px] leading-relaxed text-[var(--color-ink)] whitespace-pre-wrap">
        {version.content}
      </pre>
    </div>
  );
}
