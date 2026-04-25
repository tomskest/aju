---
title: Turnstile bot protection
description: How Cloudflare Turnstile gates the signup form, and why it fails open in dev.
order: 25
---

# Turnstile bot protection

The only write endpoint that's reachable without authentication is `POST /api/signup`. It's also the one that both sends email and consumes a beta slot, which makes it the single most attractive abuse target in the app. Turnstile sits in front of it.

## Client integration

Source: `src/components/landing/SignupForm.tsx`.

- The Turnstile script (`https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`) is **loaded on demand**, not in the layout. A `useEffect` on the signup form appends the `<script>` tag the first time the form mounts, guarded by a `window.__ajuTurnstileLoaded` flag so we don't double-load on route transitions (`src/components/landing/SignupForm.tsx:56-98`).
- The widget is rendered via `turnstile.render(widgetRef.current, { sitekey, theme: "dark", size: "flexible", callback, "expired-callback", "error-callback" })` once the script resolves.
- The callback stores the token in component state; the form's submit handler sends `{ email, turnstileToken: token, returnTo? }` to `/api/signup` (`src/components/landing/SignupForm.tsx:106-115`).
- On any server-side failure the widget is reset via `window.turnstile.reset(widgetIdRef.current)` and `token` is cleared, so the user gets a fresh challenge rather than retrying with a spent token.

### Why dev skips the widget entirely

```ts
const turnstileEnabled = siteKey.length > 0;
// src/components/landing/SignupForm.tsx:54
```

When `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is empty (local dev), the form skips script injection and submit is allowed without a token. This pairs with the server-side fail-open below so that nobody has to wire up Turnstile to run the app locally.

## Server verification

Source: `src/lib/turnstile.ts`.

```ts
const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string | null,
): Promise<TurnstileResult> { … }
```

The function returns `{ ok: boolean; error?: string }`. Resolution order:

1. **No token** → `{ ok: false, error: "missing_token" }`.
2. **No `TURNSTILE_SECRET_KEY` env var and `NODE_ENV !== "production"`** → log a `console.warn` and return `{ ok: true }`. This is the **fail-open in dev** path (`src/lib/turnstile.ts:22-27`).
3. **No secret key in production** → `{ ok: false, error: "server_misconfigured" }`. Prod won't silently skip the check.
4. **POSTs to Cloudflare's siteverify** with `secret`, `response`, and optionally `remoteip`. `cache: "no-store"` — these responses must not be cached.
5. Network error → `{ ok: false, error: "network" }`.
6. Non-2xx → `{ ok: false, error: "http_<status>" }`.
7. `success: false` → joins `error-codes` into the `error` string so the call site can log it (we don't surface this to the client verbatim).
8. `success: true` → `{ ok: true }`.

### Why fail-open in dev

Forcing every contributor to register a Turnstile site key against `localhost` is friction without a security payoff — an attacker who can reach your laptop's dev server doesn't need a bypass around a Cloudflare widget. The `console.warn` makes it noisy enough that it won't silently ship to production misconfigured; the check in step 3 explicitly fails closed when `NODE_ENV === "production"`.

## How `/api/signup` uses it

`src/app/api/signup/route.ts:68-73`:

```ts
const remoteIp =
  req.headers.get("cf-connecting-ip") ??
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
  null;
const turnstile = await verifyTurnstile(turnstileToken, remoteIp);
if (!turnstile.ok) {
  return NextResponse.json(
    { error: "turnstile_failed", detail: turnstile.error },
    { status: 400 },
  );
}
```

Key details:

- Cloudflare's header comes first (`cf-connecting-ip`), with `x-forwarded-for`'s first hop as a Railway-proxy fallback.
- A 400 (not 403) is returned on failure, with a machine-readable `error` key. The signup form maps `"turnstile_failed"` to a user-visible "please retry the captcha" message (see `SignupForm.tsx:205`).
- The same token is never accepted twice — Cloudflare's siteverify API itself rejects replay, and the client resets the widget on any server-reported failure.

## What's NOT behind Turnstile

- `/api/verify` — the magic-link GET. The token itself is the proof of work, and a bot that solved Turnstile once to get the link would still have to receive an email. Adding a second challenge here would just cost UX.
- `/api/keys`, `/api/orgs`, everything else — all require a session cookie or bearer key, so there's no anonymous request surface to protect.
- CLI device flow — approve actions require a session; poll requires a valid device code from `start`. Neither is spammable in the way signup is.

## Limitations

Turnstile is not a rate limiter. It stops scripted abuse, not a single determined human creating burner emails. The cohort cap + waitlist absorb that case: even if someone burns through Turnstile with real solves, they fill up slots at email-delivery speed, not request speed, and the 100-user cap is the real floor.

> TODO: verify — there is currently no per-IP or per-email rate limit on `/api/signup` in code; repeat submits for the same email just upsert a new `Verification` row. The existing row is not deleted, so multiple live links can coexist until their 30-minute TTLs elapse or one is consumed.
