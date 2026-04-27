-- Append-only version history for vault documents. Powers the edit log
-- and serves as the authoritative store of `base` content for future
-- server-side three-way merges that don't require the caller to round-trip
-- baseContent on every update.

CREATE TABLE "vault_document_versions" (
    "id" TEXT NOT NULL,
    "brain_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "version_n" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "parent_hash" TEXT,
    "merge_parent_hash" TEXT,
    "source" TEXT NOT NULL,
    "changed_by" TEXT,
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_document_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vault_document_versions_document_id_version_n_key"
    ON "vault_document_versions"("document_id", "version_n");

CREATE INDEX "vault_document_versions_brain_id_idx"
    ON "vault_document_versions"("brain_id");

-- Enables the future merge-base lookup path: given a doc + a baseHash,
-- find the version row that hash refers to so the server can fetch
-- baseContent without the caller round-tripping it.
CREATE INDEX "vault_document_versions_brain_id_content_hash_idx"
    ON "vault_document_versions"("brain_id", "content_hash");

-- Range-scan the history of a path in chronological order.
CREATE INDEX "vault_document_versions_brain_id_path_created_at_idx"
    ON "vault_document_versions"("brain_id", "path", "created_at");

ALTER TABLE "vault_document_versions"
    ADD CONSTRAINT "vault_document_versions_brain_id_fkey"
    FOREIGN KEY ("brain_id") REFERENCES "brains"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "vault_document_versions"
    ADD CONSTRAINT "vault_document_versions_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "vault_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: insert version 1 for every existing document so a future
-- baseHash lookup against legacy docs still resolves. parent_hash is
-- NULL to mark the genesis row of each document's history.
--
-- The id is a CUID-ish 24-char string built from gen_random_uuid hex
-- bytes — collision-resistant within a tenant, and the application
-- writes proper CUIDs going forward.
INSERT INTO "vault_document_versions" (
    "id",
    "brain_id",
    "document_id",
    "path",
    "version_n",
    "content",
    "content_hash",
    "parent_hash",
    "merge_parent_hash",
    "source",
    "changed_by",
    "message",
    "created_at"
)
SELECT
    'v1_' || replace(gen_random_uuid()::text, '-', ''),
    d."brain_id",
    d."id",
    d."path",
    1,
    d."content",
    d."content_hash",
    NULL,
    NULL,
    'backfill',
    NULL,
    'pre-version-table backfill',
    d."created_at"
FROM "vault_documents" d
WHERE NOT EXISTS (
    SELECT 1 FROM "vault_document_versions" v
    WHERE v."document_id" = d."id"
);

-- RLS for this table is defined in data/tenant/rls-policies.sql alongside
-- every other brain_id-scoped table. tenant-migrate.ts re-applies that
-- file on every deploy so the policy lands the same way it does for
-- vault_documents, vault_files, etc.
