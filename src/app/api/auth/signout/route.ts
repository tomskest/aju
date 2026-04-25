import { NextResponse } from "next/server";
import {
  clearActiveOrganizationCookie,
  clearSessionCookie,
} from "@/lib/auth";

export async function POST(req: Request) {
  await clearSessionCookie();
  await clearActiveOrganizationCookie();
  // Prefer the public app URL — req.url is the internal Railway origin.
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (() => {
      const forwardedHost = req.headers.get("x-forwarded-host");
      const forwardedProto = req.headers.get("x-forwarded-proto") ?? "https";
      if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
      return new URL(req.url).origin;
    })();
  return NextResponse.redirect(new URL("/", base), { status: 303 });
}
