/**
 * Per-tenant object-storage handles.
 *
 * Mirrors `tenantDbFor(orgId)`: every write/read for a tenant goes through
 * a handle scoped to that tenant's bucket and credentials. Buckets are
 * provisioned out-of-band by `scripts/provision-tigris-bucket.ts` (operator
 * shells out to the `tigris` CLI); the app runtime only ever reads per-tenant
 * scoped keys decrypted from the `tenant` row — no admin-power keys live in
 * the runtime environment.
 *
 * Transitional fallback: if a tenant row has no `storageBucket` yet, the
 * handle uses the legacy env-based shared bucket (`AWS_S3_BUCKET_NAME` +
 * global `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`). Once every active
 * tenant has been backfilled via the provisioning script, the fallback branch
 * and env vars go away and the storage columns become required.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { prisma } from "@/lib/db";
import { decryptStorageSecret } from "@/lib/storage";
import { logger as baseLogger } from "@/lib/logger";

const log = baseLogger.child({ area: "tenant-storage" });

const DEFAULT_ENDPOINT = "https://t3.storage.dev";
const DEFAULT_REGION = "auto";

// S3 DeleteObjects caps each request at 1000 keys.
const BATCH_LIMIT = 1000;

export interface TenantStorage {
  readonly bucket: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  presignGet(key: string, expiresIn?: number): Promise<string>;
  presignPut(
    key: string,
    contentType: string,
    expiresIn?: number,
  ): Promise<string>;
  deleteMany(
    keys: string[],
  ): Promise<{ deleted: number; warnings: string[] }>;
}

interface StorageConfig {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  region: string;
  source: "tenant" | "env-fallback";
}

const globalForStorage = globalThis as unknown as {
  storageCache: Map<string, TenantStorage> | undefined;
};

const cache = globalForStorage.storageCache ?? new Map<string, TenantStorage>();

if (process.env.NODE_ENV !== "production") {
  globalForStorage.storageCache = cache;
}

export async function storageFor(orgId: string): Promise<TenantStorage> {
  const hit = cache.get(orgId);
  if (hit) return hit;

  const cfg = await loadStorageConfig(orgId);
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  const handle = buildHandle(client, cfg.bucket);
  cache.set(orgId, handle);
  return handle;
}

/**
 * Drop a cached handle. Use after rotating credentials or re-provisioning
 * a bucket so the next `storageFor(orgId)` picks up the new config.
 */
export function evictStorageHandle(orgId: string): void {
  cache.delete(orgId);
}

async function loadStorageConfig(orgId: string): Promise<StorageConfig> {
  const tenant = await prisma.tenant.findUnique({
    where: { organizationId: orgId },
    select: {
      storageBucket: true,
      storageAccessKeyEnc: true,
      storageSecretKeyEnc: true,
      storageEndpoint: true,
    },
  });

  if (
    tenant?.storageBucket &&
    tenant.storageAccessKeyEnc &&
    tenant.storageSecretKeyEnc
  ) {
    return {
      bucket: tenant.storageBucket,
      accessKeyId: decryptStorageSecret(tenant.storageAccessKeyEnc),
      secretAccessKey: decryptStorageSecret(tenant.storageSecretKeyEnc),
      endpoint:
        tenant.storageEndpoint ||
        process.env.STORAGE_ENDPOINT_URL ||
        DEFAULT_ENDPOINT,
      region: process.env.STORAGE_REGION || DEFAULT_REGION,
      source: "tenant",
    };
  }

  // Fallback: legacy shared-bucket env. Remove once every active tenant has
  // been backfilled by scripts/provision-tigris-bucket.ts.
  const envBucket = process.env.AWS_S3_BUCKET_NAME;
  const envAccessKey = process.env.AWS_ACCESS_KEY_ID;
  const envSecret = process.env.AWS_SECRET_ACCESS_KEY;
  if (!envBucket || !envAccessKey || !envSecret) {
    throw new Error(
      `tenant ${orgId} has no storage config and no env fallback — run scripts/provision-tigris-bucket.ts`,
    );
  }
  log.warn(
    { organization_id: orgId },
    "storage: falling back to shared env bucket — provision a per-tenant bucket",
  );
  return {
    bucket: envBucket,
    accessKeyId: envAccessKey,
    secretAccessKey: envSecret,
    endpoint:
      process.env.AWS_ENDPOINT_URL ||
      process.env.STORAGE_ENDPOINT_URL ||
      DEFAULT_ENDPOINT,
    region:
      process.env.AWS_DEFAULT_REGION ||
      process.env.STORAGE_REGION ||
      DEFAULT_REGION,
    source: "env-fallback",
  };
}

function buildHandle(client: S3Client, bucket: string): TenantStorage {
  return {
    bucket,
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    async get(key) {
      const res = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (!res.Body) throw new Error(`empty response for key: ${key}`);
      const bytes = await res.Body.transformToByteArray();
      return Buffer.from(bytes);
    },
    async delete(key) {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: key }),
      );
    },
    async presignGet(key, expiresIn = 3600) {
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn },
      );
    },
    async presignPut(key, contentType, expiresIn = 3600) {
      return getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
        }),
        { expiresIn },
      );
    },
    async deleteMany(keys) {
      const warnings: string[] = [];
      if (keys.length === 0) return { deleted: 0, warnings };
      let deleted = 0;
      for (let i = 0; i < keys.length; i += BATCH_LIMIT) {
        const chunk = keys.slice(i, i + BATCH_LIMIT);
        try {
          const resp = await client.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: {
                Objects: chunk.map((k) => ({ Key: k })),
                Quiet: true,
              },
            }),
          );
          const errs = resp.Errors ?? [];
          deleted += chunk.length - errs.length;
          for (const err of errs) {
            warnings.push(
              `delete error key=${err.Key}: ${err.Code ?? "?"} ${err.Message ?? ""}`.trim(),
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push(
            `batch-delete failed batch=${i / BATCH_LIMIT}: ${msg}`,
          );
        }
      }
      return { deleted, warnings };
    },
  };
}
