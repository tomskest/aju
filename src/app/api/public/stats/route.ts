import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PublicStats = {
  users: number;
  updatedAt: string;
};

export async function GET() {
  const users = await prisma.user.count();

  const stats: PublicStats = {
    users,
    updatedAt: new Date().toISOString(),
  };

  return NextResponse.json(stats, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
