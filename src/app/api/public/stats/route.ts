import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COHORT_CAP = 100;

type PublicStats = {
  grandfathered: number;
  cap: number;
  remaining: number;
  updatedAt: string;
};

export async function GET() {
  const grandfathered = await prisma.user.count({
    where: { grandfatheredAt: { not: null } },
  });

  const stats: PublicStats = {
    grandfathered,
    cap: COHORT_CAP,
    remaining: Math.max(0, COHORT_CAP - grandfathered),
    updatedAt: new Date().toISOString(),
  };

  return NextResponse.json(stats, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
