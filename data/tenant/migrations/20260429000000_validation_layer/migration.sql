-- Provenance & validation layer (Phase 1 of proposals/aju-validation-layer.md).
--
-- Adds doc-level validation primitives to vault_documents, an append-only
-- vault_validation_log for state-change history, and a brain_settings
-- sibling table for per-brain knobs (half-life, rank weights).
--
-- Existing data backfill: every existing doc gets provenance='human' and
-- validation_status='unvalidated'. Pre-existing content was not reviewed
-- by anyone in the new sense, so claiming it's validated would propagate
-- false trust into LLM context.

-- ---------- vault_documents: new columns ----------

ALTER TABLE "vault_documents"
    ADD COLUMN "provenance"        TEXT NOT NULL DEFAULT 'human',
    ADD COLUMN "validation_status" TEXT NOT NULL DEFAULT 'unvalidated',
    ADD COLUMN "validated_at"      TIMESTAMP(3),
    ADD COLUMN "validated_by"      TEXT,
    ADD COLUMN "validated_hash"    TEXT,
    ADD COLUMN "disqualified_at"   TIMESTAMP(3),
    ADD COLUMN "disqualified_by"   TEXT;

-- New indexes. The (brainId, validation_status) composite is critical —
-- every search query gains an `validation_status != 'disqualified'` clause,
-- which would otherwise force a sequential scan on every retrieval call.

CREATE INDEX "vault_documents_brain_id_validation_status_idx"
    ON "vault_documents"("brain_id", "validation_status");

CREATE INDEX "vault_documents_brain_id_provenance_idx"
    ON "vault_documents"("brain_id", "provenance");

CREATE INDEX "vault_documents_brain_id_validation_status_validated_at_idx"
    ON "vault_documents"("brain_id", "validation_status", "validated_at");

-- ---------- vault_validation_log ----------

CREATE TABLE "vault_validation_log" (
    "id"               TEXT NOT NULL,
    "brain_id"         TEXT NOT NULL,
    "document_id"      TEXT NOT NULL,
    "path"             TEXT NOT NULL,
    "from_status"      TEXT NOT NULL,
    "to_status"        TEXT NOT NULL,
    "from_provenance"  TEXT,
    "to_provenance"    TEXT,
    "content_hash_at"  TEXT NOT NULL,
    "source"           TEXT NOT NULL,
    "changed_by"       TEXT,
    "actor_type"       TEXT,
    "reason"           TEXT,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_validation_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vault_validation_log_brain_id_idx"
    ON "vault_validation_log"("brain_id");

CREATE INDEX "vault_validation_log_document_id_created_at_idx"
    ON "vault_validation_log"("document_id", "created_at");

CREATE INDEX "vault_validation_log_brain_id_to_status_created_at_idx"
    ON "vault_validation_log"("brain_id", "to_status", "created_at");

ALTER TABLE "vault_validation_log"
    ADD CONSTRAINT "vault_validation_log_brain_id_fkey"
    FOREIGN KEY ("brain_id") REFERENCES "brains"("id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "vault_validation_log"
    ADD CONSTRAINT "vault_validation_log_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "vault_documents"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- brain_settings ----------

CREATE TABLE "brain_settings" (
    "brain_id"                  TEXT NOT NULL,
    "validation_half_life_days" INTEGER NOT NULL DEFAULT 180,
    "rank_weight_validated"     DOUBLE PRECISION NOT NULL DEFAULT 0.10,
    "rank_weight_stale"         DOUBLE PRECISION NOT NULL DEFAULT -0.05,
    "rank_weight_human"         DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "updated_at"                TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brain_settings_pkey" PRIMARY KEY ("brain_id")
);

ALTER TABLE "brain_settings"
    ADD CONSTRAINT "brain_settings_brain_id_fkey"
    FOREIGN KEY ("brain_id") REFERENCES "brains"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Backfill ----------
--
-- Defensive UPDATE so any rows that somehow predate the column DEFAULTs
-- (legacy snapshots, half-applied migrations) land in the canonical
-- starting state. Also normalizes any imports that pre-set odd values.

UPDATE "vault_documents"
SET "provenance" = 'human'
WHERE "provenance" IS NULL OR "provenance" = '';

UPDATE "vault_documents"
SET "validation_status" = 'unvalidated'
WHERE "validation_status" IS NULL OR "validation_status" = '';
