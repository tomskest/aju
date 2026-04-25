import path from "path";

export interface ResolvedLink {
  linkText: string;
  targetPath: string;
}

export interface LinkResolutionResult {
  resolved: ResolvedLink[];
  unresolved: string[];
}

/**
 * Build a basename → path lookup map from all vault document paths.
 * If multiple documents share the same basename, that basename is marked ambiguous (set to null).
 */
export function buildBasenameMap(
  allPaths: string[]
): Map<string, string | null> {
  const map = new Map<string, string | null>();

  for (const p of allPaths) {
    const basename = path.basename(p, ".md");
    const normalized = basename.toLowerCase().replace(/-/g, " ");

    if (map.has(normalized)) {
      // Ambiguous — multiple docs share this basename
      map.set(normalized, null);
    } else {
      map.set(normalized, p);
    }
  }

  return map;
}

/**
 * Resolve an array of wikilink texts for a given source document.
 *
 * Resolution strategies (in order):
 * 1. Path-based — links containing `/` resolved relative to source directory
 * 2. Basename lookup — filename-only links matched against basename map
 * 3. Space/hyphen normalization — handles [[C Teleport]] vs C-Teleport.md
 *
 * Heading anchors (#Section) are stripped before resolution.
 */
export function resolveLinks(
  wikilinks: string[],
  sourcePath: string,
  allPathsSet: Set<string>,
  basenameMap: Map<string, string | null>
): LinkResolutionResult {
  const resolved: ResolvedLink[] = [];
  const unresolved: string[] = [];
  const sourceDir = path.dirname(sourcePath);

  for (const rawLink of wikilinks) {
    // Strip heading anchor (e.g., "File#Section" → "File")
    const linkWithoutAnchor = rawLink.split("#")[0].trim();
    if (!linkWithoutAnchor) {
      // Pure anchor link like [[#Section]] — skip
      continue;
    }

    let targetPath: string | null = null;

    // Strategy 1: Path-based resolution (link contains `/`)
    if (linkWithoutAnchor.includes("/")) {
      const candidate = linkWithoutAnchor.endsWith(".md")
        ? linkWithoutAnchor
        : linkWithoutAnchor + ".md";

      // Try as absolute vault path first
      if (allPathsSet.has(candidate)) {
        targetPath = candidate;
      } else {
        // Try relative to source directory
        const relative = path
          .join(sourceDir, candidate)
          .replace(/\\/g, "/");
        if (allPathsSet.has(relative)) {
          targetPath = relative;
        }
      }
    }

    // Strategy 2 & 3: Basename lookup with normalization
    if (!targetPath) {
      const normalized = linkWithoutAnchor
        .toLowerCase()
        .replace(/-/g, " ")
        .trim();

      const mapped = basenameMap.get(normalized);
      if (mapped) {
        // mapped is a path (non-null means unambiguous)
        targetPath = mapped;
      }
    }

    // Also try exact basename match without normalization
    if (!targetPath) {
      const exactBasename = linkWithoutAnchor.toLowerCase().trim();
      const mapped = basenameMap.get(exactBasename);
      if (mapped) {
        targetPath = mapped;
      }
    }

    // Also try with .md appended as exact path
    if (!targetPath) {
      const withMd = linkWithoutAnchor.endsWith(".md")
        ? linkWithoutAnchor
        : linkWithoutAnchor + ".md";
      if (allPathsSet.has(withMd)) {
        targetPath = withMd;
      }
    }

    if (targetPath && targetPath !== sourcePath) {
      resolved.push({ linkText: rawLink, targetPath });
    } else if (!targetPath) {
      unresolved.push(rawLink);
    }
  }

  return { resolved, unresolved };
}
