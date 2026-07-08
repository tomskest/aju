import { redirect } from "next/navigation";
import { currentUser, getActiveOrganizationId } from "@/lib/auth";
import { prisma, tenantDbFor } from "@/lib/db";
import { withBrainContext } from "@/lib/tenant";
import BrainsRail, {
  type BrainRailItem,
} from "@/components/app/BrainsRail";

export const dynamic = "force-dynamic";

/**
 * Brain area layout — leftmost column is the brains rail (every brain the
 * user can access in the active org), right-side is the brain explorer
 * (children).
 *
 * Loading the rail server-side keeps the active state immediate on
 * first paint and avoids a client roundtrip.
 */
export default async function BrainAreaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  if (!user) redirect("/");

  const organizationId = await getActiveOrganizationId();
  if (!organizationId) redirect("/app/console");

  const tenant = await tenantDbFor(organizationId);

  const accessRows = await tenant.brainAccess.findMany({
    where: { userId: user.id },
    include: { brain: { select: { id: true, name: true, type: true } } },
    orderBy: { createdAt: "asc" },
  });

  type RailRow = {
    brain: { id: string; name: string; type: string };
    role: string;
  };
  const rows: RailRow[] = accessRows.map((r) => ({
    brain: r.brain,
    role: r.role,
  }));

  // Org-fallback: members get implicit editor access to every `type: "org"`
  // brain, mirroring GET /api/brains and the console listing. Without this
  // the rail hides org brains from members who lack an explicit row.
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId },
    select: { id: true },
  });
  if (membership) {
    const seen = new Set(rows.map((r) => r.brain.id));
    const orgBrains = await tenant.brain.findMany({
      where: { type: "org" },
      select: { id: true, name: true, type: true },
      orderBy: { createdAt: "asc" },
    });
    for (const b of orgBrains) {
      if (seen.has(b.id)) continue;
      rows.push({ brain: b, role: "editor" });
    }
  }

  // Doc count per brain — single grouped query, RLS scoped to the
  // accessible set so we don't leak counts for brains the user shouldn't
  // see.
  const brainIds = rows.map((r) => r.brain.id);
  const counts = brainIds.length
    ? await withBrainContext(tenant, brainIds, async (tx) => {
        return tx.vaultDocument.groupBy({
          by: ["brainId"],
          where: { brainId: { in: brainIds } },
          _count: { _all: true },
        });
      })
    : [];

  const countByBrain = new Map<string, number>();
  for (const row of counts) {
    countByBrain.set(row.brainId, row._count._all);
  }

  const items: BrainRailItem[] = rows.map((r) => ({
    name: r.brain.name,
    type: r.brain.type,
    role: r.role,
    docCount: countByBrain.get(r.brain.id) ?? 0,
  }));

  return (
    <div className="flex">
      <BrainsRail items={items} canCreate />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
