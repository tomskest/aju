import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeOAuthState, verifyOAuthState, verifySlackSignature } from "./slack";

const SECRET = "8f742231b10e8888abcd99yyyzzz85a5";

function sign(secret: string, timestamp: string, body: string): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
}

describe("verifySlackSignature", () => {
  const body = JSON.stringify({ type: "event_callback", event_id: "Ev123" });

  it("accepts a valid signature", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: ts,
        signature: sign(SECRET, ts, body),
        rawBody: body,
      }),
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: ts,
        signature: sign(SECRET, ts, body),
        rawBody: body + "x",
      }),
    ).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: ts,
        signature: sign("other-secret", ts, body),
        rawBody: body,
      }),
    ).toBe(false);
  });

  it("rejects a stale timestamp (replay)", () => {
    const stale = String(Math.floor(Date.now() / 1000) - 6 * 60);
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: stale,
        signature: sign(SECRET, stale, body),
        rawBody: body,
      }),
    ).toBe(false);
  });

  it("rejects missing headers", () => {
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: null,
        signature: null,
        rawBody: body,
      }),
    ).toBe(false);
  });
});

describe("OAuth state", () => {
  beforeEach(() => {
    vi.stubEnv("TENANT_DSN_ENC_KEY", Buffer.from(new Uint8Array(32)).toString("base64"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips org and user ids", () => {
    const state = makeOAuthState("org_abc123", "user_xyz789");
    expect(verifyOAuthState(state)).toEqual({
      orgId: "org_abc123",
      userId: "user_xyz789",
    });
  });

  it("rejects a tampered state", () => {
    const state = makeOAuthState("org_abc123", "user_xyz789");
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const forged = Buffer.from(decoded.replace("org_abc123", "org_victim")).toString("base64url");
    expect(verifyOAuthState(forged)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyOAuthState("not-a-state")).toBeNull();
  });

  it("rejects an expired state", () => {
    vi.useFakeTimers();
    try {
      const state = makeOAuthState("org_abc123", "user_xyz789");
      vi.advanceTimersByTime(11 * 60 * 1000);
      expect(verifyOAuthState(state)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
