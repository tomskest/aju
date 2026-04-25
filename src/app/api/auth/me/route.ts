import { NextRequest, NextResponse } from "next/server";
import { authenticate, isAuthError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  if (isAuthError(auth)) return auth;

  // DB-backed Bearer auth carries the real user — return the richer shape the
  // CLI needs. Legacy env-var auth still returns the minimal identity/role.
  if (auth.userId && auth.email) {
    return NextResponse.json({
      identity: auth.identity,
      userId: auth.userId,
      email: auth.email,
      role: auth.role ?? "member",
    });
  }

  return NextResponse.json({
    identity: auth.identity,
    role: auth.role ?? (auth.identity === "admin" ? "admin" : "member"),
  });
}
