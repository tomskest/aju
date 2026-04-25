/**
 * GET /oauth/authorize — consent screen for the OAuth 2.1 authorization code
 * flow. If the caller isn't signed in, we bounce to the landing page's
 * sign-in form with a return_to back here. Once signed in, the user is asked
 * to approve the request; the approve button POSTs to
 * /api/oauth/authorize/approve which mints the code and returns the final
 * client redirect URL.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import {
  buildErrorRedirect,
  parseAuthorizeParams,
  validateAuthorizeParams,
} from "@/lib/auth/oauth/authorize";
import OAuthApproveControls from "@/components/oauth/OAuthApproveControls";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function singleValue(
  v: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function searchParamsToUrlSearchParams(
  raw: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) {
    const single = singleValue(v);
    if (single !== undefined) out.set(k, single);
  }
  return out;
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const raw = await searchParams;
  const search = searchParamsToUrlSearchParams(raw);
  const params = parseAuthorizeParams(search);
  const validation = await validateAuthorizeParams(params);

  if (!validation.ok) {
    if (validation.kind === "client-visible" && validation.redirectUri) {
      redirect(
        buildErrorRedirect(
          validation.redirectUri,
          validation.error,
          validation.errorDescription,
          validation.state,
        ),
      );
    }
    return (
      <ErrorShell
        title="this request can't be authorized."
        description={validation.errorDescription}
      />
    );
  }

  const user = await currentUser();
  if (!user) {
    const returnTo = `/oauth/authorize?${search.toString()}`;
    redirect(`/?return_to=${encodeURIComponent(returnTo)}`);
  }

  const { client, params: p } = validation;
  const scopes = p.scope.split(/\s+/).filter((s) => s.length > 0);
  const approvePayload = {
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: p.scope,
    state: p.state ?? "",
    code_challenge: p.codeChallenge,
    code_challenge_method: p.codeChallengeMethod,
    resource: p.resource ?? "",
  };

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)] text-[var(--color-ink)]">
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="flex w-full max-w-[520px] flex-col items-center gap-8 text-center">
          <Link
            href="/"
            className="text-[56px] font-light leading-none tracking-[-0.04em]"
          >
            aju
          </Link>
          <Panel
            eyebrow="authorize an app"
            headline={`connect ${client.clientName}`}
          >
            <div className="flex flex-col gap-4 text-left">
              <p className="text-[13px] text-[var(--color-muted)]">
                <span className="text-[var(--color-ink)]">{client.clientName}</span>{" "}
                wants to access your aju memory as{" "}
                <span className="text-[var(--color-ink)]">{user.email}</span>.
              </p>
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
                  permissions
                </p>
                <ul className="mt-2 flex flex-col gap-1 text-[13px] text-[var(--color-ink)]">
                  {scopes.map((s) => (
                    <li key={s} className="flex items-center gap-2">
                      <span className="inline-block h-1 w-1 rounded-full bg-[var(--color-accent)]" />
                      {scopeLabel(s)}
                    </li>
                  ))}
                </ul>
              </div>
              {client.clientUri && (
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
                  <a
                    href={client.clientUri}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-[var(--color-muted)]"
                  >
                    {new URL(client.clientUri).host}
                  </a>
                </p>
              )}
              <OAuthApproveControls payload={approvePayload} />
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
                only authorize apps you started yourself.
              </p>
            </div>
          </Panel>
        </div>
      </main>
    </div>
  );
}

function scopeLabel(scope: string): string {
  switch (scope) {
    case "mcp:tools":
      return "use aju tools to read, create, and update your notes";
    case "read":
      return "read your notes and metadata";
    case "write":
      return "create, update and delete notes";
    default:
      return scope;
  }
}

function ErrorShell({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)] text-[var(--color-ink)]">
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="flex w-full max-w-[520px] flex-col items-center gap-8 text-center">
          <Link
            href="/"
            className="text-[56px] font-light leading-none tracking-[-0.04em]"
          >
            aju
          </Link>
          <Panel eyebrow="authorization failed" headline={title}>
            <p className="text-[13px] text-[var(--color-muted)]">{description}</p>
          </Panel>
        </div>
      </main>
    </div>
  );
}

function Panel({
  eyebrow,
  headline,
  children,
}: {
  eyebrow: string;
  headline: string;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full rounded-xl border border-white/10 bg-[var(--color-panel)]/85 px-5 py-6 text-left shadow-[0_10px_40px_-20px_rgba(0,0,0,0.9)] backdrop-blur-sm">
      <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-accent)]">
        {eyebrow}
      </p>
      <h1 className="mt-2 text-[22px] font-light text-[var(--color-ink)]">
        {headline}
      </h1>
      <div className="mt-4">{children}</div>
    </div>
  );
}
