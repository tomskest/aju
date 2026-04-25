import path from "path";
import type { PrismaClient as PrismaClientTenant } from "@prisma/client-tenant";
import { computeHash } from "./parse";

/**
 * Auto-linker — post-write pipeline that scans a document's body and
 * inserts `[[wikilink]]` markers around mentions of other documents in
 * the same brain. Idempotent (existing wikilinks are never touched), and
 * conservative (one link per target per doc, longest-match-first, only
 * outside protected regions).
 *
 * Design: same shape as `updateDocumentEmbedding` and
 * `scheduleRebuildLinks` — fire-and-forget after vault create/update,
 * doesn't block the user's response. Once it lands the new wikilinks,
 * `scheduleRebuildLinks` rebuilds the document_links graph so search /
 * `aju deep-search` immediately sees the new edges.
 *
 * Why heuristic and not LLM: deterministic, no per-document API cost, no
 * model-drift, easy to debug. The trade-off is that we only link to docs
 * that already exist in the brain — entity hubs that the user hasn't
 * created yet stay unlinked. A later pass can layer LLM entity extraction
 * on top of this same scaffold.
 */

export interface AutoLinkResult {
  /** How many new `[[wikilink]]` markers were inserted. */
  added: number;
  /** Whether the document content was actually modified + persisted. */
  updated: boolean;
}

interface AutoLinkTarget {
  /** Term to find in the body (case-insensitive whole-word match). */
  term: string;
  /** Wikilink target string (`[[<this>]]`). Usually the doc's basename. */
  target: string;
  /** Source doc id — used to skip self-links. */
  sourceId: string;
}

/**
 * Stoplist of single English words that are too generic to link even if
 * a doc happens to be titled this way. Keeps obvious noise out — avoids
 * `[[the]]`, `[[is]]`, etc. ever forming. The list is intentionally short;
 * legitimate compound titles like "the API" still link if they're the
 * actual basename.
 */
const TERM_STOPLIST = new Set([
  "the", "and", "for", "with", "from", "this", "that", "into", "what",
  "when", "where", "your", "have", "has", "are", "was", "were", "but",
  "not", "you", "all", "can", "just", "see", "now", "use", "user",
  "users", "data", "yes", "no", "ok", "by",
]);

/** Minimum term length — shorter than this is too noisy. */
const MIN_TERM_LENGTH = 3;

/**
 * Build the candidate-target list for `documentId`'s brain. Returns one
 * entry per term per candidate doc. A single doc may contribute multiple
 * terms (basename + title + frontmatter aliases) — they all point to the
 * same target string.
 */
async function loadCandidates(
  tenant: PrismaClientTenant,
  brainId: string,
  excludeDocumentId: string,
): Promise<AutoLinkTarget[]> {
  const docs = await tenant.vaultDocument.findMany({
    where: { brainId, id: { not: excludeDocumentId } },
    select: { id: true, path: true, title: true, frontmatter: true },
  });

  const targets: AutoLinkTarget[] = [];

  for (const doc of docs) {
    const basename = path.basename(doc.path, ".md");
    // Wikilinks resolve via basename in link-resolver.ts (lowercased,
    // hyphens swapped for spaces). The target string is the basename
    // verbatim — link-resolver normalizes both sides.
    const linkTarget = basename;

    // Candidate match terms: basename, title, frontmatter aliases.
    const terms = new Set<string>();
    terms.add(basename);
    // basename with hyphens → spaces (so "C-Teleport" matches "C Teleport")
    if (basename.includes("-")) {
      terms.add(basename.replace(/-/g, " "));
    }
    if (doc.title && doc.title !== basename) {
      terms.add(doc.title);
    }
    const fm = doc.frontmatter as Record<string, unknown> | null;
    if (fm && Array.isArray(fm.aliases)) {
      for (const a of fm.aliases) {
        if (typeof a === "string") terms.add(a);
      }
    }

    for (const term of terms) {
      const trimmed = term.trim();
      if (trimmed.length < MIN_TERM_LENGTH) continue;
      if (TERM_STOPLIST.has(trimmed.toLowerCase())) continue;
      targets.push({ term: trimmed, target: linkTarget, sourceId: doc.id });
    }
  }

  return targets;
}

/**
 * Find character ranges that should NOT be touched: existing wikilinks,
 * fenced + inline code, frontmatter, markdown links, and bare URLs.
 * Returns the merged ranges sorted by start position.
 */
function findProtectedRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  // Frontmatter (leading `---\n...\n---\n`).
  if (content.startsWith("---\n")) {
    const end = content.indexOf("\n---", 4);
    if (end !== -1) {
      const closer = content.indexOf("\n", end + 4);
      ranges.push([0, closer === -1 ? content.length : closer + 1]);
    }
  }

  const patterns: RegExp[] = [
    /```[\s\S]*?```/g,        // fenced code blocks
    /`[^`\n]+`/g,             // inline code
    /\[\[[^\]\n]+\]\]/g,      // existing wikilinks
    /\[[^\]\n]+\]\([^)\n]+\)/g, // markdown links
    /https?:\/\/\S+/g,        // bare URLs
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      ranges.push([m.index, m.index + m[0].length]);
    }
  }

  // Sort + merge overlapping ranges.
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    if (merged.length > 0 && r[0] <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(
        merged[merged.length - 1][1],
        r[1],
      );
    } else {
      merged.push([r[0], r[1]]);
    }
  }
  return merged;
}

function isProtected(
  start: number,
  end: number,
  ranges: Array<[number, number]>,
): boolean {
  // Linear scan — fine for typical doc sizes (hundreds of ranges max).
  for (const [s, e] of ranges) {
    if (start < e && end > s) return true;
    if (start < s) return false; // ranges are sorted by start
  }
  return false;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Apply auto-link replacements to the body. Rules:
 *   - longest term first (so `C-Teleport` wins over `C`)
 *   - case-insensitive whole-word match
 *   - first occurrence per (target doc) only — don't carpet-bomb
 *   - skip protected ranges
 *   - preserve original casing in display via `[[basename|original]]`
 *     when the matched text differs from the basename
 */
function applyAutoLinks(
  content: string,
  targets: AutoLinkTarget[],
): { content: string; added: number } {
  if (targets.length === 0) return { content, added: 0 };

  const protectedRanges = findProtectedRanges(content);
  const linkedTargets = new Set<string>(); // dedup by target doc

  // Sort by term length descending so the longest match wins. Stable for
  // ties so we don't reorder identical-length terms unpredictably.
  const sorted = [...targets].sort((a, b) => b.term.length - a.term.length);

  type Replacement = { start: number; end: number; replacement: string };
  const replacements: Replacement[] = [];

  for (const t of sorted) {
    if (linkedTargets.has(t.target)) continue;

    const re = new RegExp(`\\b${escapeRegex(t.term)}\\b`, "i");
    const match = content.match(re);
    if (!match || match.index === undefined) continue;

    const start = match.index;
    const end = start + match[0].length;

    if (isProtected(start, end, protectedRanges)) continue;
    // Don't overlap with an earlier replacement we already chose.
    const overlap = replacements.some((r) => start < r.end && end > r.start);
    if (overlap) continue;

    const matchedText = match[0];
    const isExactCase = matchedText === t.target;
    const replacement = isExactCase
      ? `[[${t.target}]]`
      : `[[${t.target}|${matchedText}]]`;

    replacements.push({ start, end, replacement });
    linkedTargets.add(t.target);
  }

  if (replacements.length === 0) return { content, added: 0 };

  // Apply right-to-left so earlier indices stay valid.
  replacements.sort((a, b) => b.start - a.start);
  let out = content;
  for (const r of replacements) {
    out = out.slice(0, r.start) + r.replacement + out.slice(r.end);
  }
  return { content: out, added: replacements.length };
}

const AUTO_LINK_REGEX = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

function extractWikilinks(content: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = AUTO_LINK_REGEX.exec(content)) !== null) {
    out.push(m[1].trim());
  }
  return [...new Set(out)];
}

/**
 * Scan a vault document and add `[[wikilinks]]` for mentions of other
 * docs in the same brain. Idempotent — running it twice on a doc that
 * already has the right links is a no-op.
 *
 * Returns counts so callers can decide whether to schedule a follow-up
 * `rebuildLinks` (only meaningful if `updated === true`).
 *
 * Designed to be called fire-and-forget from vault create/update routes:
 *
 *   autoLinkDocument(tenant, brainId, doc.id)
 *     .then(({ updated }) => updated && scheduleRebuildLinks(tenant, brainId))
 *     .catch((err) => console.error("auto-link failed:", err));
 */
export async function autoLinkDocument(
  tenant: PrismaClientTenant,
  brainId: string,
  documentId: string,
): Promise<AutoLinkResult> {
  const doc = await tenant.vaultDocument.findFirst({
    where: { id: documentId, brainId },
    select: { id: true, content: true },
  });
  if (!doc) return { added: 0, updated: false };

  const targets = await loadCandidates(tenant, brainId, doc.id);
  if (targets.length === 0) return { added: 0, updated: false };

  const { content: newContent, added } = applyAutoLinks(doc.content, targets);
  if (added === 0) return { added: 0, updated: false };

  await tenant.vaultDocument.update({
    where: { id: doc.id },
    data: {
      content: newContent,
      contentHash: computeHash(newContent),
      wikilinks: extractWikilinks(newContent),
      syncedAt: new Date(),
    },
  });

  return { added, updated: true };
}

/**
 * Re-run `autoLinkDocument` against every doc in a brain. Useful after a
 * new hub-doc is added — existing docs that mentioned the new hub's term
 * before it existed get retro-actively wikilinked.
 *
 * Sequential, not parallel, to keep the linking decisions stable: each
 * doc sees the same brain state when it runs.
 */
export async function autoLinkBrain(
  tenant: PrismaClientTenant,
  brainId: string,
): Promise<{ documents: number; totalAdded: number; updated: number }> {
  const docs = await tenant.vaultDocument.findMany({
    where: { brainId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  let totalAdded = 0;
  let updated = 0;
  for (const d of docs) {
    const r = await autoLinkDocument(tenant, brainId, d.id);
    totalAdded += r.added;
    if (r.updated) updated += 1;
  }
  return { documents: docs.length, totalAdded, updated };
}
