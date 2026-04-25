import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";

/**
 * Shared crypto helpers for the OAuth 2.1 authorization server.
 *
 * Design notes:
 *   - Authorization codes are short-lived opaque strings we hash with SHA-256
 *     (fast; scrypt is overkill for a single-use 10-min value).
 *   - Client secrets and refresh tokens use scrypt (same parameters as
 *     src/lib/api-key.ts) because they live longer and need to resist
 *     offline cracking.
 *   - Access tokens are minted via src/lib/api-key.ts directly — they ARE
 *     ApiKey rows — so no new code path here.
 */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SALT_LEN = 16;

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export type ScryptHash = string; // "<salt-hex>:<hash-hex>"

export function hashSecret(plaintext: string): ScryptHash {
  const salt = randomBytes(SALT_LEN);
  const derived = scryptSync(plaintext, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifySecret(plaintext: string, stored: ScryptHash): boolean {
  const sep = stored.indexOf(":");
  if (sep <= 0) return false;

  const saltHex = stored.slice(0, sep);
  const hashHex = stored.slice(sep + 1);
  if (!saltHex || !hashHex) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (expected.length !== SCRYPT_KEYLEN) return false;

  const candidate = scryptSync(plaintext, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

/**
 * Verify a PKCE `code_verifier` against a stored S256 `code_challenge`.
 * Per RFC 7636 §4.2: challenge = BASE64URL(SHA256(verifier)).
 */
export function verifyPkceS256(
  verifier: string,
  challenge: string,
): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  // constant-time compare of equal-length strings
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
