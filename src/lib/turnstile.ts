/**
 * Cloudflare Turnstile server-side verification.
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult = {
  ok: boolean;
  error?: string;
};

export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string | null,
): Promise<TurnstileResult> {
  if (!token) return { ok: false, error: "missing_token" };

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Fail open in dev if secret isn't configured. Log loudly so it's noticed.
    if (process.env.NODE_ENV !== "production") {
      console.warn("[turnstile] TURNSTILE_SECRET_KEY not set — allowing in dev");
      return { ok: true };
    }
    return { ok: false, error: "server_misconfigured" };
  }

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  let res: Response;
  try {
    res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body,
      cache: "no-store",
    });
  } catch (err) {
    console.error("[turnstile] network error", err);
    return { ok: false, error: "network" };
  }

  if (!res.ok) {
    return { ok: false, error: `http_${res.status}` };
  }

  const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
  if (!data.success) {
    return { ok: false, error: (data["error-codes"] ?? ["unknown"]).join(",") };
  }
  return { ok: true };
}
