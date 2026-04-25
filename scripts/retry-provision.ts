/**
 * Retry tenant provisioning for a specific org. Useful when the initial
 * provisionTenant call during signup failed and left the tenant row in
 * status='provisioning'.
 *
 * Usage:
 *   npx tsx scripts/retry-provision.ts <organizationId>
 */

import "dotenv/config";
import { provisionTenant } from "../src/lib/tenant";

async function main() {
  const orgId = process.argv[2];
  if (!orgId) {
    console.error("usage: tsx scripts/retry-provision.ts <organizationId>");
    process.exit(1);
  }
  console.log(`[retry-provision] running provisionTenant(${orgId})...`);
  try {
    await provisionTenant(orgId);
    console.log(`[retry-provision] ✓ tenant provisioned`);
  } catch (err) {
    console.error(`[retry-provision] ✗ failed:`, err);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
