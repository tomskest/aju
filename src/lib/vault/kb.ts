import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export const KB_CONTENT_ROOT = path.join(process.cwd(), "kb");
export const KB_GITHUB_URL = "https://github.com/tomskest/aju";

export type KbArticleMeta = {
  /** Section folder slug with numeric prefix stripped, e.g. "overview". */
  sectionSlug: string;
  /** File slug without extension. */
  fileSlug: string;
  /** Title from frontmatter, or a humanized filename fallback. */
  title: string;
  /** Optional short description from frontmatter. */
  description?: string;
  /** Order within the section (smaller = earlier). */
  order: number;
  /** Original filename (without extension). */
  fileName: string;
};

export type KbSection = {
  /** Folder name on disk, e.g. "01-overview". */
  folderName: string;
  /** Slug with numeric prefix stripped. */
  slug: string;
  /** Numeric prefix used for ordering sections. */
  order: number;
  /** Humanized title derived from the folder slug. */
  title: string;
  articles: KbArticleMeta[];
};

export type KbTree = KbSection[];

type Frontmatter = {
  title?: unknown;
  description?: unknown;
  order?: unknown;
};

function stripNumericPrefix(name: string): { prefix: number; rest: string } {
  const match = name.match(/^(\d+)[-_](.*)$/);
  if (!match) return { prefix: Number.POSITIVE_INFINITY, rest: name };
  return { prefix: parseInt(match[1]!, 10), rest: match[2]! };
}

function humanize(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readArticleMeta(
  sectionSlug: string,
  sectionDir: string,
  fileName: string,
): Promise<KbArticleMeta | null> {
  if (!fileName.endsWith(".md")) return null;
  const fullPath = path.join(sectionDir, fileName);
  let raw: string;
  try {
    raw = await fs.readFile(fullPath, "utf8");
  } catch {
    return null;
  }
  const parsed = matter(raw);
  const fm = (parsed.data ?? {}) as Frontmatter;
  const fileSlug = fileName.replace(/\.md$/, "");
  const title =
    typeof fm.title === "string" && fm.title.trim()
      ? fm.title.trim()
      : humanize(fileSlug === "index" ? sectionSlug : fileSlug);
  const description =
    typeof fm.description === "string" && fm.description.trim()
      ? fm.description.trim()
      : undefined;
  const order =
    typeof fm.order === "number" && Number.isFinite(fm.order)
      ? fm.order
      : Number.POSITIVE_INFINITY;
  return {
    sectionSlug,
    fileSlug,
    title,
    description,
    order,
    fileName: fileSlug,
  };
}

export async function readKbTree(): Promise<KbTree> {
  if (!(await pathExists(KB_CONTENT_ROOT))) return [];
  let entries: string[];
  try {
    entries = await fs.readdir(KB_CONTENT_ROOT);
  } catch {
    return [];
  }

  const sections: KbSection[] = [];
  for (const folderName of entries) {
    const full = path.join(KB_CONTENT_ROOT, folderName);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const { prefix, rest } = stripNumericPrefix(folderName);
    const slug = rest.toLowerCase();
    let fileEntries: string[];
    try {
      fileEntries = await fs.readdir(full);
    } catch {
      fileEntries = [];
    }
    const articleMetas = await Promise.all(
      fileEntries.map((fn) => readArticleMeta(slug, full, fn)),
    );
    const articles = articleMetas
      .filter((a): a is KbArticleMeta => a !== null)
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return a.fileName.localeCompare(b.fileName);
      });

    sections.push({
      folderName,
      slug,
      order: prefix,
      title: humanize(slug || folderName),
      articles,
    });
  }

  sections.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.folderName.localeCompare(b.folderName);
  });

  return sections;
}

export type KbArticle = {
  meta: KbArticleMeta;
  /** Raw markdown body with frontmatter stripped. */
  body: string;
};

/** Resolve a (sectionSlug, fileSlug) pair to the on-disk folder name. */
async function resolveSectionFolder(
  sectionSlug: string,
): Promise<string | null> {
  if (!(await pathExists(KB_CONTENT_ROOT))) return null;
  let entries: string[];
  try {
    entries = await fs.readdir(KB_CONTENT_ROOT);
  } catch {
    return null;
  }
  for (const folderName of entries) {
    const { rest } = stripNumericPrefix(folderName);
    if (rest.toLowerCase() === sectionSlug.toLowerCase()) {
      const full = path.join(KB_CONTENT_ROOT, folderName);
      const stat = await fs.stat(full).catch(() => null);
      if (stat?.isDirectory()) return folderName;
    }
  }
  return null;
}

export async function readKbArticle(
  sectionSlug: string,
  fileSlug: string,
): Promise<KbArticle | null> {
  const folderName = await resolveSectionFolder(sectionSlug);
  if (!folderName) return null;
  // Defend against path traversal.
  if (fileSlug.includes("/") || fileSlug.includes("..")) return null;
  const fullPath = path.join(
    KB_CONTENT_ROOT,
    folderName,
    `${fileSlug}.md`,
  );
  let raw: string;
  try {
    raw = await fs.readFile(fullPath, "utf8");
  } catch {
    return null;
  }
  const parsed = matter(raw);
  const fm = (parsed.data ?? {}) as Frontmatter;
  const title =
    typeof fm.title === "string" && fm.title.trim()
      ? fm.title.trim()
      : humanize(fileSlug === "index" ? sectionSlug : fileSlug);
  const description =
    typeof fm.description === "string" && fm.description.trim()
      ? fm.description.trim()
      : undefined;
  const order =
    typeof fm.order === "number" && Number.isFinite(fm.order)
      ? fm.order
      : Number.POSITIVE_INFINITY;

  return {
    meta: {
      sectionSlug,
      fileSlug,
      title,
      description,
      order,
      fileName: fileSlug,
    },
    body: parsed.content,
  };
}
