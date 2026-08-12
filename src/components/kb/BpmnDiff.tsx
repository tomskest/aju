"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css";
import {
  countByKind,
  extractBpmnFences,
  findElementsWithoutDi,
  isLayoutOnlyDiff,
  summarizeChanges,
  type BpmnChanges,
  type ChangeEntry,
  type ChangeKind,
} from "@/lib/bpmn/diff";

/**
 * Visual diff between the ```bpmn diagrams in two versions of a document.
 *
 * Nothing about the diff is stored: both versions are whole, valid BPMN
 * documents and bpmn-js-differ computes what changed at read time. That
 * keeps a diff from ever drifting out of sync with the versions it
 * describes, and lets any two versions be compared, not just adjacent ones.
 *
 * Removed elements exist only in the old document and added ones only in
 * the new, so the two are rendered side by side and each canvas is marked
 * with the changes it can actually show.
 */

type Props = {
  /** Full markdown of the older version. */
  oldContent: string;
  /** Full markdown of the newer version. */
  newContent: string;
  oldLabel: string;
  newLabel: string;
  /**
   * Restrict to a single diagram by its position in the document. Used
   * when the diff is opened from one figure in the document body, where
   * comparing every diagram in the file would be noise. The position
   * comes from the DOM enumeration of rendered figures, which counts
   * fence shapes (blockquoted, deeply indented) that the raw-markdown
   * scanner skips, so a unique `onlySource` match wins over this index.
   */
  only?: number;
  /**
   * Raw source of the clicked fence, straight from the rendered code
   * block. Lets `only` be resolved by content rather than position, so
   * the two enumerations disagreeing does not silently diff the wrong
   * diagram.
   */
  onlySource?: string;
};

type Layout = "stacked" | "columns";

const RENDERER_COLORS = {
  defaultFillColor: "rgba(34, 197, 94, 0.08)",
  defaultStrokeColor: "#86efac",
  defaultLabelColor: "#ececee",
};

const KIND_LABEL: Record<ChangeKind, string> = {
  added: "added",
  removed: "removed",
  changed: "changed",
  layout: "moved",
};

type Canvas = {
  addMarker: (id: string, cls: string) => void;
  zoom: ((level?: number | string, center?: string | null) => number) | (() => number);
  resized: () => void;
};

type ElementRegistry = {
  get: (id: string) => unknown;
};

type Viewer = {
  importXML: (xml: string) => Promise<{ warnings?: unknown[] }>;
  getDefinitions: () => unknown;
  get: <T>(name: string) => T;
  destroy: () => void;
};

let navigatedViewerPromise: Promise<
  typeof import("bpmn-js/lib/NavigatedViewer").default
> | null = null;

async function loadNavigatedViewer() {
  if (!navigatedViewerPromise) {
    navigatedViewerPromise = import("bpmn-js/lib/NavigatedViewer").then((m) => m.default);
  }
  return navigatedViewerPromise;
}

let differPromise: Promise<typeof import("bpmn-js-differ")> | null = null;

async function loadDiffer() {
  if (!differPromise) differPromise = import("bpmn-js-differ");
  return differPromise;
}

export default function BpmnDiff({
  oldContent,
  newContent,
  oldLabel,
  newLabel,
  only,
  onlySource,
}: Props) {
  const oldFences = useMemo(() => extractBpmnFences(oldContent), [oldContent]);
  const newFences = useMemo(() => extractBpmnFences(newContent), [newContent]);

  // Prefer resolving the clicked diagram by its source text: a unique
  // exact match against the new version's fences is authoritative. An
  // ambiguous match (the same diagram repeated verbatim) falls back to
  // the positional index, which position genuinely disambiguates. Zero
  // matches means the raw-markdown scanner cannot see the clicked fence
  // at all (blockquoted or deeply indented fences render but never
  // extract), so any positional pairing would silently show a different
  // diagram; refuse rather than guess.
  const effectiveOnly = useMemo<number | "unlocated" | undefined>(() => {
    if (only === undefined || onlySource === undefined) return only;
    const target = onlySource.trim();
    const matches: number[] = [];
    newFences.forEach((fence, i) => {
      if (fence.trim() === target) matches.push(i);
    });
    if (matches.length === 1) return matches[0];
    return matches.length === 0 ? "unlocated" : only;
  }, [only, onlySource, newFences]);

  if (effectiveOnly === "unlocated") {
    return (
      <p className="bpmn-diff-note">
        Could not locate this diagram in the document source, so a reliable
        comparison is not possible. Diagrams inside blockquotes or indented
        lists render but cannot be matched to a version history.
      </p>
    );
  }

  const pairCount = Math.max(oldFences.length, newFences.length);
  const indexes =
    effectiveOnly === undefined
      ? Array.from({ length: pairCount }, (_, i) => i)
      : [effectiveOnly];

  if (pairCount === 0) {
    return (
      <p className="bpmn-diff-note">
        Neither version contains a bpmn diagram. Compare the source instead.
      </p>
    );
  }

  if (effectiveOnly !== undefined && effectiveOnly >= pairCount) {
    return <p className="bpmn-diff-note">That diagram does not exist in either version.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {oldFences.length !== newFences.length &&
        (effectiveOnly === undefined ? (
          <p className="bpmn-diff-note">
            Diagram count changed: {oldFences.length} in {oldLabel}, {newFences.length} in{" "}
            {newLabel}. Diagrams are paired in document order.
          </p>
        ) : (
          // Single-diagram mode pairs by position too, and here that can
          // silently line this diagram up against a different one.
          <p className="bpmn-diff-note">
            Diagram count changed: {oldFences.length} in {oldLabel}, {newFences.length} in{" "}
            {newLabel}. Diagrams pair by document position, so the {oldLabel} side may not
            show this diagram.
          </p>
        ))}
      {indexes.map((i) => (
        <BpmnDiffPair
          key={i}
          index={i}
          total={pairCount}
          oldXml={oldFences[i] ?? null}
          newXml={newFences[i] ?? null}
          oldLabel={oldLabel}
          newLabel={newLabel}
        />
      ))}
    </div>
  );
}

function BpmnDiffPair({
  index,
  total,
  oldXml,
  newXml,
  oldLabel,
  newLabel,
}: {
  index: number;
  total: number;
  oldXml: string | null;
  newXml: string | null;
  oldLabel: string;
  newLabel: string;
}) {
  const oldHostRef = useRef<HTMLDivElement>(null);
  const newHostRef = useRef<HTMLDivElement>(null);
  const viewersRef = useRef<Viewer[]>([]);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<ChangeEntry[]>([]);
  const [undrawn, setUndrawn] = useState<string[]>([]);
  const [layout, setLayout] = useState<Layout>("stacked");
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const viewers: Viewer[] = [];
    viewersRef.current = viewers;

    (async () => {
      setStatus("loading");
      setError(null);

      const [NavigatedViewer, differ] = await Promise.all([loadNavigatedViewer(), loadDiffer()]);
      if (cancelled) return;

      const mount = async (host: HTMLDivElement | null, xml: string | null, side: string) => {
        if (!host || !xml) return null;
        host.innerHTML = "";
        const viewer = new NavigatedViewer({
          container: host,
          bpmnRenderer: RENDERER_COLORS,
        }) as unknown as Viewer;
        viewers.push(viewer);
        try {
          await viewer.importXML(xml);
        } catch (err) {
          throw new Error(
            `${side}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        return viewer;
      };

      let oldViewer: Viewer | null;
      let newViewer: Viewer | null;
      try {
        oldViewer = await mount(oldHostRef.current, oldXml, oldLabel);
        newViewer = await mount(newHostRef.current, newXml, newLabel);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
        return;
      }
      if (cancelled) return;

      // One side missing means the diagram was added or deleted wholesale;
      // there is no pair to diff, just the one version to display.
      if (!oldViewer || !newViewer) {
        setEntries([]);
        setUndrawn(
          findElementsWithoutDi((newViewer ?? oldViewer)?.getDefinitions()).map(labelFor),
        );
        fitAll(viewers);
        setStatus("ready");
        return;
      }

      const changes = differ.diff(
        oldViewer.getDefinitions(),
        newViewer.getDefinitions(),
      ) as BpmnChanges;

      markCanvas(oldViewer, changes._removed, "bpmn-diff-removed");
      markCanvas(oldViewer, changes._changed, "bpmn-diff-changed");
      markCanvas(oldViewer, changes._layoutChanged, "bpmn-diff-layout");
      markCanvas(newViewer, changes._added, "bpmn-diff-added");
      markCanvas(newViewer, changes._changed, "bpmn-diff-changed");
      markCanvas(newViewer, changes._layoutChanged, "bpmn-diff-layout");

      setEntries(summarizeChanges(changes));
      setUndrawn(findElementsWithoutDi(newViewer.getDefinitions()).map(labelFor));
      fitAll(viewers);
      setStatus("ready");
    })().catch((err) => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    });

    return () => {
      cancelled = true;
      for (const v of viewers) {
        try {
          v.destroy();
        } catch {
          /* viewer already torn down */
        }
      }
      viewersRef.current = [];
    };
  }, [oldXml, newXml, oldLabel, newLabel]);

  // Zoom is driven from a single control so both canvases stay at the
  // same scale; panning stays independent per canvas.
  const zoomBoth = useCallback((factor: number) => {
    for (const v of viewersRef.current) {
      const canvas = v.get<Canvas>("canvas");
      const zoom = canvas.zoom as (level?: number | string, center?: string | null) => number;
      const next = Math.max(0.1, Math.min(4, zoom() * factor));
      zoom(next);
    }
  }, []);

  const fitBoth = useCallback(() => fitAll(viewersRef.current), []);

  // Fullscreen changes the canvas boxes, and bpmn-js caches viewport size,
  // so both viewers need telling before a re-fit lands correctly.
  useEffect(() => {
    if (!fullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [fullscreen]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      for (const v of viewersRef.current) {
        try {
          v.get<Canvas>("canvas").resized();
        } catch {
          /* canvas not ready */
        }
      }
      fitAll(viewersRef.current);
    });
    return () => cancelAnimationFrame(id);
  }, [fullscreen, layout, status]);

  const counts = countByKind(entries);

  return (
    <section className={`bpmn-diff${fullscreen ? " is-fullscreen" : ""}`}>
      <header className="bpmn-diff-toolbar">
        <div className="bpmn-diff-legend">
          {total > 1 && (
            <span className="bpmn-diff-legend-item text-[var(--color-faint)]">
              diagram {index + 1}/{total}
            </span>
          )}
          <LegendDot kind="added" count={counts.added} />
          <LegendDot kind="removed" count={counts.removed} />
          <LegendDot kind="changed" count={counts.changed} />
          <LegendDot kind="layout" count={counts.layout} />
        </div>
        <div className="bpmn-diff-controls">
          <button type="button" onClick={() => zoomBoth(1 / 1.25)} title="Zoom out">
            −
          </button>
          <button type="button" onClick={() => zoomBoth(1.25)} title="Zoom in">
            +
          </button>
          <button type="button" onClick={fitBoth} title="Fit both diagrams">
            fit
          </button>
          <button
            type="button"
            className="bpmn-diff-expand"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? "Leave fullscreen (Esc)" : "Fullscreen"}
          >
            {fullscreen ? "close" : "expand"}
          </button>
          <button
            type="button"
            onClick={() => setLayout((l) => (l === "stacked" ? "columns" : "stacked"))}
            title="Toggle stacked / side-by-side"
          >
            {layout === "stacked" ? "columns" : "stacked"}
          </button>
        </div>
      </header>

      {status === "loading" && <p className="bpmn-diff-note">rendering both versions…</p>}
      {status === "error" && <p className="mermaid-error">bpmn diff: {error}</p>}

      <div className={`bpmn-diff-panes ${layout === "columns" ? "is-columns" : ""}`}>
        <figure className="bpmn-diff-pane">
          <figcaption>
            {oldLabel} <span>before</span>
          </figcaption>
          {oldXml ? (
            <div ref={oldHostRef} className="bpmn-diff-canvas" />
          ) : (
            <div className="bpmn-diff-canvas bpmn-diff-canvas-empty">no diagram in this version</div>
          )}
        </figure>
        <figure className="bpmn-diff-pane">
          <figcaption>
            {newLabel} <span>after</span>
          </figcaption>
          {newXml ? (
            <div ref={newHostRef} className="bpmn-diff-canvas" />
          ) : (
            <div className="bpmn-diff-canvas bpmn-diff-canvas-empty">no diagram in this version</div>
          )}
        </figure>
      </div>

      {undrawn.length > 0 && (
        <p className="bpmn-diff-warning">
          {undrawn.length} element{undrawn.length === 1 ? "" : "s"} in the newer version have no
          DI and will not draw: {undrawn.join(", ")}. Every element needs a BPMNShape and every
          sequence flow a BPMNEdge.
        </p>
      )}

      {status === "ready" && <ChangeList entries={entries} />}

      {/* bpmn.io license requires visible attribution on rendered diagrams. */}
      <a
        className="bpmn-attribution"
        href="https://bpmn.io"
        target="_blank"
        rel="noopener noreferrer"
      >
        powered by bpmn.io
      </a>
    </section>
  );
}

function ChangeList({ entries }: { entries: ChangeEntry[] }) {
  const [showMoves, setShowMoves] = useState(false);

  if (entries.length === 0) {
    return <p className="bpmn-diff-note">The diagrams are identical.</p>;
  }
  if (isLayoutOnlyDiff(entries)) {
    return (
      <p className="bpmn-diff-note">
        Only positions changed: {entries.length} element{entries.length === 1 ? "" : "s"} moved,
        no change to the process itself.
      </p>
    );
  }

  const substantive = entries.filter((e) => e.kind !== "layout");
  const moves = entries.filter((e) => e.kind === "layout");

  return (
    <div className="bpmn-diff-changes">
      <ol>
        {substantive.map((e) => (
          <ChangeRow key={`${e.kind}:${e.id}`} entry={e} />
        ))}
      </ol>
      {moves.length > 0 && (
        <>
          <button
            type="button"
            className="bpmn-diff-more"
            onClick={() => setShowMoves((v) => !v)}
          >
            {showMoves ? "hide" : "show"} {moves.length} element
            {moves.length === 1 ? "" : "s"} that only moved
          </button>
          {showMoves && (
            <ol>
              {moves.map((e) => (
                <ChangeRow key={`layout:${e.id}`} entry={e} />
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

function ChangeRow({ entry }: { entry: ChangeEntry }) {
  return (
    <li className={`bpmn-diff-change bpmn-diff-change-${entry.kind}`}>
      <span className="bpmn-diff-change-kind">{KIND_LABEL[entry.kind]}</span>
      <span className="bpmn-diff-change-body">
        <span className="bpmn-diff-change-type">{entry.type}</span>{" "}
        <code>{entry.id}</code>
        {entry.name && <em> “{entry.name}”</em>}
        {entry.attrs.length > 0 && (
          <span className="bpmn-diff-change-attrs">
            {entry.attrs.map((a) => (
              <span key={a.key}>
                {a.key}: {a.oldValue} → {a.newValue}
              </span>
            ))}
          </span>
        )}
      </span>
    </li>
  );
}

function LegendDot({ kind, count }: { kind: ChangeKind; count: number }) {
  return (
    <span className={`bpmn-diff-legend-item bpmn-diff-legend-${kind}`} data-empty={count === 0}>
      <i aria-hidden="true" />
      {count} {KIND_LABEL[kind]}
    </span>
  );
}

function markCanvas(viewer: Viewer, models: Record<string, unknown>, cls: string) {
  const canvas = viewer.get<Canvas>("canvas");
  const registry = viewer.get<ElementRegistry>("elementRegistry");
  for (const id of Object.keys(models ?? {})) {
    // The differ reports ids across both documents; only mark what this
    // canvas actually holds, since addMarker throws on an unknown id.
    if (!registry.get(id)) continue;
    canvas.addMarker(id, cls);
  }
}

function fitAll(viewers: Viewer[]) {
  for (const v of viewers) {
    try {
      const canvas = v.get<Canvas>("canvas");
      (canvas.zoom as (level: string, center: string) => number)("fit-viewport", "auto");
    } catch {
      /* canvas not ready */
    }
  }
}

function labelFor(model: { id: string; name?: string }): string {
  return model.name ? `${model.id} (${model.name})` : model.id;
}
