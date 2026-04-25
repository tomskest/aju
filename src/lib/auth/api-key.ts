import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

/**
 * API-key generation + verification helpers for the CLI device flow.
 *
 * Plaintext format: `aju_live_<32-char-base64url>` (total length: 41 chars).
 * We hand this string to the CLI exactly once; the server stores only:
 *   - `prefix`: the first 12 characters, so we can recognize a key at a glance
 *               (e.g. `aju_live_a1b2c3`) without being able to reconstruct it.
 *   - `hash`: scrypt hash of the remainder, stored as `<salt-hex>:<hash-hex>`.
 *
 * Verification rehashes the presented plaintext remainder with the stored
 * salt and performs a constant-time compare.
 */

const PLAINTEXT_PREFIX = "aju_live_";
const RANDOM_BYTES_LEN = 24; // -> 32 char base64url
const PREFIX_LEN = 12;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SALT_LEN = 16;

export type GeneratedApiKey = {
  plaintext: string;
  prefix: string;
  hash: string;
};

export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(RANDOM_BYTES_LEN).toString("base64url");
  const plaintext = `${PLAINTEXT_PREFIX}${secret}`;
  const prefix = plaintext.slice(0, PREFIX_LEN);
  const remainder = plaintext.slice(PREFIX_LEN);

  const salt = randomBytes(SALT_LEN);
  const derived = scryptSync(remainder, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  const hash = `${salt.toString("hex")}:${derived.toString("hex")}`;
  return { plaintext, prefix, hash };
}

export function verifyApiKey(plaintext: string, storedHash: string): boolean {
  if (!plaintext.startsWith(PLAINTEXT_PREFIX)) return false;
  if (plaintext.length <= PREFIX_LEN) return false;

  const separatorIdx = storedHash.indexOf(":");
  if (separatorIdx <= 0) return false;

  const saltHex = storedHash.slice(0, separatorIdx);
  const hashHex = storedHash.slice(separatorIdx + 1);
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

  const remainder = plaintext.slice(PREFIX_LEN);
  const candidate = scryptSync(remainder, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}
