import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/db";

function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * POST /api/invitations/[token]/decline
 *
 * Public endpoint (no auth needed). Deletes the invitation row by token
 * hash. Idempotent — always returns `{ ok: true }` even when the row is
 * already gone so a repeat click doesn't surface a scary error.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;

  if (!token) {
    return NextResponse.json({ ok: true });
  }

  const tokenHash = hashInviteToken(token);

  await prisma.invitation
    .delete({ where: { tokenHash } })
    .catch(() => {
      /* already declined / never existed — treat as success */
    });

  return NextResponse.json({ ok: true });
}
