import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

type Payload = { device_code?: string };

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Payload;
  const deviceCode = body.device_code;

  if (!deviceCode || typeof deviceCode !== "string") {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  const row = await prisma.deviceCode.findUnique({
    where: { deviceCode },
  });

  if (!row) {
    return NextResponse.json({ error: "invalid_code" }, { status: 404 });
  }

  // Expired or already consumed -> gone.
  if (row.expiresAt < new Date() || row.status === "used") {
    await prisma.deviceCode.delete({ where: { id: row.id } }).catch(() => {});
    return NextResponse.json({ status: "expired" });
  }

  if (row.status === "pending") {
    return NextResponse.json({ status: "pending" });
  }

  if (row.status === "denied") {
    await prisma.deviceCode.delete({ where: { id: row.id } }).catch(() => {});
    return NextResponse.json({ status: "denied" });
  }

  if (row.status === "approved") {
    const plaintext = row.apiKeyPlaintext;
    if (!plaintext) {
      // Shouldn't happen — approve always stores the plaintext. Treat as
      // expired so the CLI restarts the flow instead of looping forever.
      await prisma.deviceCode.delete({ where: { id: row.id } }).catch(() => {});
      return NextResponse.json({ status: "expired" });
    }

    // Hand the plaintext over exactly once, then mark used + scrub plaintext.
    await prisma.deviceCode.update({
      where: { id: row.id },
      data: { status: "used", apiKeyPlaintext: null },
    });

    return NextResponse.json({
      status: "approved",
      api_key: plaintext,
    });
  }

  // Unknown status -> treat as expired so clients don't hang.
  return NextResponse.json({ status: "expired" });
}
