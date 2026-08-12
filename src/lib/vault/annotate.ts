/**
 * Selection-to-source anchoring for reader annotations.
 *
 * The brain reader shows rendered HTML while edits land on raw markdown,
 * so "mark what I selected" needs a mapping from the selection's visible
 * text back to a source range. Anchoring is text-quote based (in the
 * spirit of Hypothesis): both the source and the quote are normalised to
 * the text a reader actually sees (inline markers stripped, link syntax
 * reduced to its label, whitespace collapsed), the quote is located in
 * the normalised source, and the match is mapped back to raw offsets.
 * Repeated phrases are disambiguated by the selection's surrounding
 * context and rejected when that fails, so an annotation never lands on
 * the wrong occurrence silently.
 *
 * Two annotation kinds, chosen for what they tell a later reader (human
 * or agent) about the claim:
 *
 *   strike    ~~text~~   this is stale or wrong
 *   highlight ==text==   this is load-bearing
 *
 * When an author is supplied, the marker gains an attribution comment:
 *
 *   ~~text~~<!-- struck by user@org on 2026-08-12 -->
 *
 * The renderer drops raw HTML, so attribution is invisible in the web
 * view but travels with the claim in the raw source, telling a later
 * reader (human or agent) who flagged it and when.
 *
 * Selecting text already inside the same marker toggles it off,
 * attribution comment included.
 */

export type AnnotationKind = "strike" | "highlight";

export type SelectionQuote = {
  /** The selection's visible text (Selection.toString()). */
  text: string;
  /** Visible text immediately before the selection, for disambiguation. */
  before: string;
  /** Visible text immediately after the selection, for disambiguation. */
  after: string;
};

export type AnnotateFailureReason =
  | "too_short"
  | "not_found"
  | "ambiguous"
  | "crosses_blocks"
  | "inside_code_block";

export type AnnotateResult =
  | { ok: true; content: string; action: "wrapped" | "unwrapped" }
  | { ok: false; reason: AnnotateFailureReason };

export type AnnotateOptions = {
  /** Identity recorded in the attribution comment (e.g. an email). */
  author?: string;
  /** ISO date (YYYY-MM-DD) recorded in the attribution comment. */
  date?: string;
};

const MARKER: Record<AnnotationKind, string> = {
  strike: "~~",
  highlight: "==",
};

const ATTRIBUTION_VERB: Record<AnnotationKind, string> = {
  strike: "struck",
  highlight: "highlighted",
};

function attributionComment(kind: AnnotationKind, opts?: AnnotateOptions): string {
  const author = opts?.author?.replace(/>/g, "").replace(/--/g, "-").trim();
  if (!author) return "";
  const date = opts?.date?.replace(/[^0-9-]/g, "");
  return `<!-- ${ATTRIBUTION_VERB[kind]} by ${author}${date ? ` on ${date}` : ""} -->`;
}

/**
 * Inline-syntax characters stripped from BOTH the source map and the
 * quote. Stripping the same set from both sides keeps literal
 * occurrences (a `*` in prose, `_` in an identifier) consistent, at the
 * cost of slightly less discriminating matches.
 */
const STRIPPED = new Set(["*", "_", "~", "=", "`"]);

/** Table pipes render as cell boundaries; fold them into whitespace. */
function isCollapsible(ch: string): boolean {
  return ch === "|" || /\s/.test(ch);
}

/** Punctuation set for backslash escapes (CommonMark's ASCII range). */
const ESCAPABLE = /[!-/:-@[-`{-~]/;

type Kept = { ch: string; idx: number };

type SourceIndex = {
  text: string;
  map: number[];
  /** [start, end) raw ranges of fenced code blocks, fence lines included. */
  fences: Array<[number, number]>;
};

/**
 * Matches HTML comments (dropped by the renderer, e.g. annotation
 * attribution) plus wikilinks and inline links/images, mirroring
 * render-wikilinks. The comment alternative captures nothing, so the
 * group numbering of the link alternatives is unaffected.
 */
const INLINE_LINK =
  /<!--.*?-->|\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]|(!?)\[([^\]]*)\]\(([^)]*)\)/g;

function emitRaw(kept: Kept[], s: string, base: number) {
  for (let j = 0; j < s.length; j++) kept.push({ ch: s[j], idx: base + j });
}

function emitInline(kept: Kept[], s: string, base: number) {
  INLINE_LINK.lastIndex = 0;
  let last = 0;
  for (let m = INLINE_LINK.exec(s); m !== null; m = INLINE_LINK.exec(s)) {
    emitRaw(kept, s.slice(last, m.index), base + last);
    if (m[0].startsWith("<!--")) {
      // HTML comments never render; emit nothing.
    } else if (m[1] !== undefined) {
      // Wikilink: the visible text is the alias when present, else the
      // target, matching resolveWikilinksToMarkdown.
      const inner = m[2] ?? m[1];
      const innerStart =
        m[2] !== undefined ? m.index + 2 + m[1].length + 1 : m.index + 2;
      emitRaw(kept, inner, base + innerStart);
    } else if (m[3] !== "!") {
      // Markdown link: the visible text is the label. Images emit nothing.
      emitRaw(kept, m[4], base + m.index + m[3].length + 1);
    }
    last = m.index + m[0].length;
  }
  emitRaw(kept, s.slice(last), base + last);
}

/**
 * Walks the raw source and produces the reader-visible text alongside a
 * per-character map back to raw offsets. Frontmatter is excluded, line
 * chrome (heading/bullet/quote markers, table separator rows, rules) is
 * skipped, link syntax collapses to its label, and STRIPPED characters
 * plus whitespace runs are folded exactly like normalizeQuote does.
 */
function buildSourceIndex(source: string): SourceIndex {
  const kept: Kept[] = [];
  const fences: Array<[number, number]> = [];

  let pos = 0;
  if (source.startsWith("---\n")) {
    const end = source.indexOf("\n---", 4);
    if (end !== -1) {
      const nl = source.indexOf("\n", end + 4);
      pos = nl === -1 ? source.length : nl + 1;
    }
  }

  let fence: { char: string; len: number; start: number } | null = null;

  while (pos < source.length) {
    let nl = source.indexOf("\n", pos);
    if (nl === -1) nl = source.length;
    const line = source.slice(pos, nl);
    const lineEnd = Math.min(nl + 1, source.length);

    const fenceMark = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (
        fenceMark &&
        fenceMark[1][0] === fence.char &&
        fenceMark[1].length >= fence.len
      ) {
        fences.push([fence.start, lineEnd]);
        fence = null;
      } else {
        // Fence bodies render verbatim as code text; they stay in the
        // map so a selection inside one anchors and gets the precise
        // inside_code_block rejection rather than not_found.
        emitRaw(kept, line, pos);
      }
      kept.push({ ch: "\n", idx: nl });
      pos = lineEnd;
      continue;
    }
    if (fenceMark) {
      fence = { char: fenceMark[1][0], len: fenceMark[1].length, start: pos };
      kept.push({ ch: "\n", idx: nl });
      pos = lineEnd;
      continue;
    }

    // Lines that render as chrome, not text: horizontal rules and table
    // separator rows.
    if (/^[\s|:-]+$/.test(line) && line.includes("--")) {
      kept.push({ ch: "\n", idx: nl });
      pos = lineEnd;
      continue;
    }

    // Line-leading markers that vanish in render.
    let i = 0;
    const quoteM = /^(?:\s*>)+\s?/.exec(line);
    if (quoteM) i = quoteM[0].length;
    const bulletM = /^\s*(?:[-*+]|\d{1,3}[.)])\s+/.exec(line.slice(i));
    if (bulletM) {
      i += bulletM[0].length;
      const checkM = /^\[[ xX]\]\s+/.exec(line.slice(i));
      if (checkM) i += checkM[0].length;
    }
    const headM = /^\s*#{1,6}\s+/.exec(line.slice(i));
    if (headM) i += headM[0].length;

    emitInline(kept, line.slice(i), pos + i);
    kept.push({ ch: "\n", idx: nl });
    pos = lineEnd;
  }
  if (fence) fences.push([fence.start, source.length]);

  let text = "";
  const map: number[] = [];
  let wsIdx: number | null = null;
  for (let k = 0; k < kept.length; k++) {
    const { ch, idx } = kept[k];
    if (STRIPPED.has(ch)) continue;
    if (ch === "\\" && k + 1 < kept.length && ESCAPABLE.test(kept[k + 1].ch)) {
      // Backslash escapes render only the escaped character.
      continue;
    }
    if (isCollapsible(ch)) {
      if (wsIdx === null) wsIdx = idx;
      continue;
    }
    if (wsIdx !== null && text.length > 0) {
      text += " ";
      map.push(wsIdx);
    }
    wsIdx = null;
    text += ch;
    map.push(idx);
  }
  return { text, map, fences };
}

/** The quote-side twin of buildSourceIndex's folding rules. */
function normalizeQuote(q: string): string {
  let out = "";
  let ws = false;
  for (const ch of q) {
    if (STRIPPED.has(ch)) continue;
    if (isCollapsible(ch)) {
      ws = true;
      continue;
    }
    if (ws && out.length > 0) out += " ";
    ws = false;
    out += ch;
  }
  return out;
}

function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

function commonSuffix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

function findBlockStart(source: string, at: number): number {
  const sep = /\n[ \t\r]*\n/g;
  let start = 0;
  for (let m = sep.exec(source); m !== null && m.index < at; m = sep.exec(source)) {
    const end = m.index + m[0].length;
    if (end <= at) start = end;
  }
  return start;
}

function findBlockEnd(source: string, at: number): number {
  const sep = /\n[ \t\r]*\n/g;
  sep.lastIndex = at;
  const m = sep.exec(source);
  return m ? m.index : source.length;
}

type Span = { start: number; end: number; whole: boolean };

/**
 * Widens [s, e) so the inserted markers can't produce broken markdown.
 * `whole` spans (inline code, wikilinks) would render the markers
 * literally even when the range sits strictly inside, so they always
 * absorb the range. Paired constructs (bold, strike, highlight, links)
 * only snap when the range crosses exactly one of their edges; a range
 * fully inside or fully containing them nests legally.
 */
function snapToSyntax(
  source: string,
  blockStart: number,
  blockEnd: number,
  s0: number,
  e0: number,
): { s: number; e: number } {
  const block = source.slice(blockStart, blockEnd);
  const spans: Span[] = [];

  const ticks: number[] = [];
  for (let i = 0; i < block.length; i++) {
    if (block[i] === "`") ticks.push(blockStart + i);
  }
  for (let i = 0; i + 1 < ticks.length; i += 2) {
    spans.push({ start: ticks[i], end: ticks[i + 1] + 1, whole: true });
  }

  INLINE_LINK.lastIndex = 0;
  for (let m = INLINE_LINK.exec(block); m !== null; m = INLINE_LINK.exec(block)) {
    // Comment text is absent from the index map, so a range endpoint can
    // never land inside one; nothing to snap.
    if (m[0].startsWith("<!--")) continue;
    spans.push({
      start: blockStart + m.index,
      end: blockStart + m.index + m[0].length,
      // Markers inside [[...]] end up HTML-escaped into the anchor text;
      // emphasis inside a normal link label is legal markdown.
      whole: m[1] !== undefined,
    });
  }

  for (const mk of ["**", "__", "~~", "=="]) {
    const occ: number[] = [];
    for (let i = block.indexOf(mk); i !== -1; i = block.indexOf(mk, i + 2)) {
      occ.push(blockStart + i);
    }
    for (let i = 0; i + 1 < occ.length; i += 2) {
      spans.push({ start: occ[i], end: occ[i + 1] + 2, whole: false });
    }
  }

  let s = s0;
  let e = e0;
  let changed = true;
  for (let guard = 0; changed && guard < 8; guard++) {
    changed = false;
    for (const span of spans) {
      const startsInside = s > span.start && s < span.end;
      const endsInside = e > span.start && e < span.end;
      if (s <= span.start && e >= span.end) continue;
      if (span.whole) {
        if (startsInside && s !== span.start) {
          s = span.start;
          changed = true;
        }
        if (endsInside && e !== span.end) {
          e = span.end;
          changed = true;
        }
      } else if (startsInside && !endsInside) {
        s = span.start;
        changed = true;
      } else if (endsInside && !startsInside) {
        e = span.end;
        changed = true;
      }
    }
  }
  return { s, e };
}

/** Finds a same-marker pair whose content fully contains [s, e). */
function enclosingPair(
  source: string,
  blockStart: number,
  blockEnd: number,
  marker: string,
  s: number,
  e: number,
): [number, number] | null {
  const block = source.slice(blockStart, blockEnd);
  const occ: number[] = [];
  for (let i = block.indexOf(marker); i !== -1; i = block.indexOf(marker, i + 2)) {
    occ.push(blockStart + i);
  }
  for (let i = 0; i + 1 < occ.length; i += 2) {
    if (occ[i] + 2 <= s && e <= occ[i + 1]) return [occ[i], occ[i + 1]];
  }
  return null;
}

export function annotateSource(
  source: string,
  quote: SelectionQuote,
  kind: AnnotationKind,
  opts?: AnnotateOptions,
): AnnotateResult {
  const nq = normalizeQuote(quote.text);
  if (nq.length < 3) return { ok: false, reason: "too_short" };

  const index = buildSourceIndex(source);
  const hits: number[] = [];
  for (let i = index.text.indexOf(nq); i !== -1; i = index.text.indexOf(nq, i + 1)) {
    hits.push(i);
  }
  if (hits.length === 0) return { ok: false, reason: "not_found" };

  let hit: number;
  if (hits.length === 1) {
    hit = hits[0];
  } else {
    const nb = normalizeQuote(quote.before);
    const na = normalizeQuote(quote.after);
    const scored = hits
      .map((h) => ({
        h,
        score:
          commonSuffix(index.text.slice(0, h).replace(/ +$/, ""), nb) +
          commonPrefix(index.text.slice(h + nq.length).replace(/^ +/, ""), na),
      }))
      .sort((a, b) => b.score - a.score);
    if (scored[0].score === scored[1].score) {
      return { ok: false, reason: "ambiguous" };
    }
    hit = scored[0].h;
  }

  let s = index.map[hit];
  let e = index.map[hit + nq.length - 1] + 1;

  for (const [fs, fe] of index.fences) {
    if (s < fe && e > fs) return { ok: false, reason: "inside_code_block" };
  }

  // Inline markers can't span blank-line-separated blocks, nor cross
  // into a different list item / heading / quote / table row.
  const blockStart = findBlockStart(source, s);
  const blockEnd = findBlockEnd(source, s);
  if (e > blockEnd) return { ok: false, reason: "crosses_blocks" };

  ({ s, e } = snapToSyntax(source, blockStart, blockEnd, s, e));

  if (/\n\s*(?:[-*+]\s|\d{1,3}[.)]\s|#{1,6}\s|>|\|)/.test(source.slice(s, e))) {
    return { ok: false, reason: "crosses_blocks" };
  }

  // `~~ text ~~` doesn't render as a marker pair; keep edges snug.
  while (s < e && /\s/.test(source[s])) s++;
  while (e > s && /\s/.test(source[e - 1])) e--;
  if (s >= e) return { ok: false, reason: "not_found" };

  const marker = MARKER[kind];

  // Toggle: any selection inside an existing same-marker span unwraps
  // the whole span. Re-marking marked text is a no-op semantically, so
  // the second tap reads as "undo".
  const pair = enclosingPair(source, blockStart, blockEnd, marker, s, e);
  if (pair) {
    const [open, close] = pair;
    // An attribution comment hugging the closing marker belongs to this
    // annotation; unwrapping takes it along.
    const tail = source.slice(close + 2);
    const cm = new RegExp(`^<!-- ${ATTRIBUTION_VERB[kind]} by [^>]* -->`).exec(tail);
    const removeEnd = close + 2 + (cm ? cm[0].length : 0);
    return {
      ok: true,
      action: "unwrapped",
      content:
        source.slice(0, open) +
        source.slice(open + 2, close) +
        source.slice(removeEnd),
    };
  }

  return {
    ok: true,
    action: "wrapped",
    content:
      source.slice(0, s) +
      marker +
      source.slice(s, e) +
      marker +
      attributionComment(kind, opts) +
      source.slice(e),
  };
}
