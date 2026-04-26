---
title: Files and storage
description: Binary uploads, presigned URLs, text extraction, and categories.
order: 50
---

# Files and storage

Binary attachments (PDFs, images, arbitrary blobs) live in object storage —
**Tigris** in production (Railway-managed, S3-compatible), any other
S3-compatible endpoint when self-hosting. The database only stores
**metadata** and, where possible, extracted plain text for search.

Two tables matter, both in the tenant DB:

- `VaultFile` (`data/tenant/schema.prisma`) — one row per uploaded file.
- `VaultChangeLog` — every upload / delete is logged
  (`operation = "file-upload" | "file-delete"`).

## The storage client — one handle per tenant

`src/lib/tenant/storage.ts` mirrors the `tenantDbFor(orgId)` pattern: every
read or write for a tenant goes through a handle scoped to that tenant's
bucket and credentials. The runtime never holds an admin-power key — only
per-tenant scoped keys, decrypted on demand from the `Tenant` row.

```ts
import { storageFor } from "@/lib/tenant/storage";

const storage = await storageFor(orgId);
await storage.put(key, buffer, contentType);
const url = await storage.presignPut(key, contentType, 3600);
```

`TenantStorage` exposes:

- `put(key, body, contentType)` — direct Put for small server-side uploads.
- `get(key)` — read bytes back (used for text extraction on confirm).
- `delete(key)` — remove the object.
- `deleteMany(keys)` — batch delete (capped at 1000 keys per call by S3).
- `presignGet(key, expiresIn=3600)` — GET presign for client download.
- `presignPut(key, contentType, expiresIn=3600)` — PUT presign for client
  upload.

Under the hood it's `@aws-sdk/client-s3` with a configurable endpoint —
default `https://t3.storage.dev` (Tigris), region `auto`. The same code
hits Tigris (Railway), Cloudflare R2, AWS S3, Backblaze B2, or a local
MinIO without branching; only the endpoint and credentials change.

### Per-tenant credential isolation

Each tenant row carries its own bucket name plus encrypted access key.
Keys are encrypted at rest with `STORAGE_CRED_ENC_KEY` (AES-GCM) and
decrypted in `src/lib/storage/` (`decryptStorageSecret`). Buckets are
provisioned out-of-band by `scripts/provision-tigris-bucket.ts`
(operator-run; shells out to the `tigris` CLI).

**Transitional fallback:** if a tenant row has no `storageBucket` yet, the
handle falls back to the shared `AWS_S3_BUCKET_NAME` + `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` env vars. Once every active tenant has been
backfilled, the fallback branch and the shared env vars go away and the
per-tenant storage columns become required.

## Key layout

`<brainName>/files/<category>/<filename>` when a category is set, else
`<brainName>/files/<filename>`
(`src/app/api/vault/files/presign-upload/route.ts`,
`src/app/api/vault/files/upload/route.ts`).

`s3Key` is unique within the tenant DB (`VaultFile.s3Key @unique`). In
production each org has its own bucket, so the brain-prefixed key is the
human-readable layer on top of bucket-level isolation. Self-hosters who
run multiple orgs against a shared bucket should add an org prefix or move
to one bucket per org if a bigger blast-radius separation matters.

**Why encode the brain name in the key:** browsing the bucket with any
generic S3 tool produces a human-readable tree. The downside is that
renaming a brain strands its files under the old prefix — an acceptable
tradeoff given renames are rare.

## Two upload paths

### Direct upload: POST `/api/vault/files/upload`

`src/app/api/vault/files/upload/route.ts` — the client base64-encodes the
file and posts the bytes through the Next.js server. The server:

1. Resolves the target brain, enforces `canWrite`.
2. Checks for duplicate `s3Key` (409 on collision).
3. Decodes the base64, PUTs to object storage.
4. Attempts text extraction (`src/lib/storage/extract-text.ts` — PDFs via
   `pdf-parse`, any `text/*` mime as UTF-8). Failures are **non-fatal**.
5. Creates the `VaultFile` row and a changelog entry in a transaction.
6. Fires off an embedding update if text was extracted.

Suited to small files where the round-trip through the app server is fine.

### Presigned upload: POST `/api/vault/files/presign-upload` → PUT to storage → POST `/api/vault/files/confirm-upload`

1. `presign-upload` (`src/app/api/vault/files/presign-upload/route.ts`) —
   the client asks the server for a time-limited PUT URL (default 1h
   expiry). The server returns `{ uploadUrl, s3Key, contentType, method,
   headers }`.
2. Client PUTs the bytes directly to object storage. Nothing transits the
   Next.js server.
3. `confirm-upload` (`src/app/api/vault/files/confirm-upload/route.ts`) —
   client tells the server "I uploaded to this key". The server reads the
   object back from storage to compute `sizeBytes` and extract text, then
   creates the `VaultFile` row.

**Why two paths:** large files (hundreds of MB, PDFs, presentations)
shouldn't travel through a Next.js API route — Vercel / Railway have
request-size caps and the base64 overhead is 33%. The presigned flow lets
the bytes go straight to object storage. Small files keep the simpler
single-call path.

## Size limit: 25 MB per file

All three upload paths enforce a hard cap of **25 MB per file**
(`MAX_UPLOAD_BYTES`, `src/lib/config.ts`). The limit is checked at:

- `POST /api/vault/files/upload` — rejects before decoding the base64 body.
- `POST /api/vault/files/presign-upload` — rejects before issuing the
  presigned PUT URL, based on the declared `sizeBytes`.
- `POST /api/vault/files/confirm-upload` — re-checks the actual object
  size after the client has uploaded. If the object is oversized, the
  server deletes it before returning the error.

On reject, the response is HTTP **413 Payload Too Large** with:

```json
{ "error": "file_too_large", "maxBytes": 26214400 }
```

**Why re-check at confirm:** the presign step only knows what the client
*claimed* the size would be. A client can lie and then PUT a larger
object directly to the bucket. The confirm handler is the authoritative
check — it HEADs the uploaded object, and if it exceeds `MAX_UPLOAD_BYTES`
it deletes the object and returns 413. No orphaned oversized objects
remain in the bucket.

## Reading files

`GET /api/vault/files/read?key=<s3Key>&mode=<metadata|url|content>`
(`src/app/api/vault/files/read/route.ts`):

- `metadata` (default) — returns the `VaultFile` row.
- `url` — returns the metadata plus a 1h presigned download URL.
- `content` — streams the bytes base64-encoded inside the JSON response.

The CLI's default is `metadata`; `--mode url` is what the docs recommend
for human consumption.

## Listing

`GET /api/vault/files/list` (`src/app/api/vault/files/list/route.ts`) —
returns every file in the current brain, filterable by `category` or
`mimeType`. Ordered by `createdAt desc`.

## Deletion

`POST /api/vault/files/delete` (`src/app/api/vault/files/delete/route.ts`):

1. Resolve brain, enforce `canWrite`.
2. Find the `VaultFile` by `(s3Key, brainId)`.
3. **Log first** — insert a changelog row with `operation="file-delete"`.
4. `storage.delete(key)` then `VaultFile.delete`.

Order matters: logging first means the audit trail survives even if the
storage delete fails halfway. The DB row is deleted last so a replayable
state exists if the storage call errors mid-operation.

## Text extraction

`src/lib/storage/extract-text.ts`:

- `application/pdf` → `pdf-parse`, returns the plain-text body.
- `text/*` → UTF-8 decode of the buffer.
- Anything else → `null` (images, binaries are stored without text).

Extraction is **always wrapped in try/catch and treated non-fatal**:

```ts
try {
  text = await extractText(buffer, contentType);
  if (text) textHash = computeTextHash(text);
} catch (err) {
  console.error("Text extraction failed (non-fatal):", err);
}
```

**Why non-fatal:** a corrupt PDF or malformed text file should not block
the upload. The file still gets stored and the user can still download it;
it's just not searchable by content.

The extracted text is stored on `VaultFile.extractedText` (`@db.Text`), and
its SHA-256 `textHash` enables cheap dedup checks.

## Categories and tags

`VaultFile.category` is a free-form string (e.g. `annual-reports`,
`slides`, `receipts`) used to organise both the storage prefix and the
filter surface in the list endpoint. `tags` is a `String[]` for
cross-cutting classification. Neither has a controlled vocabulary.
