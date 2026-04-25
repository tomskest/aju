import { prisma } from "@/lib/db";
import { authedOrgRoute } from "@/lib/route-helpers";

type Params = { id: string };

/**
 * GET /api/orgs/[id]/members
 *
 * List members of the organization. Requires the caller to be a member of
 * the org (any role).
 */
export const GET = authedOrgRoute<Params>(
  async ({ organizationId }) => {
    const rows = await prisma.organizationMembership.findMany({
      where: { organizationId },
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return {
      members: rows.map((m) => ({
        userId: m.user.id,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        invitedAt: m.invitedAt,
        acceptedAt: m.acceptedAt,
      })),
    };
  },
  { orgIdParam: "id" },
);
