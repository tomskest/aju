import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authedUserRoute } from "@/lib/route-helpers";
import { clientIp, recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

/**
 * DELETE /api/keys/[id]
 *
 * Soft-delete via `revokedAt` so the audit trail (who created what, when)
 * survives a revoke. A second revoke is idempotent — we still return 204 so
 * retries don't error. 404s for keys belonging to other users to avoid
 * disclosing existence.
 */
export const DELETE = authedUserRoute<{ id: string }>(
  async ({ req, user, agentId, apiKeyId, params }) => {
    if (agentId) {
      return NextResponse.json(
        { error: "agent_principals_cannot_revoke_keys" },
        { status: 403 },
      );
    }

    const { id } = params;
    if (!id) return notFound();

    const key = await prisma.apiKey.findFirst({
      where: { id, userId: user.id },
      select: { id: true, revokedAt: true, organizationId: true, name: true },
    });
    if (!key) return notFound();

    if (!key.revokedAt) {
      await prisma.apiKey.update({
        where: { id: key.id },
        data: { revokedAt: new Date() },
      });

      await recordAudit(prisma, {
        eventType: "key.revoked",
        actorUserId: user.id,
        actorApiKeyId: apiKeyId ?? null,
        organizationId: key.organizationId ?? null,
        resourceType: "apikey",
        resourceId: key.id,
        changes: { name: key.name },
        ipAddress: clientIp(req),
      });
    }

    return new NextResponse(null, { status: 204 });
  },
);
