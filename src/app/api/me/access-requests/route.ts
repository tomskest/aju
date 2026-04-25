import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentAuth } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/me/access-requests
 *
 * Lists every access request the caller has ever filed, joined with the
 * target org's public identity fields. Caller must be signed in.
 */
export async function GET(req: NextRequest) {
  const auth = await currentAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { user } = auth;

  const rows = await prisma.accessRequest.findMany({
    where: { requestingUserId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      organization: {
        select: { id: true, name: true, slug: true },
      },
    },
  });

  const accessRequests = rows.map((r) => ({
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
  }));

  return NextResponse.json({ accessRequests });
}
