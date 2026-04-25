import matter from "gray-matter";
import { createHash } from "crypto";
import path from "path";

export interface ParsedDocument {
  title: string;
  frontmatter: Record<string, unknown> | null;
  docType: string | null;
  docStatus: string | null;
  tags: string[];
  content: string;
  contentHash: string;
  wordCount: number;
  directory: string;
  section: string;
  wikilinks: string[];
}

const WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

export function parseDocument(
  rawContent: string,
  filePath: string
): ParsedDocument {
  const { data: frontmatter, content: body } = matter(rawContent);
  const hasFrontmatter = Object.keys(frontmatter).length > 0;

  // Title: first H1, or frontmatter title, or filename
  const h1Match = body.match(/^#\s+(.+)$/m);
  const title =
    h1Match?.[1] ||
    (frontmatter.title as string) ||
    path.basename(filePath, ".md");

  // Normalize the path to use forward slashes
  const normalizedPath = filePath.replace(/\\/g, "/");
  const directory = path.dirname(normalizedPath).replace(/\\/g, "/");

  // Section is the top-level directory (e.g., "06-Sales")
  const parts = normalizedPath.split("/");
  const section = parts[0] || "";

  // Extract wikilinks
  const wikilinks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = WIKILINK_REGEX.exec(rawContent)) !== null) {
    wikilinks.push(match[1].trim());
  }

  // Tags from frontmatter
  const tags: string[] = Array.isArray(frontmatter.tags)
    ? frontmatter.tags.map(String)
    : [];

  // Word count (body only, no frontmatter)
  const wordCount = body
    .replace(/[#*\-_|`>\[\](){}]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0).length;

  // Content hash
  const contentHash = createHash("sha256").update(rawContent).digest("hex");

  return {
    title,
    frontmatter: hasFrontmatter ? frontmatter : null,
    docType: (frontmatter.type as string) || null,
    docStatus: (frontmatter.status as string) || null,
    tags,
    content: rawContent,
    contentHash,
    wordCount,
    directory,
    section,
    wikilinks: [...new Set(wikilinks)],
  };
}

export function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
