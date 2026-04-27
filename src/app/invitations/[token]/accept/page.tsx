import Link from "next/link";
import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import AcceptControls from "@/components/invitations/AcceptControls";

export const dynamic = "force-dynamic";

/**
 * Matches the hashing used everywhere else invites are looked up
 * (see `src/app/api/invitations/[token]/route.ts`).
 */
function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function daysUntil(date: Date): number {
  const ms = date.getTime() - Date.now();
  // Round up so "a few hours left" shows as "1 day" instead of "0".
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Direct prisma lookup — we're server-side in the same app, so there's no
  // reason to round-trip through the HTTP API.
  const invitation = token
    ? await prisma.invitation.findUnique({
        where: { tokenHash: hashInviteToken(token) },
        include: {
          organization: { select: { name: true } },
        },
      })
    : null;

  const user = await currentUser();

  const invalid =
    !invitation ||
    invitation.acceptedAt !== null ||
    invitation.expiresAt <= new Date();

  return (
    <Shell>
      {invalid ? (
        <InvalidState />
      ) : !user ? (
        <SignInPrompt token={token} email={invitation.email} />
      ) : user.email.toLowerCase() !== invitation.email.toLowerCase() ? (
        <EmailMismatch expectedEmail={invitation.email} />
      ) : (
        <AcceptCard
          token={token}
          orgName={invitation.organization.name}
          role={invitation.role}
          inviterName={await resolveInviterLabel(invitation.createdBy)}
          expiresAt={invitation.expiresAt}
        />
      )}
    </Shell>
  );
}

async function resolveInviterLabel(createdBy: string): Promise<string | null> {
  const inviter = await prisma.user.findUnique({
    where: { id: createdBy },
    select: { name: true, email: true },
  });
  if (!inviter) return null;
  return inviter.name || inviter.email;
}

// ---------- UI pieces ----------

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)] text-[var(--color-ink)]">
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="flex w-full max-w-xl flex-col items-center gap-8 text-center">
          <Link
            href="/"
            className="text-[56px] font-light leading-none tracking-[-0.04em]"
          >
            aju
          </Link>
          {children}
        </div>
      </main>
      <footer className="flex items-center justify-center gap-3 pb-8 text-[11px] font-mono text-[var(--color-faint)]">
        <span>aju.sh © {new Date().getFullYear()}</span>
        <span>·</span>
        <Link href="/legal/terms" className="hover:text-[var(--color-muted)]">
          terms
        </Link>
        <span>·</span>
        <Link href="/legal/privacy" className="hover:text-[var(--color-muted)]">
          privacy
        </Link>
      </footer>
    </div>
  );
}

function InvalidState() {
  return (
    <div className="flex w-full flex-col items-center gap-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--color-muted)]">
        invitation
      </p>
      <h1 className="text-[22px] font-light text-[var(--color-ink)]">
        invitation not found or expired
      </h1>
      <p className="text-[14px] leading-6 text-[var(--color-muted)]">
        the link may have been used already, been revoked, or timed out. ask
        the person who invited you to send a fresh one.
      </p>
      <Link
        href="/"
        className="mt-2 font-mono text-[12px] text-[var(--color-accent)] underline-offset-4 hover:underline"
      >
        back to aju.sh
      </Link>
    </div>
  );
}

function SignInPrompt({ token, email }: { token: string; email: string }) {
  const returnTo = `/invitations/${token}/accept`;
  const href = `/?return_to=${encodeURIComponent(returnTo)}&email=${encodeURIComponent(email)}`;

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--color-accent)]">
        invitation waiting
      </p>
      <h1 className="text-[22px] font-light text-[var(--color-ink)]">
        sign in to accept
      </h1>
      <p className="text-[14px] leading-6 text-[var(--color-muted)]">
        you&apos;ve been invited to join a workspace on aju. sign in with{" "}
        <span className="text-[var(--color-ink)]">{email}</span> to continue.
      </p>
      <div className="w-full rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5">
        <Link
          href={href}
          className="inline-flex w-full items-center justify-center rounded-md bg-[var(--color-accent)] px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.2em] text-[#050608] transition hover:opacity-90"
        >
          sign in to accept
        </Link>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
          we&apos;ll send a magic link to your inbox
        </p>
      </div>
    </div>
  );
}

function EmailMismatch({ expectedEmail }: { expectedEmail: string }) {
  return (
    <div className="flex w-full flex-col items-center gap-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--color-muted)]">
        wrong account
      </p>
      <h1 className="text-[22px] font-light text-[var(--color-ink)]">
        this invitation is for{" "}
        <span className="text-[var(--color-accent)]">{expectedEmail}</span>.
      </h1>
      <p className="text-[14px] leading-6 text-[var(--color-muted)]">
        sign out and try a different account, or ask the sender to re-invite
        your current email.
      </p>
      <form action="/api/auth/signout" method="post" className="w-full">
        <div className="w-full rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5">
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-md border border-white/10 px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--color-ink)] transition hover:border-white/20"
          >
            sign out
          </button>
        </div>
      </form>
    </div>
  );
}

function AcceptCard({
  token,
  orgName,
  role,
  inviterName,
  expiresAt,
}: {
  token: string;
  orgName: string;
  role: string;
  inviterName: string | null;
  expiresAt: Date;
}) {
  const days = daysUntil(expiresAt);
  const expiresLabel =
    days <= 0
      ? "expires today"
      : days === 1
        ? "expires in 1 day"
        : `expires in ${days} days`;

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--color-accent)]">
        you&apos;re invited
      </p>
      <h1 className="text-[26px] font-light leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
        join{" "}
        <span className="text-[var(--color-ink)]">{orgName}</span> on aju
      </h1>
      <div className="w-full rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-6 text-left">
        <dl className="flex flex-col gap-3 text-[13px]">
          <Row label="workspace">{orgName}</Row>
          <Row label="role">{role}</Row>
          {inviterName && <Row label="invited by">{inviterName}</Row>}
          <Row label="expires">
            <span className="font-mono text-[12px] text-[var(--color-muted)]">
              {expiresLabel}
            </span>
          </Row>
        </dl>
        <div className="mt-6">
          <AcceptControls token={token} />
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
        {label}
      </dt>
      <dd className="text-right text-[var(--color-ink)]">{children}</dd>
    </div>
  );
}
