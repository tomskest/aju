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

ALTER TABLE "vault_document_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vault_document_versions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS brain_isolation ON "vault_document_versions";
CREATE POLICY brain_isolation ON "vault_document_versions"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR brain_id = ANY(string_to_array(current_setting('app.current_brain_ids', true), ','))
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR brain_id = ANY(string_to_array(current_setting('app.current_brain_ids', true), ','))
  );

ALTER TABLE "vault_validation_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vault_validation_log" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS brain_isolation ON "vault_validation_log";
CREATE POLICY brain_isolation ON "vault_validation_log"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR brain_id = ANY(string_to_array(current_setting('app.current_brain_ids', true), ','))
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR brain_id = ANY(string_to_array(current_setting('app.current_brain_ids', true), ','))
  );

ALTER TABLE "brain_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brain_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS brain_isolation ON "brain_settings";
CREATE POLICY brain_isolation ON "brain_settings"
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

-- ---------- RLS role: what request transactions run as ----------
--
-- The login role is created through the Neon API, which gives it BYPASSRLS,
-- so on that role none of the policies above apply. Request transactions
-- therefore drop to `<login role>_rls`, a role without BYPASSRLS, for their
-- duration (setBrainContextOnTx in src/lib/tenant/context.ts, via SET LOCAL
-- ROLE). Maintenance paths that open the tenant DB directly keep the login
-- role and are unaffected.
--
-- The role gets the login role's table rights, nothing more. It is only
-- made reachable (membership granted) once every table, sequence and
-- function here belongs to the login role, so every grant below took
-- effect; otherwise the switch stays off for this DB and a warning says
-- why. Revoking the membership turns enforcement off for one DB at once;
-- SKIP_TENANT_RLS_ROLE=1 turns it off everywhere without touching the DB.

DO $$
DECLARE
  login_role text := current_user;
  rls_role text := current_user || '_rls';
  -- From PG16 the creator holds ADMIN without SET, so MEMBER is always true.
  can_set text := CASE WHEN current_setting('server_version_num')::int >= 160000 THEN 'SET' ELSE 'MEMBER' END;
  foreign_owned int;
BEGIN
  IF login_role LIKE '%\_rls' THEN
    RAISE EXCEPTION 'rls-policies.sql must run as the login role, not %', login_role;
  END IF;

  SELECT count(*) INTO foreign_owned FROM (
    SELECT tableowner AS owner FROM pg_tables WHERE schemaname = 'public'
    UNION ALL
    SELECT pg_get_userbyid(c.relowner) FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'S'
    UNION ALL
    SELECT pg_get_userbyid(p.proowner) FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  ) o WHERE o.owner <> login_role;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rls_role) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', rls_role);
  ELSE
    EXECUTE format('ALTER ROLE %I NOLOGIN NOBYPASSRLS', rls_role);
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', rls_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', rls_role);
  EXECUTE format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %I', rls_role);
  EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO %I', rls_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', rls_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I', rls_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO %I', rls_role);

  IF foreign_owned = 0 THEN
    EXECUTE format('GRANT %I TO %I', rls_role, login_role);
  ELSE
    RAISE WARNING '% object(s) in public are not owned by %, so % may lack rights; RLS role switch left off', foreign_owned, login_role, rls_role;
    IF pg_has_role(login_role, rls_role, can_set) THEN
      EXECUTE format('REVOKE %I FROM %I', rls_role, login_role);
    END IF;
  END IF;
END $$;
