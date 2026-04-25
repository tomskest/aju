/**
 * Database clients.
 *
 * Two Prisma clients post-split:
 *
 *   - `prisma` (PrismaClientControl): control-plane singleton. Hits the
 *     aju_control database — User, Session, Organization, Membership,
 *     ApiKey, Tenant, etc.
 *
 *   - `tenantDbFor(orgId)` returns a PrismaClientTenant pointed at the org's
 *     per-tenant database. Cached in an LRU so we don't open a new connection
 *     pool on every request. Idle reaper disconnects clients that haven't
 *     been used in 10 minutes.
 *
 * Local-dev escape hatch: `USE_LOCAL_TENANT_DB=1` → `tenantDbFor` returns a
 * single PrismaClientTenant pointed at DATABASE_URL. In this mode the tenant
 * schema is expected to live alongside the control schema in one DB; this is
 * only for loopback dev without Neon.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaClient as PrismaClientTenant } from "@prisma/client-tenant";
import { logger as baseLogger } from "./logger";
import { decryptDsn } from "@/lib/tenant";

const log = baseLogger.child({ area: "tenant-db" });

/**
 * Schema version the deployed code expects every tenant DB to be on. Bumped
 * by human edit when data/tenant/schema.prisma changes; `scripts/tenant-
 * migrate.ts` updates each tenant's `tenant.schema_version` after a
 * successful migrate. A tenant whose recorded version is behind this value
 * is considered drifted and `tenantDbFor` throws `TenantSchemaDriftError`
 * until the migration runs.
 */
export const CURRENT_TENANT_SCHEMA_VERSION = 1;

// ---------- Control plane ----------

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  tenantCache: TenantClientCache | undefined;
};

function makeControlClient(): PrismaClient {
  const directUrl = process.env.DATABASE_URL;
  const pooledUrl = process.env.CONTROL_POOLED_URL;
  const datasourceUrl = pooledUrl || directUrl;
  return new PrismaClient(datasourceUrl ? { datasourceUrl } : undefined);
}

export const prisma = globalForPrisma.prisma ?? makeControlClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// ---------- Tenant plane ----------

export type { PrismaClientTenant };

const IDLE_REAP_MS = 10 * 60 * 1000; // 10 minutes

interface CachedTenant {
  client: PrismaClientTenant;
  lastUsedAt: number;
}

class TenantClientCache {
  private readonly max: number;
  private readonly cache = new Map<string, CachedTenant>();
  private readonly inflight = new Map<string, Promise<PrismaClientTenant>>();
  private reaper: NodeJS.Timeout | null = null;

  constructor(max: number) {
    this.max = Math.max(1, max);
  }

  async get(orgId: string): Promise<PrismaClientTenant> {
    const hit = this.cache.get(orgId);
    if (hit) {
      hit.lastUsedAt = Date.now();
      // re-insert to bump LRU recency
      this.cache.delete(orgId);
      this.cache.set(orgId, hit);
      return hit.client;
    }

    const existing = this.inflight.get(orgId);
    if (existing) return existing;

    const loading = this.load(orgId);
    this.inflight.set(orgId, loading);
    try {
      return await loading;
    } finally {
      this.inflight.delete(orgId);
    }
  }

  async evict(orgId: string): Promise<void> {
    const hit = this.cache.get(orgId);
    if (!hit) return;
    this.cache.delete(orgId);
    await hit.client.$disconnect().catch(() => {});
  }

  async clear(): Promise<void> {
    const entries = [...this.cache.values()];
    this.cache.clear();
    await Promise.all(entries.map((e) => e.client.$disconnect().catch(() => {})));
    if (this.reaper) {
      clearInterval(this.reaper);
      this.reaper = null;
    }
  }

  private async load(orgId: string): Promise<PrismaClientTenant> {
    if (process.env.USE_LOCAL_TENANT_DB === "1") {
      // Shared local DB. No tenant row lookup; every orgId returns the same
      // client pointed at DATABASE_URL.
      const url = process.env.DATABASE_URL;
      if (!url) {
        throw new Error(
          "USE_LOCAL_TENANT_DB=1 requires DATABASE_URL to be set",
        );
      }
      const client = new PrismaClientTenant({ datasourceUrl: url });
      this.insert(orgId, client);
      return client;
    }

    const tenant = await prisma.tenant.findUnique({
      where: { organizationId: orgId },
    });
    if (!tenant) {
      throw new Error(`no tenant row for organization ${orgId}`);
    }
    if (tenant.status === "suspended") {
      throw new TenantSuspendedError(orgId);
    }
    if (tenant.status === "archived") {
      throw new TenantArchivedError(orgId);
    }
    if (tenant.status !== "active") {
      throw new TenantProvisioningError(orgId);
    }
    if (tenant.schemaVersion < CURRENT_TENANT_SCHEMA_VERSION) {
      log.warn(
        {
          organization_id: orgId,
          tenant_schema_version: tenant.schemaVersion,
          expected_schema_version: CURRENT_TENANT_SCHEMA_VERSION,
        },
        "tenant schema drift — org is read-only until migrate catches up",
      );
      throw new TenantSchemaDriftError(
        orgId,
        tenant.schemaVersion,
        CURRENT_TENANT_SCHEMA_VERSION,
      );
    }

    const pooledDsn = decryptDsn(tenant.dsnPooledEnc);
    const client = new PrismaClientTenant({ datasourceUrl: pooledDsn });
    this.insert(orgId, client);
    return client;
  }

  private insert(orgId: string, client: PrismaClientTenant): void {
    this.cache.set(orgId, { client, lastUsedAt: Date.now() });
    this.ensureReaper();
    if (this.cache.size > this.max) {
      // Evict least-recently-used (first entry in the Map).
      const oldestKey = this.cache.keys().next().value;
      if (typeof oldestKey === "string") {
        const evicted = this.cache.get(oldestKey);
        this.cache.delete(oldestKey);
        evicted?.client.$disconnect().catch(() => {});
        log.warn(
          {
            evicted_organization_id: oldestKey,
            cache_size: this.cache.size,
            cache_max: this.max,
          },
          "tenant client LRU eviction — scale up TENANT_CLIENT_CACHE_MAX or adopt a pooled-driver fallback",
        );
      }
    }
  }

  private ensureReaper(): void {
    if (this.reaper) return;
    this.reaper = setInterval(() => {
      const cutoff = Date.now() - IDLE_REAP_MS;
      for (const [key, entry] of this.cache.entries()) {
        if (entry.lastUsedAt < cutoff) {
          this.cache.delete(key);
          entry.client.$disconnect().catch(() => {});
        }
      }
    }, 60 * 1000).unref();
  }
}

function cacheMax(): number {
  const raw = process.env.TENANT_CLIENT_CACHE_MAX;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

const tenantCache =
  globalForPrisma.tenantCache ?? new TenantClientCache(cacheMax());

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.tenantCache = tenantCache;
}

export async function tenantDbFor(orgId: string): Promise<PrismaClientTenant> {
  return tenantCache.get(orgId);
}

export async function evictTenantClient(orgId: string): Promise<void> {
  return tenantCache.evict(orgId);
}

export class TenantSuspendedError extends Error {
  constructor(orgId: string) {
    super(`tenant ${orgId} is suspended`);
    this.name = "TenantSuspendedError";
  }
}

export class TenantArchivedError extends Error {
  constructor(orgId: string) {
    super(`tenant ${orgId} is archived`);
    this.name = "TenantArchivedError";
  }
}

export class TenantProvisioningError extends Error {
  constructor(orgId: string) {
    super(`tenant ${orgId} is still provisioning`);
    this.name = "TenantProvisioningError";
  }
}

export class TenantSchemaDriftError extends Error {
  readonly tenantVersion: number;
  readonly codeVersion: number;
  constructor(orgId: string, tenantVersion: number, codeVersion: number) {
    super(
      `tenant ${orgId} is on schema v${tenantVersion}, code expects v${codeVersion}`,
    );
    this.name = "TenantSchemaDriftError";
    this.tenantVersion = tenantVersion;
    this.codeVersion = codeVersion;
  }
}
