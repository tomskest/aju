-- Optimistic-locking counter on Brain. Default 0 for existing rows.
ALTER TABLE "brains" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

-- Idempotent agent-grant guarantee at the DB level. Pair to the existing
-- (brain_id, user_id) unique. Postgres' default is "NULLs distinct" in
-- unique indexes, so:
--   - agent rows (user_id IS NULL) don't collide on the (brain_id, user_id) idx
--   - user rows  (agent_id IS NULL) don't collide on the (brain_id, agent_id) idx
-- Two grants for the same (brain, agent) now error with P2002 instead of
-- silently inserting a duplicate row. Replaces the advisory-lock workaround
-- in src/app/api/agents/[id]/brains/route.ts.
CREATE UNIQUE INDEX "brain_access_brain_id_agent_id_key"
    ON "brain_access"("brain_id", "agent_id");
