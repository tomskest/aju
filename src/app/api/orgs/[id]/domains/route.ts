import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentAuth } from "@/lib/auth";
import { canManageOrg, type OrgRole } from "@/lib/tenant";
import {
  PUBLIC_EMAIL_DOMAINS,
  getEmailDomain,
} from "@/lib/billing";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/orgs/[id]/domains
 * Requires membership — returns all domain rows for the org.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { id: organizationId } = await params;

  const auth = await currentAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (auth.agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_manage_orgs" },
      { status: 403 },
    );
  }
  const { user } = auth;

  const membership = await prisma.organizationMembership.findUnique({
    where: {
      organizationId_userId: { organizationId, userId: user.id },
    },
  });
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const domains = await prisma.organizationDomain.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ domains });
}

/**
 * POST /api/orgs/[id]/domains  { domain }
 *
 * Claim a domain for an organization. Enforces:
 *   - caller is owner of the org
 *   - caller's email domain equals the claimed domain (email_match proof)
 *   - the domain is not on the public-mailbox blocklist
 *   - the domain is not already verified for another org
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id: organizationId } = await params;

  const auth = await currentAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (auth.agentId) {
    return NextResponse.json(
      { error: "agent_principals_cannot_manage_orgs" },
      { status: 403 },
    );
  }
  const { user } = auth;

  const body = (await req.json().catch(() => ({}))) as { domain?: unknown };
  const rawDomain = typeof body.domain === "string" ? body.domain : "";
  const domain = rawDomain.trim().toLowerCase();
  if (!domain) {
    return NextResponse.json({ error: "invalid_domain" }, { status: 400 });
  }

  // Require owner role on the organization.
  const membership = await prisma.organizationMembership.findUnique({
    where: {
      organizationId_userId: { organizationId, userId: user.id },
    },
  });
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!canManageOrg(membership.role as OrgRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Block public / disposable mailbox providers.
  if (PUBLIC_EMAIL_DOMAINS.has(domain)) {
    return NextResponse.json(
      { error: "public_email_domain" },
      { status: 400 }
    );
  }

  // Caller must actually own a mailbox at the domain being claimed.
  const userDomain = getEmailDomain(user.email);
  if (!userDomain || userDomain !== domain) {
    return NextResponse.json(
      { error: "email_domain_mismatch" },
      { status: 403 }
    );
  }

  // If another org has already verified this domain, give a friendly 409
  // before tripping the unique constraint.
  const existing = await prisma.organizationDomain.findUnique({
    where: { domain },
  });
  if (existing && existing.verifiedAt && existing.organizationId !== organizationId) {
    return NextResponse.json(
      { error: "domain_already_claimed" },
      { status: 409 }
    );
  }

  try {
    const created = await prisma.organizationDomain.create({
      data: {
        organizationId,
        domain,
        verifiedAt: new Date(),
        verificationMethod: "email_match",
        claimedByUserId: user.id,
      },
    });
    return NextResponse.json({ domain: created });
  } catch (err) {
    // Unique-constraint fallback — race with another claim.
    const code = (err as { code?: string }).code;
    if (code === "P2002") {
      return NextResponse.json(
        { error: "domain_already_claimed" },
        { status: 409 }
      );
    }
    throw err;
  }
}
