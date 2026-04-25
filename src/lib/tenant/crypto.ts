/**
 * AES-GCM encryption for per-tenant DSNs.
 *
 * Key is `TENANT_DSN_ENC_KEY` (32 bytes, base64). Generate with:
 *   openssl rand -base64 32
 *
 * Ciphertext format: `v1:<iv-b64>:<ciphertext-b64>:<tag-b64>`.
 * The `v1:` prefix lets us roll the key by supporting a second version in
 * parallel on rotation — `v1` decrypt with the primary key; writes re-encrypt
 * to `v2` once the new key is live.
 *
 * Never log the plaintext DSN. The helpers here are the only code path that
 * sees it; callers should pass the ciphertext around everywhere else.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard
const VERSION = "v1";

function keyBuffer(): Buffer {
  const raw = process.env.TENANT_DSN_ENC_KEY;
  if (!raw) {
    throw new Error(
      "TENANT_DSN_ENC_KEY is not set — required for tenant DSN encryption",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `TENANT_DSN_ENC_KEY must decode to 32 bytes (got ${key.length}); generate with \`openssl rand -base64 32\``,
    );
  }
  return key;
}

export function encryptDsn(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, keyBuffer(), iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${ct.toString("base64")}:${tag.toString("base64")}`;
}

export function decryptDsn(encoded: string): string {
  const parts = encoded.split(":");
  if (parts.length !== 4) {
    throw new Error("decryptDsn: malformed ciphertext");
  }
  const [version, ivB64, ctB64, tagB64] = parts;
  if (version !== VERSION) {
    throw new Error(`decryptDsn: unsupported version ${version}`);
  }
  const iv = Buffer.from(ivB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const decipher = createDecipheriv(ALGO, keyBuffer(), iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
