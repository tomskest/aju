import matter from "gray-matter";
import { Prisma } from "@prisma/client-tenant";
import { normalizeDirectory } from "./parse";

/**
 * Live query blocks — an embeddable ```aju-query``` fence whose YAML body
 * describes a filter over the brain's documents. On read (never on write) the
 * block is resolved into a markdown table/list of matching docs, so an index
 * note stays up to date without hand-maintenance.
 *
 * Resolution is a display-only transform: the stored document content (and its
 * contentHash) is never mutated, so edit / update / CAS always operate on the
 * raw block. See resolveDocumentContent.
 */

export interface QuerySpec {
  /** Directory prefix to scope to, e.g. "collab/handoffs". */
  from?: string;
  /**
   * Filters. `status` / `type` / `tags` map to promoted columns; any other key
   * is matched against the frontmatter JSON (`frontmatter->>key`). Values may be
   * a scalar or a list (list = "matches any of").
   */
  where?: Record<string, unknown>;
  /** "field" or "field asc|desc". Field is a built-in or a frontmatter key. */
  sort?: string;
  /** Columns to render. Built-ins: item/title, status, path, created, updated, type, tags. */
  columns?: string[];
  /** Max rows. Defaults to 50, capped at 500. */
  limit?: number;
  /** "table" (default) or "list". */
  as?: "table" | "list";
}

export interface QueryRow {
  id: string;
  path: string;
  title: string;
  doc_status: string | null;
  doc_type: string | null;
  tags: string[];
  frontmatter: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

interface FoundBlock {
  start: number;
  end: number;
  spec: QuerySpec | null;
  error?: string;
}

// Opening fence `\`\`\`aju-query` (optional trailing junk), body, closing fence
// on its own line. Non-greedy body so multiple blocks in one doc each match.
const BLOCK_RE = /```aju-query[^\n]*\n([\s\S]*?)\n```/g;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const DEFAULT_COLUMNS = ["title", "status"];

// Built-in sortable columns → real SQL column. Anything else is treated as a
// frontmatter key and bound as a parameter, so this whitelist is the only
// place raw identifiers reach the query.
const SORT_COLUMNS: Record<string, string> = {
  created: "created_at",
  updated: "updated_at",
  title: "title",
  status: "doc_status",
  type: "doc_type",
  path: "path",
};

/** Parse the YAML body of a query block using gray-matter's YAML engine. */
function parseSpec(body: string): QuerySpec {
  const { data } = matter(`---\n${body}\n---\n`);
  const spec: QuerySpec = {};
  if (typeof data.from === "string") spec.from = data.from;
  if (data.where && typeof data.where === "object" && !Array.isArray(data.where)) {
    spec.where = data.where as Record<string, unknown>;
  }
  if (typeof data.sort === "string") spec.sort = data.sort;
  if (Array.isArray(data.columns)) spec.columns = data.columns.map(String);
  if (typeof data.limit === "number") spec.limit = data.limit;
  if (data.as === "list" || data.as === "table") spec.as = data.as;
  return spec;
}

/** Locate every ```aju-query``` block in `content`, parsing each spec. */
export function findQueryBlocks(content: string): FoundBlock[] {
  const blocks: FoundBlock[] = [];
  BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_RE.exec(content)) !== null) {
    let spec: QuerySpec | null = null;
    let error: string | undefined;
    try {
      spec = parseSpec(m[1]);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    blocks.push({ start: m.index, end: m.index + m[0].length, spec, error });
  }
  return blocks;
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (v === null || v === undefined) return [];
  return [String(v)];
}

function clampLimit(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function buildOrderBy(sort: string | undefined): Prisma.Sql {
  if (!sort) return Prisma.sql`ORDER BY created_at DESC`;
  const [field, dirRaw] = sort.trim().split(/\s+/);
  const dir = dirRaw?.toLowerCase() === "asc" ? Prisma.raw("ASC") : Prisma.raw("DESC");
  const col = SORT_COLUMNS[field];
  if (col) return Prisma.sql`ORDER BY ${Prisma.raw(col)} ${dir}`;
  // Frontmatter key: the key is bound as a parameter (safe), direction is from
  // a two-value whitelist above.
  return Prisma.sql`ORDER BY frontmatter->>${field} ${dir}`;
}

/**
 * Run a query spec against the brain's documents. Filter-only (no full-text
 * requirement) — this is the piece `aju search` couldn't express. Every value
 * is a bound parameter; identifiers come from whitelists.
 */
export async function resolveQuery(
  tx: Prisma.TransactionClient,
  brainIds: string[],
  spec: QuerySpec,
): Promise<QueryRow[]> {
  const filters: Prisma.Sql[] = [
    Prisma.sql`brain_id = ANY(${brainIds}::text[])`,
  ];

  if (spec.from) {
    const prefix = normalizeDirectory(spec.from);
    filters.push(
      Prisma.sql`(directory = ${prefix} OR path LIKE ${prefix + "/%"})`,
    );
  }

  const where = spec.where ?? {};
  for (const [key, value] of Object.entries(where)) {
    if (value === null || value === undefined) continue;
    if (key === "status") {
      filters.push(Prisma.sql`doc_status = ANY(${toStringArray(value)}::text[])`);
    } else if (key === "type") {
      filters.push(Prisma.sql`doc_type = ANY(${toStringArray(value)}::text[])`);
    } else if (key === "tags") {
      // Array overlap: doc has ANY of the requested tags.
      filters.push(Prisma.sql`tags && ${toStringArray(value)}::text[]`);
    } else {
      // Arbitrary frontmatter field. Key bound as a parameter.
      filters.push(
        Prisma.sql`frontmatter->>${key} = ANY(${toStringArray(value)}::text[])`,
      );
    }
  }

  const whereSql = Prisma.join(filters, " AND ");
  const orderSql = buildOrderBy(spec.sort);
  const limit = clampLimit(spec.limit);

  // Build one composed Prisma.sql and hand it to $queryRaw(), rather than an
  // inline tagged template. `orderSql` embeds Prisma.raw fragments; nesting a
  // raw-bearing fragment inside a $queryRaw tagged template mis-numbers the
  // placeholders (Postgres then errors with "syntax error at or near $N").
  // Composing first and passing the object avoids that.
  const query = Prisma.sql`
    SELECT id, path, title, doc_status, doc_type, tags, frontmatter,
           created_at, updated_at
    FROM vault_documents
    WHERE ${whereSql}
    ${orderSql}
    LIMIT ${limit}
  `;
  return tx.$queryRaw<QueryRow[]>(query);
}

function escapeCell(s: string): string {
  // Keep table cells single-line and pipe-safe.
  return s.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function stripExt(p: string): string {
  return p.replace(/\.md$/i, "");
}

/** Value of one column for one row, as markdown. */
function cellValue(row: QueryRow, col: string): string {
  const key = col.toLowerCase();
  if (key === "item" || key === "title") {
    // Native wikilink so it stays clickable once rendered.
    return `[[${stripExt(row.path)}|${escapeCell(row.title)}]]`;
  }
  if (key === "status") return escapeCell(row.doc_status ?? "");
  if (key === "type") return escapeCell(row.doc_type ?? "");
  if (key === "path") return escapeCell(row.path);
  if (key === "tags") return escapeCell(row.tags.join(", "));
  if (key === "created") return escapeCell(row.created_at.toISOString().slice(0, 10));
  if (key === "updated") return escapeCell(row.updated_at.toISOString().slice(0, 10));
  // Otherwise a frontmatter field.
  const fm = row.frontmatter ?? {};
  const v = fm[col];
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return escapeCell(v.map(String).join(", "));
  return escapeCell(String(v));
}

function titleCase(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Render query rows to a markdown table or list per the spec. */
export function renderQueryResult(rows: QueryRow[], spec: QuerySpec): string {
  const cols = spec.columns?.length ? spec.columns : DEFAULT_COLUMNS;

  if (spec.as === "list") {
    if (rows.length === 0) return "_No matching notes._";
    return rows
      .map((r) => {
        const primary = cellValue(r, cols[0] ?? "title");
        const rest = cols
          .slice(1)
          .map((c) => cellValue(r, c))
          .filter((v) => v !== "")
          .join(" · ");
        return rest ? `- ${primary} — ${rest}` : `- ${primary}`;
      })
      .join("\n");
  }

  const header = `| ${cols.map(titleCase).join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  if (rows.length === 0) {
    return `${header}\n${sep}\n| ${cols.map(() => "").join(" | ")} |`;
  }
  const body = rows
    .map((r) => `| ${cols.map((c) => cellValue(r, c)).join(" | ")} |`)
    .join("\n");
  return `${header}\n${sep}\n${body}`;
}

/**
 * Replace every ```aju-query``` block in `content` with its resolved markdown.
 * Blocks are spliced back-to-front so earlier offsets stay valid. A bad block
 * (parse or query error) becomes an inline notice rather than failing the read.
 *
 * Display-only: callers pass the raw stored content and use the result purely
 * for rendering. The stored document is never modified here.
 */
export async function resolveDocumentContent(
  tx: Prisma.TransactionClient,
  brainIds: string[],
  content: string,
): Promise<string> {
  const blocks = findQueryBlocks(content);
  if (blocks.length === 0) return content;

  let out = content;
  for (const b of [...blocks].reverse()) {
    let replacement: string;
    if (b.error || !b.spec) {
      replacement = `> ⚠️ aju-query: ${b.error ?? "invalid query"}`;
    } else {
      try {
        const rows = await resolveQuery(tx, brainIds, b.spec);
        replacement = renderQueryResult(rows, b.spec);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        replacement = `> ⚠️ aju-query error: ${msg}`;
      }
    }
    out = out.slice(0, b.start) + replacement + out.slice(b.end);
  }
  return out;
}
