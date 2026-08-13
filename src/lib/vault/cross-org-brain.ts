import { prisma, tenantDbFor } from "@/lib/db";

/**
 * Cross-org brain resolution.
 *
 * `/app/brain/<name>/<path>` carries no organization, so the page can only
 * resolve the name inside whichever tenant the session's active org points
 * at. That org is re-pinned to the caller's personal workspace on every
 * login, so a link shared between teammates routinely lands in the wrong
 * tenant and 404s even though the reader has full access to the brain.
 *
 * This module answers "which of the caller's other orgs holds a brain by
 * this name, and can they read it?" so the page can switch the session over
 * instead of giving up.
 */

export type CrossOrgBrainMatch = {
  organizationId: string;
  brainId: string;
  brainName: string;
  role: string;
};

/**
 * Effective role on a brain: an explicit BrainAccess row wins, and members
 * of the owning org get implicit editor on `type: "org"` brains. Mirrors the
 * gate in the brain page, the brains rail, and GET /api/brains, kept as a
 * pure function so all four agree on what "no access" means.
 */
export function brainRoleFor(
  explicitRole: string | null | undefined,
  brainType: string,
  isOrgMember: boolean,
): string | null {
  if (explicitRole) return explicitRole;
  if (brainType === "org" && isOrgMember) return "editor";
  return null;
}

/**
 * Build the app path for a brain document. Segments are encoded
 * individually so a `/` inside a doc path stays a path separator while a
 * `?` or `#` in a title doesn't truncate the URL.
 *
 * `switched` marks a load that already followed an org switch; the page
 * uses it to stop searching, so a brain that stays unresolvable can't
 * bounce the browser in a loop.
 */
export function brainPagePath(
  brainName: string,
  docPath: string | null,
  opts: { switched?: boolean } = {},
): string {
  const segments = [
    "app",
    "brain",
    encodeURIComponent(brainName),
    ...(docPath
      ? docPath.split("/").filter(Boolean).map(encodeURIComponent)
      : []),
  ];
  const path = `/${segments.join("/")}`;
  return opts.switched ? `${path}?switched=1` : path;
}

/**
 * Search the caller's other organizations for a readable brain of this
 * name, oldest membership first. Returns the first match, or null when no
 * other org holds one they can read.
 *
 * Each org is a separate database, so this opens one tenant client per
 * membership. It only runs on the miss path, after the active org has
 * already been checked and come up empty, and users belong to a handful of
 * orgs, not hundreds.
 */
export async function findBrainInOtherOrgs(
  userId: string,
  brainName: string,
  excludeOrganizationId: string | null,
): Promise<CrossOrgBrainMatch | null> {
  const memberships = await prisma.organizationMembership.findMany({
    where: {
      userId,
      ...(excludeOrganizationId
        ? { NOT: { organizationId: excludeOrganizationId } }
        : {}),
    },
    select: { organizationId: true },
    orderBy: { createdAt: "asc" },
  });

  for (const { organizationId } of memberships) {
    try {
      const tenant = await tenantDbFor(organizationId);

      const brain = await tenant.brain.findFirst({
        where: { name: brainName },
        select: { id: true, name: true, type: true },
      });
      if (!brain) continue;

      const access = await tenant.brainAccess.findUnique({
        where: { brainId_userId: { brainId: brain.id, userId } },
        select: { role: true },
      });

      // Org membership is established by the loop itself, so an org brain
      // resolves to implicit editor here.
      const role = brainRoleFor(access?.role ?? null, brain.type, true);
      if (!role) continue;

      return {
        organizationId,
        brainId: brain.id,
        brainName: brain.name,
        role,
      };
    } catch {
      // Suspended, archived, still-provisioning, or drifted tenants must
      // not sink the search, so skip and keep looking. Same posture as the
      // org console's brain counter.
      continue;
    }
  }

  return null;
}
