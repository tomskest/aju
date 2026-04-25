-- Per-tenant object-storage config. All nullable for staged rollout: a tenant
-- with no storage_bucket falls back to the env-based shared bucket in the
-- runtime. Once every active tenant has been provisioned, the fallback path
-- in tenant-storage.ts is deleted and these columns become required.
ALTER TABLE "tenant" ADD COLUMN "storage_bucket" TEXT;
ALTER TABLE "tenant" ADD COLUMN "storage_access_key_enc" TEXT;
ALTER TABLE "tenant" ADD COLUMN "storage_secret_key_enc" TEXT;
-- Optional endpoint override. NULL means the runtime uses STORAGE_ENDPOINT_URL
-- (default `https://t3.storage.dev`). Exposed per-tenant so a future multi-
-- provider story (Tigris today, R2 tomorrow) doesn't need another migration.
ALTER TABLE "tenant" ADD COLUMN "storage_endpoint" TEXT;
