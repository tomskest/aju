import { prisma } from "@/lib/db";
import { authedUserRoute } from "@/lib/route-helpers";

export const runtime = "nodejs";

/**
 * GET /api/me/access-requests
 *
 * Lists every access request the caller has ever filed, joined with the
 * target org's public identity fields. Caller must be signed in.
 */
export const GET = authedUserRoute(async ({ user }) => {
  const rows = await prisma.accessRequest.findMany({
    where: { requestingUserId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      organization: {
        select: { id: true, name: true, slug: true },
      },
    },
  });

  return {
    accessRequests: rows.map((r) => ({
      id: r.id,
      status: r.status,
      message: r.message,
      email: r.email,
      requestedRole: r.requestedRole,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt,
      organization: r.organization
        ? {
            id: r.organization.id,
            name: r.organization.name,
            slug: r.organization.slug,
          }
        : null,
    })),
  };
});
