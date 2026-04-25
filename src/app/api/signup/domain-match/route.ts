import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import {
  PUBLIC_EMAIL_DOMAINS,
  getEmailDomain,
} from "@/lib/billing";
import { normalizeEmail } from "@/lib/validators";

export const runtime = "nodejs";

/**
 * GET /api/signup/domain-match?email=<email>
 *
 * Post-magic-link helper: tells the /app/join prompt whether the caller's
 * email belongs to an existing verified org domain. Requires a session, and
 * the `email` query param must match the session user's email (case-
 * insensitive) so this endpoint can't be used to probe other addresses.
 *
 * Public mailbox domains (gmail, outlook, etc.) always return `{ match: null }`.
 */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const email = normalizeEmail(req.nextUrl.searchParams.get("email"));
  if (!email) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  // User row email is already normalized at signup time. The query email is
  // normalized above. Direct equality is now case-safe.
  const sessionEmail = normalizeEmail(user.email);
  if (sessionEmail !== email) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const domain = getEmailDomain(email);
  if (!domain) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  if (PUBLIC_EMAIL_DOMAINS.has(domain)) {
    return NextResponse.json({ match: null });
  }

  const orgDomain = await prisma.organizationDomain.findFirst({
    where: {
      domain,
      verifiedAt: { not: null },
    },
    include: { organization: true },
  });

  if (!orgDomain || !orgDomain.organization) {
    return NextResponse.json({ match: null });
  }

  const memberCount = await prisma.organizationMembership.count({
    where: { organizationId: orgDomain.organization.id },
  });

  return NextResponse.json({
    match: {
      organization: {
        id: orgDomain.organization.id,
        name: orgDomain.organization.name,
        slug: orgDomain.organization.slug,
        memberCount,
      },
    },
  });
}
