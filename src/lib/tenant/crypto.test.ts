/**
 * Unit tests for tenant-crypto.
 *
 * These tests focus on the invariants the rest of the system relies on:
 *   - encrypt/decrypt roundtrip preserves plaintext
 *   - ciphertext carries the v1: version prefix
 *   - AES-GCM authentication catches tampering
 *   - malformed / unsupported inputs fail loudly
 *   - key misconfiguration produces a clear error
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

async function loadFresh(): Promise<typeof import("./crypto")> {
  // Re-import so that any env-var change inside the test applies cleanly. The
  // module itself is stateless, but we force a fresh load anyway to avoid any
  // accidental caching surprises.
  vi.resetModules();
  return await import("./crypto");
}

function setValidKey(): void {
  process.env.TENANT_DSN_ENC_KEY = randomBytes(32).toString("base64");
}

function clearKey(): void {
  delete process.env.TENANT_DSN_ENC_KEY;
}

describe("tenant-crypto", () => {
  beforeEach(() => {
    clearKey();
  });

  it("roundtrips plaintext through encryptDsn/decryptDsn", async () => {
    setValidKey();
    const { encryptDsn, decryptDsn } = await loadFresh();
    const plaintext =
      "postgresql://alice:s3cret@host.neon.tech/org_abc?sslmode=require";
    const ciphertext = encryptDsn(plaintext);
    expect(ciphertext).not.toContain(plaintext);
    expect(decryptDsn(ciphertext)).toBe(plaintext);
  });

  it("prefixes ciphertext with v1:", async () => {
    setValidKey();
    const { encryptDsn } = await loadFresh();
    const ct = encryptDsn("anything");
    expect(ct.startsWith("v1:")).toBe(true);
    // Shape: v1:<iv>:<ct>:<tag>
    expect(ct.split(":")).toHaveLength(4);
  });

  it("detects tampering in the middle ciphertext segment", async () => {
    setValidKey();
    const { encryptDsn, decryptDsn } = await loadFresh();
    const ct = encryptDsn("sensitive-dsn-value");
    const parts = ct.split(":");
    // Mutate the ciphertext body (index 2) while keeping the base64 decodable.
    const body = Buffer.from(parts[2], "base64");
    body[Math.floor(body.length / 2)] ^= 0xff;
    parts[2] = body.toString("base64");
    const tampered = parts.join(":");
    expect(() => decryptDsn(tampered)).toThrow();
  });

  it("rejects malformed strings (wrong number of segments)", async () => {
    setValidKey();
    const { decryptDsn } = await loadFresh();
    expect(() => decryptDsn("not-a-ciphertext")).toThrow(/malformed/i);
    expect(() => decryptDsn("v1:only:three")).toThrow(/malformed/i);
    expect(() => decryptDsn("v1:a:b:c:d:e")).toThrow(/malformed/i);
  });

  it("rejects an unsupported version prefix", async () => {
    setValidKey();
    const { decryptDsn } = await loadFresh();
    // Shape matches but version is wrong.
    expect(() => decryptDsn("v2:aaaa:bbbb:cccc")).toThrow(/unsupported version/i);
  });

  it("throws a clear error when TENANT_DSN_ENC_KEY is missing", async () => {
    clearKey();
    const { encryptDsn } = await loadFresh();
    expect(() => encryptDsn("x")).toThrow(/TENANT_DSN_ENC_KEY/);
  });

  it("throws a clear error when TENANT_DSN_ENC_KEY is the wrong size", async () => {
    // 16 random bytes, base64 — half the required key material.
    process.env.TENANT_DSN_ENC_KEY = randomBytes(16).toString("base64");
    const { encryptDsn } = await loadFresh();
    expect(() => encryptDsn("x")).toThrow(/32 bytes/);
  });
});
