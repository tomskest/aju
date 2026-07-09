import type { Prisma } from "@prisma/client-tenant";

type TenantTx = Prisma.TransactionClient;

export interface SubdirectoryEntry {
  path: string;
  docCount: number;
}

// Root-level documents store "." as their directory (path.dirname).
const ROOT_DIRS = new Set(["", "."]);

/**
 * Derive the immediate child folders of `base` from stored directory values,
 * aggregating descendant doc counts per child. Pure — exported for tests.
 */
export function deriveSubdirectories(
  groups: Array<{ directory: string; count: number }>,
  base: string,
): SubdirectoryEntry[] {
  const prefix = base ? `${base}/` : "";
  const counts = new Map<string, number>();
  for (const g of groups) {
    if (ROOT_DIRS.has(g.directory)) continue;
    if (prefix && !g.directory.startsWith(prefix)) continue;
    const child = g.directory.slice(prefix.length).split("/")[0];
    if (!child) continue;
    const full = prefix + child;
    counts.set(full, (counts.get(full) ?? 0) + g.count);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, docCount]) => ({ path, docCount }));
}

/**
 * List the immediate subdirectories of `base` (already normalized; "" means
 * the brain root) with recursive document counts. Browse consumers surface
 * these as navigation hints — a folder that only contains subfolders would
 * otherwise look empty.
 */
export async function listSubdirectories(
  tx: TenantTx,
  brainId: string,
  base: string,
): Promise<SubdirectoryEntry[]> {
  const groups = await tx.vaultDocument.groupBy({
    by: ["directory"],
    where: {
      brainId,
      ...(base ? { directory: { startsWith: `${base}/` } } : {}),
    },
    _count: { _all: true },
  });
  return deriveSubdirectories(
    groups.map((g) => ({ directory: g.directory, count: g._count._all })),
    base,
  );
}
