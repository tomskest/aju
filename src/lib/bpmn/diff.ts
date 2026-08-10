/**
 * BPMN version diffing.
 *
 * A document's ```bpmn fence is versioned by the ordinary document version
 * chain, so every past version of a doc already carries a past version of
 * its diagram. Rather than storing a diff, we store whole versions and
 * compute the diff at read time with bpmn-js-differ. A derived diff cannot
 * drift from the versions it describes, and any two versions can be
 * compared, not just consecutive ones.
 *
 * Everything in this module is DOM-free and unit-tested. Parsing XML into
 * moddle definitions needs a bpmn-js viewer (and therefore a document), so
 * that step lives in the client component instead.
 */

export type BpmnModel = {
  $type: string;
  id: string;
  name?: string;
  [key: string]: unknown;
};

export type BpmnChanges = {
  _added: Record<string, BpmnModel>;
  _removed: Record<string, BpmnModel>;
  _changed: Record<
    string,
    {
      model: BpmnModel;
      attrs: Record<string, { oldValue: unknown; newValue: unknown }>;
    }
  >;
  _layoutChanged: Record<string, BpmnModel>;
};

/** `layout` is position-only movement; real content is unchanged. */
export type ChangeKind = "added" | "removed" | "changed" | "layout";

export type AttrChange = {
  key: string;
  oldValue: string;
  newValue: string;
};

export type ChangeEntry = {
  kind: ChangeKind;
  /** BPMN element id. Stable across versions, and what the diff keys on. */
  id: string;
  /** `bpmn:ServiceTask` reduced to `ServiceTask`. */
  type: string;
  name: string | null;
  attrs: AttrChange[];
};

// ── Fence extraction ────────────────────────────────────────

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Pulls the source of every ```bpmn fence out of a markdown document, in
 * document order.
 *
 * Every fence is tracked, not just bpmn ones, so that a ```bpmn line
 * *inside* another fenced block (documentation about the format, for
 * instance) is treated as content rather than as an opener.
 */
export function extractBpmnFences(markdown: string): string[] {
  const out: string[] = [];
  const lines = markdown.split(/\r?\n/);

  let openMarker: string | null = null;
  let capturing = false;
  let buf: string[] = [];

  for (const line of lines) {
    const m = FENCE_RE.exec(line);

    if (openMarker === null) {
      if (m) {
        openMarker = m[1];
        capturing = m[2].trim().split(/\s+/)[0].toLowerCase() === "bpmn";
        buf = [];
      }
      continue;
    }

    // A fence closes on the same character, at least as long as the
    // opener, carrying no info string.
    const closes =
      m !== null &&
      m[1][0] === openMarker[0] &&
      m[1].length >= openMarker.length &&
      m[2].trim() === "";

    if (closes) {
      if (capturing) out.push(buf.join("\n"));
      openMarker = null;
      capturing = false;
      buf = [];
      continue;
    }

    if (capturing) buf.push(line);
  }

  // An unterminated fence still renders as a code block, so treat EOF as
  // a close rather than dropping the diagram. The trailing newline that
  // ends a well-formed file is not part of the diagram source.
  if (openMarker !== null && capturing) {
    while (buf.length > 0 && buf[buf.length - 1].trim() === "") buf.pop();
    out.push(buf.join("\n"));
  }

  return out;
}

export function hasBpmnFence(markdown: string): boolean {
  return extractBpmnFences(markdown).length > 0;
}

// ── Change summarisation ────────────────────────────────────

const KIND_RANK: Record<ChangeKind, number> = {
  added: 0,
  removed: 1,
  changed: 2,
  layout: 3,
};

function shortType(model: BpmnModel | undefined): string {
  const raw = model?.$type ?? "";
  const colon = raw.indexOf(":");
  return colon === -1 ? raw : raw.slice(colon + 1);
}

function nameOf(model: BpmnModel | undefined): string | null {
  const name = model?.name;
  if (typeof name !== "string") return null;
  const trimmed = name.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Renders a moddle attribute value for display. Values are usually
 * primitives, but references come through as moddle objects.
 */
export function formatAttrValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "(empty)";
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") {
    const obj = value as Partial<BpmnModel>;
    if (typeof obj.id === "string") return obj.id;
    if (typeof obj.$type === "string") return shortType(obj as BpmnModel);
    return "(object)";
  }
  return String(value);
}

/**
 * Flattens a raw differ result into one sorted, display-ready list.
 * Sorted by kind (added, removed, changed, then layout-only) and by id
 * within a kind, so the same diff always reads the same way.
 */
export function summarizeChanges(changes: BpmnChanges): ChangeEntry[] {
  const entries: ChangeEntry[] = [];

  for (const [id, model] of Object.entries(changes._added ?? {})) {
    entries.push({ kind: "added", id, type: shortType(model), name: nameOf(model), attrs: [] });
  }

  for (const [id, model] of Object.entries(changes._removed ?? {})) {
    entries.push({ kind: "removed", id, type: shortType(model), name: nameOf(model), attrs: [] });
  }

  for (const [id, entry] of Object.entries(changes._changed ?? {})) {
    // bpmn-js-differ 3.2.0 labels attribute deltas the wrong way round:
    // for diff(old, new) it puts the NEW value under `oldValue` and the
    // OLD value under `newValue`. Its element buckets (_added/_removed)
    // do follow argument order, so only these two keys are inverted.
    // Swapping here keeps every consumer reading in document order.
    // differ-integration.test.ts pins this against the real library, so
    // the test fails loudly if upstream ever corrects it.
    const attrs: AttrChange[] = Object.entries(entry.attrs ?? {}).map(([key, delta]) => ({
      key,
      oldValue: formatAttrValue(delta?.newValue),
      newValue: formatAttrValue(delta?.oldValue),
    }));
    attrs.sort((a, b) => a.key.localeCompare(b.key));
    entries.push({
      kind: "changed",
      id,
      type: shortType(entry.model),
      name: nameOf(entry.model),
      attrs,
    });
  }

  // An element that genuinely changed also tends to move. Report it once,
  // under the more informative kind.
  const substantive = new Set(entries.map((e) => e.id));
  for (const [id, model] of Object.entries(changes._layoutChanged ?? {})) {
    if (substantive.has(id)) continue;
    entries.push({ kind: "layout", id, type: shortType(model), name: nameOf(model), attrs: [] });
  }

  entries.sort((a, b) =>
    KIND_RANK[a.kind] !== KIND_RANK[b.kind]
      ? KIND_RANK[a.kind] - KIND_RANK[b.kind]
      : a.id.localeCompare(b.id),
  );

  return entries;
}

/** True when nothing at all differs between the two diagrams. */
export function isEmptyDiff(entries: ChangeEntry[]): boolean {
  return entries.length === 0;
}

/** True when the only differences are elements moving around. */
export function isLayoutOnlyDiff(entries: ChangeEntry[]): boolean {
  return entries.length > 0 && entries.every((e) => e.kind === "layout");
}

export function countByKind(entries: ChangeEntry[]): Record<ChangeKind, number> {
  const counts: Record<ChangeKind, number> = { added: 0, removed: 0, changed: 0, layout: 0 };
  for (const e of entries) counts[e.kind] += 1;
  return counts;
}

// ── DI completeness ─────────────────────────────────────────

type MaybeDefinitions = {
  rootElements?: Array<{
    $type?: string;
    flowElements?: BpmnModel[];
  }>;
  diagrams?: Array<{
    plane?: {
      planeElement?: Array<{ bpmnElement?: { id?: string } }>;
    };
  }>;
};

/**
 * Returns flow elements that carry no diagram interchange (DI) entry.
 *
 * bpmn-js does no auto-layout: an element without a BPMNShape or
 * BPMNEdge parses fine and then silently fails to draw. That is the
 * classic failure mode when a diagram is edited by hand or generated,
 * so the diff view calls this out rather than showing a diagram with
 * invisible parts.
 */
export function findElementsWithoutDi(definitions: unknown): BpmnModel[] {
  const defs = definitions as MaybeDefinitions | null;
  if (!defs) return [];

  const drawn = new Set<string>();
  for (const diagram of defs.diagrams ?? []) {
    for (const el of diagram.plane?.planeElement ?? []) {
      const id = el?.bpmnElement?.id;
      if (typeof id === "string") drawn.add(id);
    }
  }
  // No DI section at all is a different (and louder) failure, because bpmn-js
  // rejects the import outright, so there is nothing useful to report.
  if (drawn.size === 0) return [];

  const missing: BpmnModel[] = [];
  for (const root of defs.rootElements ?? []) {
    for (const el of root.flowElements ?? []) {
      if (typeof el?.id === "string" && !drawn.has(el.id)) missing.push(el);
    }
  }
  return missing;
}
