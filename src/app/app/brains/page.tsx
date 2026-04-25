import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { tenantDbFor } from "@/lib/db";
import {
  currentAuth,
  currentUser,
  getActiveOrganizationId,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ error?: string; ok?: string }>;
};

const NAME_MAX_LEN = 64;

async function createBrainAction(formData: FormData): Promise<void> {
  "use server";

  const user = await currentUser();
  if (!user) redirect("/");

  const rawName = ((formData.get("name") as string | null) ?? "").trim();
  if (!rawName) {
    redirect("/app/brains?error=name-required");
  }
  if (rawName.length > NAME_MAX_LEN) {
    redirect("/app/brains?error=name-too-long");
  }

  const rawType = ((formData.get("type") as string | null) ?? "").trim();
  const type = rawType || "personal";

  const organizationId = await getActiveOrganizationId();
  if (!organizationId) {
    redirect("/app/brains?error=no-active-org");
  }

  const tenant = await tenantDbFor(organizationId!);
  await tenant.$transaction(async (tx) => {
    const brain = await tx.brain.create({
      data: {
        name: rawName,
        type,
      },
      select: { id: true },
    });
    await tx.brainAccess.create({
      data: {
        brainId: brain.id,
        userId: user.id,
        role: "owner",
      },
    });
  });

  revalidatePath("/app/brains", "layout");
  redirect("/app/brains?ok=created");
}

const ERROR_MESSAGES: Record<string, string> = {
  "name-required": "please provide a name.",
  "name-too-long": `name must be ${NAME_MAX_LEN} characters or fewer.`,
  "no-active-org": "pick an active organization first.",
};

const OK_MESSAGES: Record<string, string> = {
  created: "brain created.",
  renamed: "brain renamed.",
  deleted: "brain deleted.",
};

export default async function BrainsPage({ searchParams }: PageProps) {
  const auth = await currentAuth();
  if (!auth) redirect("/");
  const { user, organizationId } = auth;

  const sp = await searchParams;
  const errorMessage = sp.error ? ERROR_MESSAGES[sp.error] ?? sp.error : null;
  const okMessage = sp.ok ? OK_MESSAGES[sp.ok] ?? sp.ok : null;

  const access = organizationId
    ? await (async () => {
        const tenant = await tenantDbFor(organizationId);
        return tenant.brainAccess.findMany({
          where: { userId: user.id },
          include: {
            brain: {
              include: {
                _count: { select: { documents: true } },
              },
            },
          },
          orderBy: { brain: { createdAt: "asc" } },
        });
      })()
    : [];

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            brains
          </p>
          <h1 className="text-[28px] font-light leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
            your brains
          </h1>
          <p className="max-w-[520px] text-[13px] leading-6 text-[var(--color-muted)]">
            Each brain is an isolated vault with its own documents, links, and
            embeddings. Create a new brain below or open one for detail.
          </p>
        </div>
      </section>

      {errorMessage && (
        <div className="rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-panel)]/60 p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
            error
          </p>
          <p className="mt-1 text-[13px] text-[var(--color-ink)]">
            {errorMessage}
          </p>
        </div>
      )}
      {okMessage && (
        <div className="rounded-xl border border-white/10 bg-[var(--color-panel)]/60 p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
            saved
          </p>
          <p className="mt-1 text-[13px] text-[var(--color-ink)]">{okMessage}</p>
        </div>
      )}

      <section className="flex flex-col gap-4 rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-medium text-[var(--color-ink)]">
            Create brain
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
            owner
          </span>
        </div>
        <p className="text-[13px] leading-6 text-[var(--color-muted)]">
          New brains live in your active organization. You&rsquo;ll be the
          owner.
        </p>
        <form
          action={createBrainAction}
          className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-3"
        >
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
              name
            </span>
            <input
              type="text"
              name="name"
              required
              maxLength={NAME_MAX_LEN}
              placeholder="e.g. research"
              autoComplete="off"
              className="rounded-md border border-white/10 bg-[var(--color-bg)]/60 px-3 py-2 font-mono text-[13px] text-[var(--color-ink)] focus:border-white/20 focus:outline-none"
            />
          </label>
          <label className="flex w-full flex-col gap-1.5 sm:w-40">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
              type
            </span>
            <select
              name="type"
              defaultValue="personal"
              className="rounded-md border border-white/10 bg-[var(--color-bg)]/60 px-3 py-2 font-mono text-[13px] text-[var(--color-ink)] focus:border-white/20 focus:outline-none"
            >
              <option value="personal">personal</option>
              <option value="org">org</option>
            </select>
          </label>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-md border border-[var(--color-accent)]/40 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)] transition hover:border-[var(--color-accent)]/70 hover:bg-white/[0.02]"
          >
            create brain
          </button>
        </form>
      </section>

      {access.length === 0 ? (
        <section className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-white/10 bg-[var(--color-panel)]/60 p-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
            empty
          </p>
          <h2 className="text-[18px] font-light text-[var(--color-ink)]">
            No brains yet.
          </h2>
          <p className="max-w-[460px] text-[13px] leading-6 text-[var(--color-muted)]">
            Create one with the form above, or from the CLI.
          </p>
          <code className="mt-2 rounded-md bg-black/50 px-3 py-1.5 font-mono text-[12px] text-[var(--color-ink)]">
            aju brains create my-first-brain
          </code>
        </section>
      ) : (
        <section className="overflow-hidden rounded-xl border border-white/10">
          <div className="hidden grid-cols-[1fr_100px_110px_120px] gap-4 border-b border-white/5 bg-[var(--color-panel)]/60 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)] md:grid">
            <span>name</span>
            <span>type</span>
            <span>role</span>
            <span className="text-right">documents</span>
          </div>
          <ul className="divide-y divide-white/5">
            {access.map((a) => {
              const b = a.brain;
              return (
                <li
                  key={b.id}
                  className="bg-[var(--color-panel)]/40 transition hover:bg-[var(--color-panel)]/70"
                >
                  <Link
                    href={`/app/brains/${b.id}`}
                    className="grid grid-cols-1 gap-2 px-5 py-4 md:grid-cols-[1fr_100px_110px_120px] md:items-center md:gap-4"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="font-mono text-[13px] text-[var(--color-ink)]">
                        {b.name}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">
                        id: {b.id}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
                      {b.type}
                    </span>
                    <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
                      {a.role}
                    </span>
                    <span className="font-mono text-[13px] text-[var(--color-ink)] md:text-right">
                      {b._count.documents}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
