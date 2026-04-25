import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { canManageOrg } from "@/lib/tenant";
import { PUBLIC_EMAIL_DOMAINS, getEmailDomain } from "@/lib/billing";
import { authedOrgRoute } from "@/lib/route-helpers";

export const runtime = "nodejs";

type Params = { id: string };

/**
 * GET /api/orgs/[id]/domains
 * Requires membership — returns all domain rows for the org.
 */
export const GET = authedOrgRoute<Params>(
  async ({ organizationId }) => {
    const domains = await prisma.organizationDomain.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
    });
    return { domains };
  },
  { orgIdParam: "id" },
);

/**
 * POST /api/orgs/[id]/domains  { domain }
 *
 * Claim a domain for an organization. Enforces:
 *   - caller is owner of the org
 *   - caller's email domain equals the claimed domain (email_match proof)
 *   - the domain is not on the public-mailbox blocklist
 *   - the domain is not already verified for another org
 */
export const POST = authedOrgRoute<Params>(
  async ({ req, organizationId, role, user }) => {
    const body = (await req.json().catch(() => ({}))) as { domain?: unknown };
    const rawDomain = typeof body.domain === "string" ? body.domain : "";
    const domain = rawDomain.trim().toLowerCase();
    if (!domain) {
      return NextResponse.json({ error: "invalid_domain" }, { status: 400 });
    }

    // Owner-only beyond the helper's admin gate.
    if (!canManageOrg(role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    if (PUBLIC_EMAIL_DOMAINS.has(domain)) {
      return NextResponse.json(
        { error: "public_email_domain" },
        { status: 400 },
      );
    }

    // Caller must actually own a mailbox at the domain being claimed.
    const userDomain = getEmailDomain(user.email);
    if (!userDomain || userDomain !== domain) {
      return NextResponse.json(
        { error: "email_domain_mismatch" },
        { status: 403 },
      );
    }

    // If another org has already verified this domain, give a friendly 409
    // before tripping the unique constraint.
    const existing = await prisma.organizationDomain.findUnique({
      where: { domain },
    });
    if (
      existing &&
      existing.verifiedAt &&
      existing.organizationId !== organizationId
    ) {
      return NextResponse.json(
        { error: "domain_already_claimed" },
        { status: 409 },
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
      return { domain: created };
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "P2002") {
        return NextResponse.json(
          { error: "domain_already_claimed" },
          { status: 409 },
        );
      }
      throw err;
    }
  },
  { orgIdParam: "id", minRole: "admin" },
);
