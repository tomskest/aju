/**
 * One-time backfill: sweep every organization row and call provisionTenant
 * for any org that doesn't yet have a tenant row.
 *
 * Serialized across replicas via a control-plane advisory lock. Safe to
 * re-run; individual provision steps are idempotent.
 *
 * Usage:
 *   npm run db:provision:sweep
 *
 * After cutover this script is no longer part of normal operation —
 * provisioning moves to synchronous org-create paths.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { provisionTenant } from "../src/lib/tenant";

const LOCK_KEY = "aju:provision-sweep";

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const acquired = await prisma.$queryRawUnsafe<
      { pg_try_advisory_lock: boolean }[]
    >(`SELECT pg_try_advisory_lock(hashtext('${LOCK_KEY}'))`);
    if (!acquired[0]?.pg_try_advisory_lock) {
      console.log(
        "[provision-sweep] another replica holds the lock — skipping",
      );
      return;
    }

    try {
      const orgs = await prisma.organization.findMany({
        where: { tenant: null },
        select: { id: true, name: true, slug: true },
      });
      console.log(`[provision-sweep] ${orgs.length} org(s) to provision`);

      let ok = 0;
      let fail = 0;
      for (const org of orgs) {
        try {
          await provisionTenant(org.id);
          ok += 1;
          console.log(`[provision-sweep] ✓ ${org.slug}`);
        } catch (err) {
          fail += 1;
          console.error(`[provision-sweep] ✗ ${org.slug}:`, err);
        }
      }
      console.log(`[provision-sweep] done: ${ok} ok, ${fail} failed`);
      if (fail > 0) process.exitCode = 1;
    } finally {
      await prisma.$queryRawUnsafe(
        `SELECT pg_advisory_unlock(hashtext('${LOCK_KEY}'))`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[provision-sweep] fatal:", err);
  process.exit(1);
});
