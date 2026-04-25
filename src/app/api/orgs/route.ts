import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma, tenantDbFor } from "@/lib/db";
import { provisionTenant } from "@/lib/tenant";
import { currentAuth } from "@/lib/auth";
import { slugify } from "@/lib/tenant";

export const runtime = "nodejs";

const SLUG_RETRY_LIMIT = 3;

/** 6-char base36 random suffix for slug uniqueness — mirrors verify/route.ts. */
function shortId(): string {
  let s = "";
  while (s.length < 6) {
    s += Math.random().toString(36).slice(2);
  }
  return s.slice(0, 6);
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * GET /api/orgs
 *
 * List all orgs the current user belongs to, enriched with member + brain
 * counts and the caller's role. Also returns the `activeOrganizationId` so a
 * single round-trip can rehydrate the org switcher.
 */
export async function GET(req: NextRequest) {
  const auth = await currentAuth(req);
  if (!auth) return unauthorized();
  if (auth.agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_manage_orgs" },
      { status: 403 },
    );
  }
  const { user } = auth;

  const memberships = await prisma.organizationMembership.findMany({
    where: { userId: user.id },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          isPersonal: true,
          _count: {
            select: {
              memberships: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // Brain rows live in each org's per-tenant DB. Fetch counts in parallel;
  // a tenant that's still provisioning / unreachable shows 0 rather than
  // failing the whole listing.
  const brainCounts = await Promise.all(
    memberships.map(async (m) => {
      try {
        const tenant = await tenantDbFor(m.organization.id);
        return await tenant.brain.count();
      } catch (err) {
        console.error(
          `[orgs] brain count failed for ${m.organization.id}:`,
          err,
        );
        return 0;
      }
    }),
  );

  const orgs = memberships.map((m, i) => ({
    id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
    isPersonal: m.organization.isPersonal,
    role: m.role,
    memberCount: m.organization._count.memberships,
    brainCount: brainCounts[i],
  }));

  const activeOrganizationId = auth.organizationId;

  return NextResponse.json({ orgs, activeOrganizationId });
}

type CreateOrgPayload = {
  name?: string;
};

/**
 * POST /api/orgs
 *
 * Create a new team org and make the caller the owner. Slug is derived from
 * the name plus a 6-char suffix, with a small retry loop on collision.
 */
export async function POST(req: NextRequest) {
  const auth = await currentAuth(req);
  if (!auth) return unauthorized();
  if (auth.agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_manage_orgs" },
      { status: 403 },
    );
  }
  const { user } = auth;

  const body = (await req.json().catch(() => ({}))) as CreateOrgPayload;
  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  if (!rawName) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (rawName.length > 120) {
    return NextResponse.json({ error: "name too long" }, { status: 400 });
  }

  const baseSlug = slugify(rawName) || "org";

  let org: { id: string; name: string; slug: string } | null = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < SLUG_RETRY_LIMIT; attempt++) {
    const candidate = `${baseSlug}-${shortId()}`;
    try {
      org = await prisma.$transaction(async (tx) => {
        const created = await tx.organization.create({
          data: {
            name: rawName,
            slug: candidate,
            isPersonal: false,
            ownerUserId: user.id,
            planTier: "beta_legacy",
          },
          select: { id: true, name: true, slug: true },
        });
        await tx.organizationMembership.create({
          data: {
            organizationId: created.id,
            userId: user.id,
            role: "owner",
            acceptedAt: new Date(),
          },
        });
        return created;
      });
      break;
    } catch (err) {
      lastErr = err;
      const code = (err as Prisma.PrismaClientKnownRequestError | null)?.code;
      if (code !== "P2002") throw err;
    }
  }

  if (!org) {
    console.error("Org slug allocation failed:", lastErr);
    return NextResponse.json(
      { error: "could not allocate slug" },
      { status: 500 },
    );
  }

  // Provision the per-tenant DB immediately after the control-plane org +
  // membership commit. `provisionTenant` opens its own connections (Neon
  // API + direct DSN) so it must run OUTSIDE the prisma.$transaction above.
  // Bubble the error on failure — a half-provisioned org is worse than a
  // retryable 500, and the caller can retry on the same org id because
  // provisionTenant is idempotent.
  await provisionTenant(org.id);

  return NextResponse.json(
    {
      org: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        role: "owner" as const,
      },
    },
    { status: 201 },
  );
}
