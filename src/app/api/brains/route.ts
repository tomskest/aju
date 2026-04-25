import { NextRequest, NextResponse } from "next/server";
import { authenticate, isAuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { withTenant } from "@/lib/tenant";
import { getActiveOrganizationId } from "@/lib/auth";
import { enforceBrainsLimit } from "@/lib/billing";

export const runtime = "nodejs";

const NAME_MAX_LEN = 64;

type CreatePayload = {
  name?: string;
  type?: string;
};

/**
 * Resolve the org id for an authenticated request. Key-pinned org wins;
 * un-pinned API keys fall back to the caller's personal org, then to the
 * active-org cookie for session-auth callers.
 */
async function resolveOrgId(
  auth: { userId?: string; organizationId?: string },
): Promise<string | null> {
  if (auth.organizationId) return auth.organizationId;
  if (auth.userId) {
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { personalOrgId: true },
    });
    if (user?.personalOrgId) return user.personalOrgId;
  }
  return getActiveOrganizationId();
}

/**
 * GET /api/brains
 *
 * List every brain the caller has BrainAccess for, with document count and
 * the caller's role. Ordered by createdAt asc so the default brain surfaces
 * first.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  if (isAuthError(auth)) return auth;

  if (!auth.userId) {
    // Env-var/legacy callers have no per-user access graph, so there's no
    // personal brain list to return. Keep the shape stable and empty.
    return NextResponse.json({ brains: [] });
  }

  const organizationId = await resolveOrgId(auth);
  if (!organizationId) {
    return NextResponse.json({ brains: [] });
  }

  return withTenant(
    { organizationId, userId: auth.userId, agentId: auth.agentId },
    async ({ tx }) => {
      // Agent keys filter by agentId; human keys by userId. Exactly one is
      // set on the authenticated principal.
      const accessWhere = auth.agentId
        ? { agentId: auth.agentId }
        : { userId: auth.userId };
      const access = await tx.brainAccess.findMany({
        where: accessWhere,
        include: {
          brain: {
            include: {
              _count: { select: { documents: true } },
            },
          },
        },
        orderBy: { brain: { createdAt: "asc" } },
      });

      const brains = access.map((a) => ({
        id: a.brain.id,
        name: a.brain.name,
        type: a.brain.type,
        documentCount: a.brain._count.documents,
        role: a.role,
        createdAt: a.brain.createdAt.toISOString(),
      }));

      return NextResponse.json({ brains });
    },
  );
}

/**
 * POST /api/brains
 *
 * Create a new brain owned by the caller inside their active org. The caller
 * receives a BrainAccess row with role=owner so the new brain shows up in
 * subsequent GETs.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (isAuthError(auth)) return auth;

  if (!auth.userId) {
    return NextResponse.json(
      { error: "brain creation requires a signed-in user" },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as CreatePayload;
  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  if (!rawName) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (rawName.length > NAME_MAX_LEN) {
    return NextResponse.json(
      { error: `name must be ${NAME_MAX_LEN} characters or fewer` },
      { status: 400 },
    );
  }

  const type =
    typeof body.type === "string" && body.type.trim() !== ""
      ? body.type.trim()
      : "personal";

  const organizationId = await resolveOrgId(auth);
  if (!organizationId) {
    return NextResponse.json(
      { error: "no_active_org" },
      { status: 400 },
    );
  }

  const userId = auth.userId;

  // Plan-limit gate: block a new brain if the caller has already hit their
  // cross-tenant cap. Check BEFORE the unscoped write so we don't create a
  // brain row we'd then need to roll back.
  const limitErr = await enforceBrainsLimit(userId);
  if (limitErr) return limitErr;

  // Create flow must be unscoped: the new brain id does not exist in the
  // caller's brain-access list yet, so RLS would block the INSERT.
  const created = await withTenant(
    { organizationId, userId, unscoped: true },
    async ({ tx }) => {
      const brain = await tx.brain.create({
        data: {
          name: rawName,
          type,
        },
        select: { id: true, name: true, type: true },
      });
      await tx.brainAccess.create({
        data: {
          brainId: brain.id,
          userId,
          role: "owner",
        },
      });
      return brain;
    },
  );

  return NextResponse.json({ brain: created }, { status: 201 });
}
