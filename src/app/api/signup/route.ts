import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyTurnstile } from "@/lib/turnstile";
import { generateToken } from "@/lib/auth";
import { sendEmail, magicLinkEmail } from "@/lib/email";
import {
  isPublicEmailDomain,
  getEmailDomain,
} from "@/lib/billing";
import { normalizeEmail } from "@/lib/validators";

export const runtime = "nodejs";

const COHORT_CAP = 100;
const VERIFICATION_TTL_MIN = 30;

type Payload = {
  email?: string;
  turnstileToken?: string;
  returnTo?: string;
};

function badRequest(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

/**
 * Same-origin guard for return URLs. Only absolute-path URLs ("/foo") are
 * accepted — anything with a scheme or a protocol-relative prefix is rejected.
 */
function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null;
  if (raw.startsWith("/\\")) return null;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  return raw;
}

/**
 * Best-effort domain → org match. Never throws — on any DB hiccup we just
 * return null and fall back to the normal magic-link flow.
 */
async function matchOrgByEmailDomain(email: string): Promise<string | null> {
  if (isPublicEmailDomain(email)) return null;
  const domain = getEmailDomain(email);
  if (!domain) return null;

  try {
    const match = await prisma.organizationDomain.findFirst({
      where: { domain, verifiedAt: { not: null } },
      select: { organization: { select: { slug: true } } },
    });
    return match?.organization?.slug ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Payload;
  const email = normalizeEmail(body.email);
  const turnstileToken = body.turnstileToken;
  const returnTo = safeReturnTo(body.returnTo);

  if (!email) return badRequest("invalid email");

  const remoteIp = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const turnstile = await verifyTurnstile(turnstileToken, remoteIp);
  if (!turnstile.ok) {
    return NextResponse.json({ error: "turnstile_failed", detail: turnstile.error }, { status: 400 });
  }

  // If cohort is already full and this email isn't already a grandfathered user,
  // add them to the waitlist and short-circuit — no magic link, just confirmation.
  const [grandfatheredCount, existingUser] = await Promise.all([
    prisma.user.count({ where: { grandfatheredAt: { not: null } } }),
    prisma.user.findUnique({ where: { email } }),
  ]);

  if (!existingUser && grandfatheredCount >= COHORT_CAP) {
    await prisma.waitlistEntry.upsert({
      where: { email },
      create: { email, source: "landing" },
      update: {},
    });
    return NextResponse.json({ status: "waitlisted" });
  }

  // Best-effort: if this email's domain is already claimed by a verified org,
  // forward the match slug through the magic link so /api/verify can route
  // the user to /app/join after grandfather.
  const matchedOrgSlug = await matchOrgByEmailDomain(email);

  // Fresh magic-link token. Verification.identifier holds the email so verify can look up.
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MIN * 60 * 1000);
  await prisma.verification.create({
    data: {
      id: generateToken(16),
      identifier: email,
      value: token,
      expiresAt,
    },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://aju.sh";
  const params = new URLSearchParams({ token });
  if (returnTo) params.set("return_to", returnTo);
  if (matchedOrgSlug) params.set("matched_org", matchedOrgSlug);
  const link = `${appUrl}/api/verify?${params.toString()}`;
  await sendEmail(magicLinkEmail(email, link));

  // Response shape intentionally unchanged — the match slug is invisible to
  // the signup form and only surfaces after verify redirects to /app/join.
  return NextResponse.json({ status: "sent" });
}
