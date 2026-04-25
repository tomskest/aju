import type { PrismaClient as PrismaClientTenant } from "@prisma/client-tenant";
import { prisma, evictTenantClient } from "@/lib/db";
import { destroyTenant } from "@/lib/tenant";
import { tenantDbFor } from "@/lib/db";
import { storageFor, evictStorageHandle } from "@/lib/tenant";
import { destroyTenantStorage } from "@/lib/storage";

/**
 * Brain deletion that also wipes the brain's objects from the tenant bucket.
 *
 * Ordering note: enumerate + delete storage keys BEFORE DB rows. If the DB
 * delete fails afterwards we've leaked some objects — acceptable, because
 * the DB still holds VaultFile rows and the user can retry. The worst case
 * we refuse to tolerate is the inverse: DB rows gone, objects still live in
 * the bucket with no way to find them.
 */

export type DeleteBrainResult = {
  brainId: string;
  r2ObjectsDeleted: number;
  r2Warnings: string[];
};

async function wipeBrainObjects(
  tenant: PrismaClientTenant,
  organizationId: string,
  brainId: string,
): Promise<{ deleted: number; warnings: string[] }> {
  const warnings: string[] = [];

  // Pull keys from the tenant DB — it's the source of truth for which objects
  // belong to a brain, and we avoid paging an unbounded bucket prefix.
  const files = await tenant.vaultFile.findMany({
    where: { brainId },
    select: { s3Key: true },
  });

  if (files.length === 0) return { deleted: 0, warnings };

  let storage;
  try {
    storage = await storageFor(organizationId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(
      `storage unavailable for brain ${brainId}; skipped wipe: ${msg}`,
    );
    return { deleted: 0, warnings };
  }

  const result = await storage.deleteMany(files.map((f) => f.s3Key));
  if (result.warnings.length > 0) {
    console.warn(
      `[brain-delete] ${brainId}: ${result.warnings.length} warning(s)`,
    );
  }
  return result;
}

/**
 * Delete a brain and its storage side-effects from a specific tenant DB.
 *
 * Caller verifies authorization (owner/editor). Schema cascades handle
 * BrainAccess, VaultDocument, VaultFile, DocumentLink, VaultChangeLog rows;
 * we wipe storage first, then drop the Brain row. `organizationId` is
 * required so we resolve the right per-tenant bucket.
 */
export async function deleteBrainWithStorage(
  tenant: PrismaClientTenant,
  organizationId: string,
  brainId: string,
): Promise<DeleteBrainResult> {
  const { deleted, warnings } = await wipeBrainObjects(
    tenant,
    organizationId,
    brainId,
  );

  // Explicit cascade. The tenant schema only has `onDelete: Cascade` on
  // BrainAccess; VaultChangeLog, DocumentLink, VaultFile, and VaultDocument
  // reference Brain without any cascade rule, so a bare `brain.delete`
  // FK-fails against these child rows. Wrap in a transaction so a partial
  // wipe doesn't leave an undeletable brain with only some children gone.
  //
  // A brain with hundreds of change-log rows routinely exceeds Prisma's 5s
  // default interactive-transaction timeout; bump it so cleanup of large
  // brains (benchmark runs, archived workspaces) doesn't surface as P2028.
  await tenant.$transaction(
    async (tx) => {
      await tx.vaultChangeLog.deleteMany({ where: { brainId } });
      await tx.documentLink.deleteMany({ where: { brainId } });
      await tx.vaultFile.deleteMany({ where: { brainId } });
      await tx.vaultDocument.deleteMany({ where: { brainId } });
      await tx.brain.delete({ where: { id: brainId } });
    },
    { timeout: 120_000, maxWait: 120_000 },
  );

  return {
    brainId,
    r2ObjectsDeleted: deleted,
    r2Warnings: warnings,
  };
}

/**
 * Tear down an org: wipe every brain's S3 objects, drop the tenant DB entirely
 * via destroyTenant, then delete the organization row in the control plane.
 *
 * Resilient to partial state. If a previous attempt already dropped the
 * Neon database but left the control rows behind, a retry skips the S3
 * wipe (there's nothing to connect to) and still finishes the teardown.
 * Same for retries after an already-deleted tenant row or org row.
 *
 * Used by /api/me/delete and the org settings delete action.
 */
export async function deleteOrganizationWithStorage(
  organizationId: string,
): Promise<{
  brainsDeleted: number;
  r2ObjectsDeleted: number;
  r2Warnings: string[];
}> {
  let brainsDeleted = 0;
  let r2ObjectsDeleted = 0;
  const r2Warnings: string[] = [];

  // S3 wipe is best-effort. If the tenant DB is already gone (previous
  // attempt's destroyTenant succeeded but a later step failed), we can't
  // list the files — skip and keep going. Orphan objects can be swept
  // later by a bucket-lifecycle rule or maintenance job.
  try {
    const tenant = await tenantDbFor(organizationId);
    const brains = await tenant.brain.findMany({ select: { id: true } });
    brainsDeleted = brains.length;
    for (const b of brains) {
      const res = await wipeBrainObjects(tenant, organizationId, b.id);
      r2ObjectsDeleted += res.deleted;
      r2Warnings.push(...res.warnings);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[delete-org] s3 wipe skipped for ${organizationId} (tenant unreachable): ${msg}`,
    );
    r2Warnings.push(`s3 wipe skipped — tenant unreachable: ${msg}`);
  }

  // Drop cached storage/DB handles so a subsequent provision (same orgId)
  // wouldn't reuse torn-down state, and destroyTenant can run cleanly.
  await evictTenantClient(organizationId);
  evictStorageHandle(organizationId);

  // Delete the tenant's Tigris bucket + scoped access key BEFORE we drop
  // the tenant row, since destroyTenantStorage reads bucket/key metadata
  // from it. Best-effort: warnings don't block org deletion.
  try {
    const storageResult = await destroyTenantStorage(prisma, organizationId);
    r2Warnings.push(...storageResult.warnings);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[delete-org] tigris cleanup failed for ${organizationId}: ${msg}`,
    );
    r2Warnings.push(`tigris cleanup failed: ${msg}`);
  }

  try {
    await destroyTenant(organizationId);
  } catch (err) {
    console.error(
      `[delete-org] destroyTenant failed for ${organizationId}:`,
      err,
    );
    throw err;
  }

  // Last step — delete the org row. Any dependent rows cascade via schema
  // FKs. If the row is already gone (P2025), that's a successful retry.
  try {
    await prisma.organization.delete({ where: { id: organizationId } });
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code !== "P2025") {
      console.error(
        `[delete-org] organization.delete failed for ${organizationId}:`,
        err,
      );
      throw err;
    }
  }

  return {
    brainsDeleted,
    r2ObjectsDeleted,
    r2Warnings,
  };
}
