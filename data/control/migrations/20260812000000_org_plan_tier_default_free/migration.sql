-- Signups are open: organizations created from here on default to the free
-- tier. Existing rows keep their value — the beta cohort's beta_legacy
-- grandfathering is a per-row fact, not a default.
ALTER TABLE "organization" ALTER COLUMN "plan_tier" SET DEFAULT 'free';
