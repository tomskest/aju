import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  currentUser,
  generateToken,
  getActiveOrganizationId,
} from "@/lib/auth";
import { generateApiKey } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { canManageMembers, type OrgRole } from "@/lib/tenant";

export const runtime = "nodejs";

type Payload = {
  user_code?: string;
  deny?: boolean;
};

function shortUserAgentHint(ua: string | null): string {
  if (!ua) return "CLI";
  const lower = ua.toLowerCase();
  if (lower.includes("mac os") || lower.includes("macintosh") || lower.includes("darwin")) {
    return "CLI on macOS";
  }
  if (lower.includes("windows")) return "CLI on Windows";
  if (lower.includes("linux")) return "CLI on Linux";
  return "CLI";
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Payload;
  const userCode = body.user_code?.trim().toUpperCase();
  const deny = body.deny === true;

  if (!userCode) {
    return NextResponse.json({ error: "missing_code" }, { status: 400 });
  }

  const row = await prisma.deviceCode.findUnique({
    where: { userCode },
  });

  if (!row) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  if (row.expiresAt < new Date()) {
    await prisma.deviceCode.delete({ where: { id: row.id } }).catch(() => {});
    return NextResponse.json({ error: "expired" }, { status: 400 });
  }

  if (row.status !== "pending") {
    return NextResponse.json({ error: "already_resolved" }, { status: 400 });
  }

  if (deny) {
    await prisma.deviceCode.update({
      where: { id: row.id },
      data: { status: "denied" },
    });
    return NextResponse.json({ ok: true });
  }

  const keyName = shortUserAgentHint(req.headers.get("user-agent"));

  // Agent-provisioning flow: mint a key scoped to an agent the approver
  // manages in their active org. Gated on owner/admin membership and agent
  // existence — same rules as POST /api/agents/[id]/keys.
  if (row.intent === "agent") {
    if (!row.agentName) {
      return NextResponse.json(
        { error: "device_code_missing_agent_name" },
        { status: 500 },
      );
    }

    const organizationId = await getActiveOrganizationId();
    if (!organizationId) {
      return NextResponse.json({ error: "no_active_org" }, { status: 400 });
    }

    const membership = await prisma.organizationMembership.findFirst({
      where: { userId: user.id, organizationId },
      select: { role: true },
    });
    if (!membership) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (!canManageMembers(membership.role as OrgRole)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const targetName = row.agentName;
    const agent = await withTenant(
      { organizationId, userId: user.id, unscoped: true },
      async ({ tx }) =>
        tx.agent.findFirst({
          where: { name: targetName },
          select: { id: true, name: true, status: true },
        }),
    );
    if (!agent) {
      return NextResponse.json(
        { error: `agent_not_found: ${row.agentName}` },
        { status: 404 },
      );
    }
    if (agent.status === "revoked") {
      return NextResponse.json({ error: "agent_revoked" }, { status: 400 });
    }

    const { plaintext, prefix, hash } = generateApiKey();

    const apiKey = await prisma.apiKey.create({
      data: {
        id: generateToken(16),
        prefix,
        hash,
        name: keyName,
        userId: user.id,
        agentId: agent.id,
        organizationId,
        scopes: ["read", "write"],
      },
    });

    await prisma.deviceCode.update({
      where: { id: row.id },
      data: {
        status: "approved",
        approvedByUserId: user.id,
        apiKeyId: apiKey.id,
        apiKeyPlaintext: plaintext,
        agentId: agent.id,
        organizationId,
      },
    });

    return NextResponse.json({ ok: true });
  }

  // User flow: mint a personal "device" key for the approver.
  //
  // Device keys carry the full scope set (incl. admin) — they represent the
  // approver's interactive CLI session, equivalent in authority to their web
  // login. The post-approval CLI uses this admin scope to mint per-org child
  // keys (one profile per org) without a second device-flow round-trip.
  //
  // Named keys minted later via the dashboard / `aju keys create` can still
  // be downscoped to read | write | delete via presets — those are the
  // attenuated credential pattern. Device keys are the bootstrap.
  const { plaintext, prefix, hash } = generateApiKey();

  const apiKey = await prisma.apiKey.create({
    data: {
      id: generateToken(16),
      prefix,
      hash,
      name: keyName,
      userId: user.id,
      scopes: ["read", "write", "delete", "admin"],
    },
  });

  await prisma.deviceCode.update({
    where: { id: row.id },
    data: {
      status: "approved",
      approvedByUserId: user.id,
      apiKeyId: apiKey.id,
      apiKeyPlaintext: plaintext,
    },
  });

  return NextResponse.json({ ok: true });
}
