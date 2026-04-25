/**
 * Throwaway diagnostic: print tenant storage state for one org.
 * Delete after use.
 *   npx tsx scripts/check-tenant-storage.ts <orgId>
 */
import { prisma } from "../src/lib/db";

async function main() {
  const orgId = process.argv[2];
  if (!orgId) {
    console.error("usage: npx tsx scripts/check-tenant-storage.ts <orgId>");
    process.exit(1);
  }
  const t = await prisma.tenant.findUnique({
    where: { organizationId: orgId },
    select: {
      organizationId: true,
      status: true,
      storageBucket: true,
      storageAccessKeyEnc: true,
    },
  });
  console.log(t);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
