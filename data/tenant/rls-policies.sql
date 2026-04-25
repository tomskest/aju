-- Row-Level Security policies for per-tenant databases.
--
-- Apply with scripts/tenant-migrate.ts (runs as part of provisioning and on
-- every deploy that touches data/tenant/). Idempotent — ENABLE/FORCE RLS
-- are no-ops if already set, and each policy is DROP IF EXISTS before CREATE.
--
-- ARCHITECTURE
--
-- This file is applied INSIDE each per-tenant database. The DB itself is
-- the organization boundary — cross-org isolation comes from the fact that
-- a connection string only grants access to one org's database.
--
-- RLS in this file provides defense-in-depth *within* one org: a code bug
-- that forgets to filter by brain_id cannot leak rows across brains the
-- current requester shouldn't see. Application queries SHOULD still include
-- explicit `brain_id IN (...)` filters in WHERE — that's what gets indexed
-- and gives the planner proper selectivity. RLS is the safety net behind
-- the explicit filter, not a substitute for it.
--
-- FAIL-CLOSED CONTRACT
--
-- The session variable `app.current_brain_ids` holds the requester's
-- accessible brain ids as a comma-separated list, set via set_config()
-- inside a transaction (see src/lib/tenant/context.ts → withBrainContext).
--
-- If the variable is unset, `string_to_array(NULL, ',')` is NULL,
-- `brain_id = ANY(NULL)` is NULL (not true), and the policy DENIES the row.
-- Forgetting to scope = zero rows visible. This is the security improvement
-- vs. the earlier `IS NULL OR ...` form, which made a forgotten SET LOCAL
-- silently expose every brain in the org — a single-bug-to-cross-tenant-leak
-- waiting to happen.
--
-- Legitimate maintenance paths (provisioning, brain-create seed inserts,
-- agent management on tables without brain_id, sweeping tenant migrations)
-- explicitly opt out by setting `app.bypass_rls = 'on'` for the
-- transaction. The opt-out is deliberate and grep-able — see callers of
-- `withTenant({ unscoped: true })` and the bypass in
-- src/lib/tenant/context.ts.
--
-- agent has no brain_id; any row in this database belongs to this org by
-- construction, so no RLS policy is applied. The DB boundary is sufficient
-- for that table.

-- ---------- Tables with a brain_id column ----------

ALTER TABLE "brain_access" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brain_access" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS brain_isolation ON "brain_access";
CREATE POLICY brain_isolation ON "brain_access"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR brain_id = ANY(string_to_array(current_setting('app.current_brain_ids', true), ','))
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR brain_id = ANY(string_to_array(current_setting('app.current_brain_ids', true), ','))
  );

ALTER TABLE "vault_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vault_documents" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS brain_isolation ON "vault_documents";
CREATE POLICY brain_isolation ON "vault_documents"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR brain_id = ANY(string_to_array(current_setting('app.current_brain_ids', true), ','))
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR brain_id = ANY(string_to_array(current_setting('app.current_brain_ids', true), ','))
  );

ALTER TABLE "vault_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vault_files" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS brain_isolation ON "vault_files";
CREATE POLICY brain_isolation ON "vault_files"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR brain_id = ANY(string_to_array(current_setting('app.current_brain_ids', true), ','))
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR brain_id = ANY(string_to_array(current_setting('app.current_brain_ids', true), ','))
  );

ALTER TABLE "document_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_links" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS brain_isolation ON "document_links";
CREATE POLICY brain_isolation ON "document_links"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR brain_id = ANY(string_to_array(current_setting('app.current_brain_ids', true), ','))
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR brain_id = ANY(string_to_array(current_setting('app.current_brain_ids', true), ','))
  );

ALTER TABLE "vault_change_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vault_change_log" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS brain_isolation ON "vault_change_log";
CREATE POLICY brain_isolation ON "vault_change_log"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR brain_id = ANY(string_to_array(current_setting('app.current_brain_ids', true), ','))
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR brain_id = ANY(string_to_array(current_setting('app.current_brain_ids', true), ','))
  );

-- ---------- brains (policy compares id directly) ----------

ALTER TABLE "brains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brains" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS brain_isolation ON "brains";
CREATE POLICY brain_isolation ON "brains"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR id = ANY(string_to_array(current_setting('app.current_brain_ids', true), ','))
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR id = ANY(string_to_array(current_setting('app.current_brain_ids', true), ','))
  );

-- ---------- CHECK constraint: brain_access requires exactly one of user_id/agent_id ----------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'brain_access_actor_xor'
  ) THEN
    ALTER TABLE "brain_access"
      ADD CONSTRAINT brain_access_actor_xor
      CHECK ((user_id IS NULL) <> (agent_id IS NULL));
  END IF;
END $$;
