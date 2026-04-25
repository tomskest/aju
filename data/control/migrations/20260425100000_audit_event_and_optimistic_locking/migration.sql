-- Optimistic-locking counter on hot rows. Default 0 for existing rows.
ALTER TABLE "organization" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "organization_membership" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

-- Append-only audit log for control-plane mutations. Vault doc/file
-- mutations live in the per-tenant `vault_change_log`; this table covers
-- everything else (key mints, role changes, org rename/delete, agent
-- grants, OAuth token issuance, ...).
CREATE TABLE "audit_event" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "actor_api_key_id" TEXT,
    "agent_id" TEXT,
    "organization_id" TEXT,
    "event_type" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "changes" JSONB,
    "metadata" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_event_organization_id_created_at_idx"
    ON "audit_event"("organization_id", "created_at" DESC);

CREATE INDEX "audit_event_actor_user_id_created_at_idx"
    ON "audit_event"("actor_user_id", "created_at" DESC);

CREATE INDEX "audit_event_event_type_created_at_idx"
    ON "audit_event"("event_type", "created_at" DESC);

CREATE INDEX "audit_event_resource_type_resource_id_idx"
    ON "audit_event"("resource_type", "resource_id");

-- ON DELETE SET NULL because forensic data must outlive the deleted
-- resource. A dropped user / deleted org should NOT cascade audit rows.
ALTER TABLE "audit_event"
    ADD CONSTRAINT "audit_event_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "user"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_event"
    ADD CONSTRAINT "audit_event_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organization"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
