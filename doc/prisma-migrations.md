# Prisma Migrations

Two schemas, two migration histories:

- `data/control/schema.prisma` → the shared control-plane DB (Better-Auth,
  orgs, api keys, tenant routing). Migrations in `data/control/migrations/`.
- `data/tenant/schema.prisma` → applied to every per-org tenant DB (brains,
  vault docs, agents). Migrations in `data/tenant/migrations/`.

Both histories start at `20260422000000_init`, a baseline that captures the
current production shape.

## Golden rule

Never run `prisma db push` against production. `db push` silently diverges
the DB from the migration history and makes future `migrate deploy` calls
unpredictable.

## One-time baseline (required before first deploy of this code)

Production DBs pre-date the migration history, so `_prisma_migrations` is
missing. Run once per DB from a machine with the DSN:

```bash
# Control DB
DATABASE_URL=<control direct DSN> \
  npx prisma migrate resolve \
  --schema data/control/schema.prisma \
  --applied 20260422000000_init

# Each tenant DB
TENANT_DATABASE_URL=<tenant direct DSN> \
  npx prisma migrate resolve \
  --schema data/tenant/schema.prisma \
  --applied 20260422000000_init
```

After that, `prisma migrate deploy` on boot will pick up from
`20260422000100_add_updated_at` onward.

For the control DB you can also run `npm run db:migrate:baseline:control`
once the `DATABASE_URL` env var is set.

## Control-plane flow

1. Local dev: edit `schema.prisma`, then
   `npx prisma migrate dev --create-only --schema data/control/schema.prisma`.
   Review the generated SQL, commit.
2. Boot (`npm start`) runs
   `prisma migrate deploy --schema data/control/schema.prisma` before
   starting Next.
3. Use `npm run db:migrate:status:control` to inspect applied/pending state.

## Tenant flow

Tenants are many DBs behind one schema. `scripts/tenant-migrate.ts` drives
the deploy for each active tenant in `tenant` table. Per tenant:

1. Acquire a Postgres advisory lock keyed by tenant DB name (guards against
   concurrent deploys).
2. Shell out to `prisma migrate deploy --schema data/tenant/schema.prisma`
   with `TENANT_DATABASE_URL=<direct DSN>`.
3. Re-apply the raw-SQL setup files that Prisma cannot manage:
   - `data/tenant/vector-setup.sql` — pgvector extension + vector columns
   - `data/tenant/fts-setup/migration.sql` — `tsvector` + FTS triggers
   - `data/tenant/fts-setup/files-fts.sql` — file FTS triggers
   - `data/tenant/rls-policies.sql` — RLS policies + CHECK constraints
   All four are idempotent.
4. Bump `tenant.schema_version` and `tenant.last_migrated_at`.

Brand-new tenants go through `src/lib/tenant-provision.ts`, which runs the
same `migrate deploy` against the fresh DB, then applies the raw-SQL setup
files. No baseline resolve is needed because the DB starts empty.

### Why RLS / vector / FTS stay outside Prisma

Prisma migrations describe tables, indexes, and FKs. They cannot describe:
- extensions (`CREATE EXTENSION vector`, `pg_trgm`)
- generated columns and triggers (`tsvector_update_trigger` for FTS)
- RLS policies (`CREATE POLICY ... USING (...)`)
- Check constraints that depend on app state

Those live in `data/tenant/*.sql` and are re-applied on every
`tenant-migrate` pass. They are written to be safely re-runnable.

## Adding a new migration

Always use `--create-only` so you can review the SQL before it hits any
database:

```bash
npx prisma migrate dev --create-only \
  --schema data/control/schema.prisma \
  --name descriptive_name
```

For offline generation (no DB connection at all), use `migrate diff`:

```bash
npx prisma migrate diff \
  --from-schema-datasource data/control/schema.prisma \
  --to-schema-datamodel data/control/schema.prisma \
  --script > data/control/migrations/<timestamp>_<name>/migration.sql
```

Commit the generated folder under `prisma/<schema>/migrations/` and ship.
`npm start` in production will pick it up via `migrate deploy`.

## Handy commands

```bash
# Control
npm run db:migrate:status:control       # show applied vs pending
npm run db:migrate:deploy:control       # apply pending migrations
npm run db:migrate:baseline:control     # mark init as applied (one-shot)

# Tenant
npm run db:migrate:tenant               # deploy to every active tenant
```
