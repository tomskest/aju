import { setActiveOrganizationId } from "@/lib/auth";
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
