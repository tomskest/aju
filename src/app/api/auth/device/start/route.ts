import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { generateToken } from "@/lib/auth";

export const runtime = "nodejs";

const DEVICE_CODE_TTL_SEC = 600; // 10 minutes
const POLL_INTERVAL_SEC = 2;
const MAX_AGENT_NAME_LEN = 120;

// Excludes ambiguous 0/O/1/I to keep human transcription clean.
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateUserCode(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += USER_CODE_ALPHABET[bytes[i]! % USER_CODE_ALPHABET.length];
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}`;
}

async function generateUniqueUserCode(): Promise<string> {
  // Retry up to a handful of times in the astronomically unlikely case of a
  // collision. The space is 32^8 = ~10^12.
  for (let i = 0; i < 5; i++) {
    const code = generateUserCode();
    const existing = await prisma.deviceCode.findUnique({
      where: { userCode: code },
    });
    if (!existing) return code;
  }
  throw new Error("failed to generate a unique user code");
}

type StartPayload = {
  intent?: unknown;
  agent_name?: unknown;
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as StartPayload;

  // Backwards-compatible: no body / unknown intent → "user" flow.
  const intent = body.intent === "agent" ? "agent" : "user";

  let agentName: string | null = null;
  if (intent === "agent") {
    if (typeof body.agent_name !== "string") {
      return NextResponse.json(
        { error: "agent_name required when intent=agent" },
        { status: 400 },
      );
    }
    const trimmed = body.agent_name.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "agent_name required" }, { status: 400 });
    }
    if (trimmed.length > MAX_AGENT_NAME_LEN) {
      return NextResponse.json({ error: "agent_name too long" }, { status: 400 });
    }
    agentName = trimmed;
  }

  const userCode = await generateUniqueUserCode();
  const deviceCode = generateToken(32);
  const expiresAt = new Date(Date.now() + DEVICE_CODE_TTL_SEC * 1000);

  await prisma.deviceCode.create({
    data: {
      id: generateToken(16),
      userCode,
      deviceCode,
      status: "pending",
      expiresAt,
      intent,
      agentName,
    },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://aju.sh";
  const verificationUrl = `${appUrl}/cli-auth?code=${encodeURIComponent(userCode)}`;

  return NextResponse.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_url: verificationUrl,
    expires_in: DEVICE_CODE_TTL_SEC,
    interval: POLL_INTERVAL_SEC,
  });
}
