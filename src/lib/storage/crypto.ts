/**
 * AES-GCM encryption for per-tenant object-storage credentials.
 *
 * Keyed by `STORAGE_CRED_ENC_KEY` (32 bytes, base64 — generate with
 * `openssl rand -base64 32`). Deliberately a separate secret from
 * `TENANT_DSN_ENC_KEY` so compromise of one doesn't leak the other;
 * tenant-crypto.ts handles DB DSNs, this module handles S3/Tigris keys.
 *
 * Ciphertext format mirrors tenant-crypto: `v1:<iv-b64>:<ciphertext-b64>:<tag-b64>`.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const VERSION = "v1";

function keyBuffer(): Buffer {
  const raw = process.env.STORAGE_CRED_ENC_KEY;
  if (!raw) {
    throw new Error(
      "STORAGE_CRED_ENC_KEY is not set — required for tenant storage credential encryption",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `STORAGE_CRED_ENC_KEY must decode to 32 bytes (got ${key.length}); generate with \`openssl rand -base64 32\``,
    );
  }
  return key;
}

export function encryptStorageSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, keyBuffer(), iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${ct.toString("base64")}:${tag.toString("base64")}`;
}

export function decryptStorageSecret(encoded: string): string {
  const parts = encoded.split(":");
  if (parts.length !== 4) {
    throw new Error("decryptStorageSecret: malformed ciphertext");
  }
  const [version, ivB64, ctB64, tagB64] = parts;
  if (version !== VERSION) {
    throw new Error(`decryptStorageSecret: unsupported version ${version}`);
  }
  const iv = Buffer.from(ivB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const decipher = createDecipheriv(ALGO, keyBuffer(), iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
