import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { PrismaClient as PrismaClientTenant } from "@prisma/client-tenant";
import KbProse from "@/components/kb/KbProse";
import { renderMarkdown } from "@/lib/vault";
import { prisma, tenantDbFor } from "@/lib/db";
import { currentUser, getActiveOrganizationId } from "@/lib/auth";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string; slug: string }>;
};

/**
 * Confirm the caller can read this brain: either an explicit BrainAccess row
 * in the tenant DB, or org-membership on the control DB (treated as viewer).
 */
async function canReadBrain(
  tenant: PrismaClientTenant,
  userId: string,
  organizationId: string,
  brainId: string,
): Promise<boolean> {
  const access = await tenant.brainAccess.findUnique({
    where: { brainId_userId: { brainId, userId } },
    select: { role: true },
  });
  if (access) return true;

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId, organizationId },
    select: { id: true },
  });
  return !!membership;
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return "—";
  }
}

export default async function DocumentViewerPage({ params }: PageProps) {
  const user = await currentUser();
  if (!user) redirect("/");

  const { id: brainId, slug } = await params;
  // Next.js auto-decodes a single dynamic segment, but guard against
  // environments where it doesn't (or against double-encoding from callers).
  const path = slug.includes("%") ? decodeURIComponent(slug) : slug;

  const organizationId = await getActiveOrganizationId();
  if (!organizationId) notFound();

  const tenant = await tenantDbFor(organizationId);
  const brain = await tenant.brain.findUnique({
    where: { id: brainId },
    select: { id: true, name: true },
  });
  if (!brain) notFound();

  if (!(await canReadBrain(tenant, user.id, organizationId, brain.id))) {
    notFound();
  }

  const doc = await tenant.vaultDocument.findFirst({
    where: { brainId: brain.id, path },
    select: {
      id: true,
      title: true,
      path: true,
      section: true,
      docType: true,
      docStatus: true,
      tags: true,
      wordCount: true,
      content: true,
      updatedAt: true,
      createdAt: true,
    },
  });
  if (!doc) notFound();

  const html = renderMarkdown(doc.content ?? "");

  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
          <Link
            href={`/app/brains/${brain.id}`}
            className="text-[var(--color-muted)] transition hover:text-[var(--color-ink)]"
          >
            ← {brain.name}
          </Link>
          {doc.section && (
            <>
              <span>·</span>
              <span className="text-[var(--color-accent)]">{doc.section}</span>
            </>
          )}
        </div>

        <h1 className="text-[28px] font-light leading-[1.15] tracking-[-0.02em] text-[var(--color-ink)]">
          {doc.title}
        </h1>

        <p className="font-mono text-[11px] text-[var(--color-faint)]">
          {doc.path}
        </p>

        <dl className="flex flex-wrap gap-x-6 gap-y-2 pt-1 font-mono text-[11px] text-[var(--color-muted)]">
          {doc.docType && (
            <div>
              <dt className="inline text-[var(--color-faint)]">type: </dt>
              <dd className="inline">{doc.docType}</dd>
            </div>
          )}
          {doc.docStatus && (
            <div>
              <dt className="inline text-[var(--color-faint)]">status: </dt>
              <dd className="inline">{doc.docStatus}</dd>
            </div>
          )}
          {typeof doc.wordCount === "number" && doc.wordCount > 0 && (
            <div>
              <dt className="inline text-[var(--color-faint)]">words: </dt>
              <dd className="inline">{doc.wordCount}</dd>
            </div>
          )}
          <div>
            <dt className="inline text-[var(--color-faint)]">updated: </dt>
            <dd className="inline">{formatDate(doc.updatedAt)}</dd>
          </div>
        </dl>

        {doc.tags && doc.tags.length > 0 && (
          <ul className="flex flex-wrap gap-2 pt-1">
            {doc.tags.map((t) => (
              <li
                key={t}
                className="rounded-md border border-white/10 bg-[var(--color-panel)]/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]"
              >
                {t}
              </li>
            ))}
          </ul>
        )}
      </header>

      {doc.content ? (
        <KbProse html={html} />
      ) : (
        <div className="rounded-xl border border-dashed border-white/10 bg-[var(--color-panel)]/60 p-6">
          <p className="text-[13px] text-[var(--color-muted)]">
            This document has no body yet.
          </p>
        </div>
      )}
    </article>
  );
}
