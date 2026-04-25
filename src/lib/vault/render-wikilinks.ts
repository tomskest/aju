import path from "path";
import { buildBasenameMap } from "./link-resolver";

/**
 * Replace `[[wikilink]]` markers in markdown source with regular markdown
 * links (`[display](resolved-href)`) so the marked renderer turns them
 * into `<a>` tags automatically. Resolution mirrors `link-resolver`'s
 * algorithm: path-form first, then case-insensitive basename lookup with
 * hyphen↔space normalization.
 *
 * Used by the in-app brain explorer to make wikilinks clickable. Unresolved
 * links resolve to a `?missing=<name>` URL that the client component can
 * style differently (Obsidian-style "dangling" link, brain explorer can
 * offer "create this doc" on click).
 */
export function resolveWikilinksToMarkdown(
  source: string,
  knownPaths: string[],
  brainName: string,
  sourcePath: string,
): string {
  const allPathsSet = new Set(knownPaths);
  const basenameMap = buildBasenameMap(knownPaths);
  const sourceDir = path.dirname(sourcePath);

  return source.replace(
    /\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g,
    (_, rawTarget: string, rawDisplay: string | undefined) => {
      const target = rawTarget.trim();
      const display = (rawDisplay ?? rawTarget).trim();
      const [linkPart] = target.split("#");
      const linkBody = linkPart.trim();
      if (!linkBody) return display;

      // Path-form (contains `/`): resolve relative to source's directory
      // first, then absolute from vault root.
      let resolvedPath: string | null = null;
      if (linkBody.includes("/")) {
        const candidates = [
          normalizePath(path.join(sourceDir, linkBody) + ".md"),
          normalizePath(path.join(sourceDir, linkBody)),
          normalizePath(linkBody + ".md"),
          normalizePath(linkBody),
        ];
        for (const c of candidates) {
          if (allPathsSet.has(c)) {
            resolvedPath = c;
            break;
          }
        }
      } else {
        // Basename lookup: lower + hyphens→spaces
        const normalized = linkBody.toLowerCase().replace(/-/g, " ");
        const hit = basenameMap.get(normalized);
        if (hit) resolvedPath = hit;
      }

      const encoded = encodeURIComponent(linkBody);
      const href = resolvedPath
        ? `/app/brain/${encodeURIComponent(brainName)}/${encodePath(resolvedPath)}`
        : `/app/brain/${encodeURIComponent(brainName)}?missing=${encoded}`;
      const cls = resolvedPath ? "wikilink" : "wikilink wikilink-missing";
      // Markdown link with explicit class hint via title attribute fallback.
      // marked doesn't render classes from markdown, so we emit raw HTML.
      return `<a href="${href}" class="${cls}">${escapeHtml(display)}</a>`;
    },
  );
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

function encodePath(p: string): string {
  return p
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
