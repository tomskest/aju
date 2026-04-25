import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser, getActiveOrganizationId } from "@/lib/auth";
import CreateKeyForm from "./CreateKeyForm";
import RevokeKeyButton from "./RevokeKeyButton";

export const dynamic = "force-dynamic";

type KeyStatus = "active" | "revoked" | "expired";

function statusOf(key: {
  revokedAt: Date | null;
  expiresAt: Date | null;
}): KeyStatus {
  if (key.revokedAt) return "revoked";
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) return "expired";
  return "active";
}

/**
 * Normalize `scopes` (stored as Prisma `Json`) into a string array. Legacy or
 * malformed rows degrade to an empty list so the page never crashes.
 */
function toScopeArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  return [];
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

function formatRelative(d: Date | null): string {
  if (!d) return "never";
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 60_000) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toISOString().slice(0, 10);
}

export default async function KeysPage() {
  const user = await currentUser();
  if (!user) redirect("/");

  const [rows, memberships, activeOrgId] = await Promise.all([
    prisma.apiKey.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        prefix: true,
        name: true,
        scopes: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        organizationId: true,
        organization: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.organizationMembership.findMany({
      where: { userId: user.id },
      include: {
        organization: {
          select: { id: true, name: true, slug: true, isPersonal: true },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    getActiveOrganizationId(),
  ]);

  const keys = rows.map((k) => ({
    id: k.id,
    prefix: k.prefix,
    name: k.name,
    scopes: toScopeArray(k.scopes),
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
    expiresAt: k.expiresAt,
    revokedAt: k.revokedAt,
    organization: k.organization,
    status: statusOf(k),
  }));

  const activeCount = keys.filter((k) => k.status === "active").length;

  const orgs = memberships.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
    isPersonal: m.organization.isPersonal,
  }));
  const defaultOrgId =
    (activeOrgId && orgs.some((o) => o.id === activeOrgId)
      ? activeOrgId
      : null) ?? user.personalOrgId ?? null;

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
          api keys
        </p>
        <h1 className="text-[28px] font-light leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
          your keys
        </h1>
        <p className="max-w-[520px] text-[13px] leading-6 text-[var(--color-muted)]">
          API keys let the CLI, MCP clients, and custom integrations talk to
          the aju API on your behalf. Keys are only shown once at creation
          time — save yours somewhere safe.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            {activeCount} active · {keys.length} total
          </p>
        </div>
        <CreateKeyForm orgs={orgs} defaultOrgId={defaultOrgId} />
      </section>

      {keys.length === 0 ? (
        <section className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-white/10 bg-[var(--color-panel)]/60 p-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            empty
          </p>
          <h2 className="text-[18px] font-light text-[var(--color-ink)]">
            No keys yet.
          </h2>
          <p className="max-w-[460px] text-[13px] leading-6 text-[var(--color-muted)]">
            Run{" "}
            <code className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[12px] text-[var(--color-ink)]">
              aju login
            </code>{" "}
            from your terminal to create one, or click Create API key above.
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-xl border border-white/10">
          <div className="hidden grid-cols-[170px_1fr_160px_110px_100px_110px_110px] gap-4 border-b border-white/5 bg-[var(--color-panel)]/60 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)] md:grid">
            <span>prefix / name</span>
            <span>scopes</span>
            <span>org</span>
            <span>created</span>
            <span>last used</span>
            <span>status</span>
            <span className="text-right">actions</span>
          </div>
          <ul className="divide-y divide-white/5">
            {keys.map((k) => {
              const revoked = k.status === "revoked";
              const expired = k.status === "expired";
              const dim = revoked || expired;
              return (
                <li
                  key={k.id}
                  className={`grid grid-cols-1 gap-2 bg-[var(--color-panel)]/40 px-5 py-4 transition hover:bg-[var(--color-panel)]/70 md:grid-cols-[170px_1fr_160px_110px_100px_110px_110px] md:items-center md:gap-4 ${
                    dim ? "opacity-55" : ""
                  }`}
                >
                  <div className="flex flex-col gap-0.5">
                    <code
                      className={`font-mono text-[13px] ${
                        revoked
                          ? "text-[var(--color-muted)] line-through"
                          : "text-[var(--color-ink)]"
                      }`}
                    >
                      {k.prefix}
                    </code>
                    <span
                      className={`font-mono text-[11px] uppercase tracking-[0.18em] ${
                        revoked
                          ? "text-[var(--color-faint)] line-through"
                          : "text-[var(--color-muted)]"
                      }`}
                    >
                      {k.name}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {k.scopes.length === 0 ? (
                      <span className="font-mono text-[11px] text-[var(--color-faint)]">
                        —
                      </span>
                    ) : (
                      k.scopes.map((s) => (
                        <span
                          key={s}
                          className="rounded border border-white/10 bg-black/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]"
                        >
                          {s}
                        </span>
                      ))
                    )}
                  </div>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    {k.organization ? (
                      <>
                        <span className="truncate font-mono text-[12px] text-[var(--color-ink)]">
                          {k.organization.name}
                        </span>
                        <span className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
                          {k.organization.slug}
                        </span>
                      </>
                    ) : (
                      <span className="font-mono text-[11px] text-[var(--color-faint)]">
                        unpinned
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-[12px] text-[var(--color-muted)]">
                    {formatDate(k.createdAt)}
                  </span>
                  <span className="font-mono text-[12px] text-[var(--color-muted)]">
                    {formatRelative(k.lastUsedAt)}
                  </span>
                  <StatusBadge status={k.status} />
                  <div>
                    {k.status === "active" ? (
                      <RevokeKeyButton keyId={k.id} label={k.name} />
                    ) : (
                      <span className="flex justify-end font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
                        —
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-white/10 bg-[var(--color-panel)]/50 p-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
          security
        </p>
        <ul className="mt-3 flex flex-col gap-2 text-[13px] leading-6 text-[var(--color-muted)]">
          <li>
            Keys inherit your plan&rsquo;s rate limits and scope. Rotate any
            key you suspect is compromised.
          </li>
          <li>
            The prefix is visible here; the full secret is only shown once
            during minting.
          </li>
          <li>
            To report a leaked key, email{" "}
            <a
              href="mailto:security@aju.sh"
              className="font-mono text-[var(--color-accent)] underline-offset-4 hover:underline"
            >
              security@aju.sh
            </a>
            .
          </li>
        </ul>
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: KeyStatus }) {
  const styles: Record<KeyStatus, string> = {
    active:
      "border-[var(--color-accent)]/40 text-[var(--color-accent)] bg-[var(--color-accent)]/5",
    revoked: "border-white/10 text-[var(--color-faint)] bg-black/30",
    expired: "border-white/10 text-[var(--color-muted)] bg-black/20",
  };
  return (
    <span
      className={`inline-flex w-fit items-center rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] ${styles[status]}`}
    >
      {status}
    </span>
  );
}
