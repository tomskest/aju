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
  canWrite: boolean;
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
    initialOpenFolders(currentPath),
  );

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
      <main className="flex-1 overflow-y-auto bg-[var(--color-bg)]">
        {currentDoc ? (
          <article className="mx-auto max-w-[760px] px-6 py-10 md:px-10">
            <header className="mb-8 border-b border-white/5 pb-6">
              <p className="font-mono text-[11px] text-[var(--color-faint)]">
                {currentDoc.path}
              </p>
              <div className="mt-3 flex items-baseline justify-between gap-4">
                <h1 className="text-[32px] font-light leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
                  {currentDoc.title}
                </h1>
                <p className="shrink-0 font-mono text-[11px] text-[var(--color-faint)]">
                  {currentDoc.wordCount} words ·{" "}
                  {new Date(currentDoc.updatedAt).toLocaleDateString()}
                </p>
              </div>
              {canWrite && (
                <div className="mt-5 flex gap-2">
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
                        onClick={handleDelete}
                        className="rounded-md border border-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-red-500/40 hover:text-red-400"
                      >
                        delete
                      </button>
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
            ) : (
              <div
                className="kb-prose"
                dangerouslySetInnerHTML={{ __html: currentDoc.rendered }}
              />
            )}
          </article>
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
        className="group flex items-center gap-1.5 rounded-md py-1 pr-2 transition hover:text-[var(--color-muted)]"
        style={{ paddingLeft: 8 + indent }}
      >
        <button
          type="button"
          onClick={() => onToggleFolder(node.path)}
          className="flex flex-1 items-center gap-1.5 truncate text-left font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-faint)] transition hover:text-[var(--color-ink)]"
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
            className="hidden text-[var(--color-faint)] transition hover:text-[var(--color-ink)] group-hover:inline"
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

function initialOpenFolders(currentPath: string | null): Set<string> {
  const open = new Set<string>();
  if (!currentPath) return open;
  const parts = currentPath.split("/");
  for (let i = 1; i < parts.length; i++) {
    open.add(parts.slice(0, i).join("/"));
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
