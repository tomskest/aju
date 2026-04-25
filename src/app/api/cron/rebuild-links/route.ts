import { NextRequest, NextResponse } from "next/server";
import { rebuildLinks } from "@/lib/vault";
import { prisma, tenantDbFor } from "@/lib/db";

/**
 * POST /api/cron/rebuild-links
 *
 * Platform-cron-only endpoint. Sweeps every active tenant and reruns the
 * wikilink graph rebuild inside each tenant DB. Gated by CRON_SECRET — a
 * single compromised user key must not be able to trigger tenant-wide work.
 * The previous `?brain=<name>` user-invoked branch has been removed; per-brain
 * rebuilds should live on a user-auth endpoint outside /api/cron/*.
 */
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "cron_not_configured" },
      { status: 503 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  // Also accept x-cron-secret for platforms that don't pass Authorization.
  const header = req.headers.get("x-cron-secret") ?? "";
  const { timingSafeEqual } = await import("node:crypto");
  const ok =
    (presented &&
      presented.length === cronSecret.length &&
      timingSafeEqual(Buffer.from(presented), Buffer.from(cronSecret))) ||
    (header &&
      header.length === cronSecret.length &&
      timingSafeEqual(Buffer.from(header), Buffer.from(cronSecret)));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Sweep every active tenant.
  const tenants = await prisma.tenant.findMany({
    where: { status: "active" },
    select: { organizationId: true, databaseName: true },
  });

  const perTenant: Array<{
    databaseName: string;
    ok: boolean;
    result?: Awaited<ReturnType<typeof rebuildLinks>>;
    error?: string;
  }> = [];
  let documents = 0;
  let resolved = 0;
  let unresolved = 0;
  const start = Date.now();

  for (const t of tenants) {
    try {
      const tenant = await tenantDbFor(t.organizationId);
      const result = await rebuildLinks(tenant);
      perTenant.push({ databaseName: t.databaseName, ok: true, result });
      documents += result.documents;
      resolved += result.resolved;
      unresolved += result.unresolved;
    } catch (err) {
      console.error(
        `[cron/rebuild-links] ${t.databaseName} failed:`,
        err,
      );
      perTenant.push({
        databaseName: t.databaseName,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    tenants: tenants.length,
    documents,
    resolved,
    unresolved,
    perTenant,
    durationMs: Date.now() - start,
  });
}
