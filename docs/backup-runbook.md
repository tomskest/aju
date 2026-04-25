# Backup runbook — pg_dump → S3

## Purpose

Neon already gives us per-branch point-in-time recovery (PITR) for the whole
project. That's great for "the whole control plane got corrupted at 14:32" —
not so great for "one tenant wants their data back from last Tuesday without
rolling back every other tenant alongside them."

This job complements Neon PITR with **per-database logical dumps** stored in
S3. Each tenant DB (and the control DB) gets its own `pg_dump --format=custom`
file. Restoring one tenant is a single `pg_restore` against a fresh, empty
tenant DB.

## How it runs

The job lives in [`.github/workflows/backup.yml`](../.github/workflows/backup.yml).
It is **manual-only by default** — no `schedule:` trigger until we opt in.

- **Trigger manually**: GitHub → Actions → `backup` → Run workflow.
- **Enable nightly schedule**: uncomment the `schedule:` block at the top of
  `backup.yml`. Keep the `workflow_dispatch` trigger so ad-hoc runs still
  work.

## Required GitHub Secrets

| Secret | Purpose |
|--------|---------|
| `DATABASE_URL` | Control-plane direct DSN (the Prisma migrate DSN). |
| `TENANT_DSN_ENC_KEY` | AES-GCM key for `decryptDsn`, same as runtime. |
| `AWS_DEFAULT_REGION` | e.g. `eu-central-1`. |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Backup IAM role creds. Scope to `s3:PutObject`, `s3:AbortMultipartUpload`, and `s3:ListBucketMultipartUploads` on the bucket. |
| `BACKUP_S3_BUCKET` | Target bucket, e.g. `aju-backups-prod`. |
| `BACKUP_S3_PREFIX` | Key prefix, defaults to `backups`. |
| `BACKUP_S3_KMS_KEY_ID` | *Optional.* SSE-KMS key id; leave unset to fall back to SSE-S3 (AES256). |
| `AWS_ENDPOINT_URL` | *Optional.* Non-AWS S3 endpoints (Railway Bucket, MinIO). |

## Object layout

```
s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/
    control/                        # synthetic org id for the control DB
        2026-04-22_020012.dump
    <organizationId>/
        2026-04-22_020019.dump
    <organizationId>/
        2026-04-22_020027.dump
    ...
```

Timestamps are UTC. One object per tenant per run.

## Retention

**The workflow does not prune old dumps.** Configure an S3 Lifecycle rule on
the bucket instead, e.g.:

- Transition to `Glacier Instant Retrieval` after 30 days.
- Expire after 365 days.

Keeping retention in S3 (not in the job) means a runaway workflow can't wipe
history, and restore tooling doesn't need to know anything about retention.

## Restore a single tenant

1. Pick the dump you want out of S3:
   `s3://$BUCKET/$PREFIX/<organizationId>/<stamp>.dump`.
2. Provision a **fresh, empty** database for that tenant — either a new Neon
   branch, or a scratch database where you've run the tenant schema.
   `pg_restore` against the live tenant DB would merge rather than replace.
3. Download the dump and restore it:

   ```sh
   aws s3 cp s3://$BUCKET/$PREFIX/<organizationId>/<stamp>.dump ./tenant.dump
   pg_restore \
     --clean --if-exists \
     --no-owner --no-privileges \
     --dbname="$FRESH_TENANT_DSN" \
     ./tenant.dump
   ```

4. Point the tenant's `dsn_direct_enc` / `dsn_pooled_enc` at the restored DB
   (via an admin tool or a one-off migration). Evict the cached Prisma client
   from the running app so the new DSN is picked up.

## Security

- Dumps are encrypted at rest: `AES256` (SSE-S3) by default, `aws:kms` when
  `BACKUP_S3_KMS_KEY_ID` is set.
- Restrict the bucket policy to **only** the backup uploader role (write-only
  on this prefix) and the on-call restore role (read + abort-multipart).
- Enable `Block Public Access` on the bucket at account and bucket level.
- Enable bucket versioning so an accidental overwrite doesn't destroy yesterday's dump.
- The script never logs full DSNs, bucket keys with tenant ids, or pg_dump
  stdout. `info`-level logs redact org ids to a 6-char fingerprint; the full
  org id only appears in the final structured summary that is expected to go
  to the Actions run log.

## Frequency considerations

- Nightly (02:00 UTC) is a sensible default once enabled: low-traffic window,
  matches typical RPO expectations for B2B SaaS.
- Running more often (say every 4 hours) is cheap on the compute side —
  `pg_dump` is I/O-bound — but doubles S3 storage and lifecycle pressure.
- The dump uses `--format=custom` (compressed). Expect ~20–40% of raw data
  size per tenant.
- A single tenant dump of ~10 GB takes a few minutes with streaming. The
  workflow's `timeout-minutes: 60` is generous; raise if you see it clipped.

## Running locally

Requires `pg_dump` on your PATH matching the server's major version (17).

```sh
# macOS
brew install postgresql@17
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"

# then:
npm run backup:pg-dump
```

If `pg_dump` is missing or on the wrong major, the script logs a clear
failure per target; no partial success will look healthy.

## Failure mode

If any target (control or tenant) fails, the script exits with code `1`
**after** attempting every remaining target. Read the per-target `event:
backup.target.fail` log line for the first 120 chars of the error hint; the
final `event: backup.summary` JSON carries the full message.

A failed run should page on-call if you've wired the workflow to alerting
(see "Unresolved" in the PR description — no alarm is configured yet).
