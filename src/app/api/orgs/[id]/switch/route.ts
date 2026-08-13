import { NextRequest, NextResponse } from "next/server";
import {
  appRedirect,
  currentUser,
  safeReturnToPath,
  setActiveOrganizationId,
} from "@/lib/auth";
import { prisma } from "@/lib/db";
import { authedOrgRoute } from "@/lib/route-helpers";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * POST /api/orgs/[id]/switch
 *
 * Pin the active org cookie for the caller's session. The helper handles
 * the membership check (404-via-403 — we can't selectively 404 here without
 * another lookup, but the membership requirement still holds).
 *
 * Bearer-token callers (CLI/MCP) don't have a browser session; their active
 * org is pinned on the API key itself. We still accept the request and return
 * the target org id so the caller gets a uniform response shape, but we skip
 * the cookie write entirely.
 */
export const POST = authedOrgRoute<Params>(
  async ({ organizationId, apiKeyId }) => {
    if (!apiKeyId) {
      await setActiveOrganizationId(organizationId);
    }
    return { activeOrganizationId: organizationId };
  },
  { orgIdParam: "id" },
);

/**
 * GET /api/orgs/[id]/switch?return_to=/app/...
 *
 * Navigation variant of the POST: pin the active org, then bounce the
 * browser to `return_to`. It exists because a Server Component cannot write
 * cookies while rendering, so the brain page needs a route handler to flip
 * the session before a cross-org deep link can resolve.
 *
 * `return_to` must be a same-origin path, and the switch is limited to orgs
 * the caller already belongs to. The session cookie is SameSite=Lax, so a
 * cross-site subresource can't reach this at all; the remaining vector is a
 * top-level navigation, which is the flow being supported and is visible in
 * the UI the moment it happens.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<Params> },
): Promise<NextResponse> {
  const { id: organizationId } = await ctx.params;
  const destination =
    safeReturnToPath(req.nextUrl.searchParams.get("return_to")) ?? "/app";

  const user = await currentUser();
  if (!user) {
    return appRedirect(req, `/?return_to=${encodeURIComponent(destination)}`);
  }

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId },
    select: { organizationId: true },
  });
  if (!membership) {
    return new NextResponse("Not found", { status: 404 });
  }

  await setActiveOrganizationId(membership.organizationId);
  return appRedirect(req, destination);
}
