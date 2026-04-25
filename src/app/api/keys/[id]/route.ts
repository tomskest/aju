import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentAuth } from "@/lib/auth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

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
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const auth = await currentAuth(req);
  if (!auth) return unauthorized();
  if (auth.agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_revoke_keys" },
      { status: 403 },
    );
  }
  const { user } = auth;

  const { id } = await ctx.params;
  if (!id) return notFound();

  const key = await prisma.apiKey.findFirst({
    where: { id, userId: user.id },
    select: { id: true, revokedAt: true },
  });
  if (!key) return notFound();

  if (!key.revokedAt) {
    await prisma.apiKey.update({
      where: { id: key.id },
      data: { revokedAt: new Date() },
    });
  }

  return new NextResponse(null, { status: 204 });
}
