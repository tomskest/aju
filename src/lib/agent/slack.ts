/**
 * Slack glue for aju Tag: Events API signature verification, a minimal
 * fetch-based Web API client, the OAuth v2 install exchange, and the signed
 * `state` token that carries org/user identity through the install redirect.
 *
 * Deliberately not @slack/web-api — we call six endpoints; a thin typed
 * client keeps the dependency surface flat. All Web API calls are sent
 * form-encoded (accepted by every method, unlike JSON which only write
 * methods support).
 *
 * Bot tokens are AES-GCM encrypted at rest with the same envelope as tenant
 * DSNs (src/lib/tenant/crypto.ts); callers pass the decrypted token in and
 * must never log it.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const SLACK_API = "https://slack.com/api";
const SIGNATURE_VERSION = "v0";
const MAX_TIMESTAMP_SKEW_S = 60 * 5;

// ─── Events API signature verification ─────────────────────────────────────

export function verifySlackSignature(opts: {
  signingSecret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
}): boolean {
  const { signingSecret, timestamp, signature, rawBody } = opts;
  if (!timestamp || !signature) return false;
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  // Replay window: Slack retries within minutes; anything older is replay.
  if (Math.abs(Date.now() / 1000 - ts) > MAX_TIMESTAMP_SKEW_S) return false;

  const base = `${SIGNATURE_VERSION}:${timestamp}:${rawBody}`;
  const expected = `${SIGNATURE_VERSION}=${createHmac("sha256", signingSecret)
    .update(base)
    .digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ─── Minimal Web API client ─────────────────────────────────────────────────

type SlackErr = { ok: false; error: string };

export type SlackMessage = {
  type: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
};

export class SlackApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: string,
  ) {
    super(`Slack ${method} failed: ${code}`);
    this.name = "SlackApiError";
  }
}

export class SlackClient {
  constructor(private readonly botToken: string) {}

  private async call<T>(
    method: string,
    payload: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(payload)) {
      if (v !== undefined) form.set(k, String(v));
    }
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Bearer ${this.botToken}`,
      },
      body: form,
    });
    const data = (await res.json()) as (T & { ok: true }) | SlackErr;
    if (!data.ok) throw new SlackApiError(method, data.error);
    return data;
  }

  async postMessage(args: {
    channel: string;
    text: string;
    threadTs?: string;
  }): Promise<{ ts: string }> {
    const r = await this.call<{ ts: string }>("chat.postMessage", {
      channel: args.channel,
      text: args.text,
      thread_ts: args.threadTs,
      unfurl_links: false,
      unfurl_media: false,
    });
    return { ts: r.ts };
  }

  /** Thread messages, oldest first. `ts` is the thread parent. */
  async conversationsReplies(args: {
    channel: string;
    ts: string;
    limit?: number;
  }): Promise<SlackMessage[]> {
    const r = await this.call<{ messages?: SlackMessage[] }>("conversations.replies", {
      channel: args.channel,
      ts: args.ts,
      limit: args.limit ?? 50,
    });
    return r.messages ?? [];
  }

  /** Recent channel messages, oldest first (history returns newest-first). */
  async conversationsHistory(args: { channel: string; limit?: number }): Promise<SlackMessage[]> {
    const r = await this.call<{ messages?: SlackMessage[] }>("conversations.history", {
      channel: args.channel,
      limit: args.limit ?? 10,
    });
    return (r.messages ?? []).slice().reverse();
  }

  async conversationsInfo(channel: string): Promise<{ id: string; name?: string }> {
    const r = await this.call<{ channel: { id: string; name?: string } }>("conversations.info", {
      channel,
    });
    return r.channel;
  }

  async usersInfo(user: string): Promise<{ id: string; name: string }> {
    const r = await this.call<{
      user: {
        id: string;
        name: string;
        real_name?: string;
        profile?: { display_name?: string };
      };
    }>("users.info", { user });
    return {
      id: r.user.id,
      name: r.user.profile?.display_name || r.user.real_name || r.user.name,
    };
  }
}

// ─── OAuth v2 install exchange ──────────────────────────────────────────────

/** Bot scopes requested at install. Keep in sync with the Slack app config. */
export const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "channels:read",
  "groups:history",
  "chat:write",
  "users:read",
].join(",");

export type SlackOAuthResult = {
  teamId: string;
  teamName: string;
  botUserId: string;
  botToken: string;
  scopes: string;
};

export async function oauthV2Access(args: {
  code: string;
  redirectUri: string;
}): Promise<SlackOAuthResult> {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("SLACK_CLIENT_ID / SLACK_CLIENT_SECRET not configured");
  }
  const form = new URLSearchParams({
    code: args.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: args.redirectUri,
  });
  const res = await fetch(`${SLACK_API}/oauth.v2.access`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const data = (await res.json()) as {
    ok: boolean;
    error?: string;
    access_token?: string;
    scope?: string;
    bot_user_id?: string;
    team?: { id: string; name: string };
  };
  if (!data.ok || !data.access_token || !data.team) {
    throw new SlackApiError("oauth.v2.access", data.error ?? "unknown");
  }
  return {
    teamId: data.team.id,
    teamName: data.team.name,
    botUserId: data.bot_user_id ?? "",
    botToken: data.access_token,
    scopes: data.scope ?? "",
  };
}

// ─── Signed OAuth state ─────────────────────────────────────────────────────
//
// The install redirect round-trips through Slack; `state` carries which org
// and which admin initiated the install, HMAC-signed so the callback can't
// be pointed at someone else's org. Keyed off TENANT_DSN_ENC_KEY (already a
// required 32-byte secret) — no new env var. Org/user ids are cuid/alnum,
// so "." is a safe separator.

const STATE_TTL_MS = 10 * 60 * 1000;

function stateKey(): Buffer {
  const raw = process.env.TENANT_DSN_ENC_KEY;
  if (!raw) {
    throw new Error("TENANT_DSN_ENC_KEY required for Slack OAuth state");
  }
  return Buffer.from(raw, "base64");
}

export function makeOAuthState(orgId: string, userId: string): string {
  const exp = Date.now() + STATE_TTL_MS;
  const body = `${orgId}.${userId}.${exp}`;
  const mac = createHmac("sha256", stateKey()).update(body).digest("base64url");
  return Buffer.from(`${body}.${mac}`).toString("base64url");
}

export function verifyOAuthState(state: string): { orgId: string; userId: string } | null {
  let decoded: string;
  try {
    decoded = Buffer.from(state, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const parts = decoded.split(".");
  if (parts.length !== 4) return null;
  const [orgId, userId, expStr, mac] = parts;
  const expected = createHmac("sha256", stateKey())
    .update(`${orgId}.${userId}.${expStr}`)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (!Number.isFinite(Number.parseInt(expStr, 10))) return null;
  if (Number.parseInt(expStr, 10) < Date.now()) return null;
  return { orgId, userId };
}
