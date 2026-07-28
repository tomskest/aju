-- Composite index for GET /api/vault/changes, the most frequently polled
-- endpoint. Its query filters and orders by (brain_id, created_at):
--   WHERE brain_id = ANY($1) AND created_at >= $2 ORDER BY created_at ASC
-- The pre-existing single-column indexes (brain_id) / (created_at) can't serve
-- the brain filter + created_at range + sort in a single scan. This mirrors the
-- (brain_id, …, created_at) shape already on vault_document_versions and
-- vault_validation_log.

-- CreateIndex
CREATE INDEX "vault_change_log_brain_id_created_at_idx" ON "vault_change_log"("brain_id", "created_at");
