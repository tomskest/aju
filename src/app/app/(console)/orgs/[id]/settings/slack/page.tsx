import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { withTenant, decryptDsn, canManageMembers, type OrgRole } from "@/lib/tenant";
import { recordAudit } from "@/lib/audit";
import { slackIntegrationEnabled } from "@/lib/agent/flags";
import { SlackApiError, SlackClient } from "@/lib/agent/slack";
import { checkAgentSpendLimit, DEFAULT_MONTHLY_COST_CENTS } from "@/lib/agent/metering";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string; install?: string }>;
};

const ERROR_MESSAGES: Record<string, string> = {
  forbidden: "You need to be an owner or admin to do that.",
  "channel-required": "Channel ID is required (e.g. C0123456789).",
  "pair-required": "Pick an agent → brain pair.",
  "not-installed": "Install the Slack app first.",
  "channel-not-visible": "The bot can't see that channel — invite @aju to it in Slack first.",
  "channel-bound": "That channel already has a binding.",
  "invalid-grant": "That agent no longer has an editor grant on that brain.",
  "budget-invalid": "Budget must be a number of dollars, 0 or more.",
};

const OK_MESSAGES: Record<string, string> = {
  uninstalled: "Slack app disconnected. Bindings were paused.",
  "binding-created": "Channel bound.",
  "binding-updated": "Binding updated.",
  "spend-saved": "Monthly budget saved.",
};

const INSTALL_MESSAGES: Record<string, { kind: "ok" | "error"; text: string }> = {
  ok: { kind: "ok", text: "Slack app installed. Bind a channel below to go live." },
  cancelled: { kind: "error", text: "Install was cancelled on Slack's side." },
  error: {
    kind: "error",
    text: "Install failed — check the server logs and Slack app credentials.",
  },
  "team-conflict": {
    kind: "error",
    text: "That Slack workspace is already connected to a different aju organization. Disconnect it there first.",
  },
};

async function assertAdmin(orgId: string): Promise<{ userId: string; role: OrgRole }> {
  const user = await currentUser();
  if (!user) redirect("/");
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId: orgId },
    select: { role: true },
  });
  if (!membership) notFound();
  const role = membership.role as OrgRole;
  if (!canManageMembers(role)) {
    redirect(`/app/orgs/${orgId}/settings/slack?error=forbidden`);
  }
  return { userId: user.id, role };
}

// ─── Server actions ─────────────────────────────────────────────────────────

async function uninstallAction(formData: FormData): Promise<void> {
  "use server";
  const orgId = (formData.get("orgId") as string | null) ?? "";
  if (!orgId) return;
  const ctx = await assertAdmin(orgId);

  const installation = await prisma.slackInstallation.findFirst({
    where: { organizationId: orgId, status: "active" },
    select: { id: true, teamId: true },
  });
  if (installation) {
    await prisma.$transaction([
      prisma.slackInstallation.update({
        where: { id: installation.id },
        data: { status: "revoked" },
      }),
      prisma.slackChannelBinding.updateMany({
        where: { installationId: installation.id, status: "active" },
        data: { status: "paused" },
      }),
    ]);
    await recordAudit(prisma, {
      eventType: "slack.uninstalled",
      actorUserId: ctx.userId,
      organizationId: orgId,
      resourceType: "slack_installation",
      resourceId: installation.id,
      metadata: { teamId: installation.teamId },
    });
  }
  revalidatePath(`/app/orgs/${orgId}/settings/slack`);
  redirect(`/app/orgs/${orgId}/settings/slack?ok=uninstalled`);
}

async function createBindingAction(formData: FormData): Promise<void> {
  "use server";
  const orgId = (formData.get("orgId") as string | null) ?? "";
  if (!orgId) return;
  const ctx = await assertAdmin(orgId);
  const back = (suffix: string) => redirect(`/app/orgs/${orgId}/settings/slack?${suffix}`);

  const channelId = ((formData.get("channelId") as string | null) ?? "").trim();
  const pair = (formData.get("pair") as string | null) ?? "";
  if (!channelId) back("error=channel-required");
  const [agentId, brainId] = pair.split("::");
  if (!agentId || !brainId) back("error=pair-required");

  const installation = await prisma.slackInstallation.findFirst({
    where: { organizationId: orgId, status: "active" },
  });
  if (!installation) back("error=not-installed");

  const targets = await withTenant({ organizationId: orgId, unscoped: true }, async ({ tx }) => {
    const [agent, brain, access] = await Promise.all([
      tx.agent.findUnique({ where: { id: agentId } }),
      tx.brain.findUnique({ where: { id: brainId } }),
      tx.brainAccess.findFirst({
        where: { agentId, brainId, role: { in: ["editor", "owner"] } },
        select: { id: true },
      }),
    ]);
    return { agent, brain, ok: Boolean(agent && brain && access) };
  });
  if (!targets.ok || !targets.agent || !targets.brain) {
    back("error=invalid-grant");
    return;
  }

  let channelName = channelId;
  try {
    const slack = new SlackClient(decryptDsn(installation!.botTokenEnc));
    const info = await slack.conversationsInfo(channelId);
    channelName = info.name ?? channelId;
  } catch (err) {
    if (err instanceof SlackApiError) back("error=channel-not-visible");
    else throw err;
  }

  const existing = await prisma.slackChannelBinding.findUnique({
    where: {
      installationId_channelId: { installationId: installation!.id, channelId },
    },
    select: { id: true },
  });
  if (existing) back("error=channel-bound");

  const binding = await prisma.slackChannelBinding.create({
    data: {
      installationId: installation!.id,
      channelId,
      channelName,
      agentId,
      agentName: targets.agent.name,
      brainId,
      brainName: targets.brain.name,
    },
  });
  await recordAudit(prisma, {
    eventType: "slack.binding_created",
    actorUserId: ctx.userId,
    organizationId: orgId,
    resourceType: "slack_channel_binding",
    resourceId: binding.id,
    metadata: { channelId, channelName, agentId, brainId },
  });
  revalidatePath(`/app/orgs/${orgId}/settings/slack`);
  redirect(`/app/orgs/${orgId}/settings/slack?ok=binding-created`);
}

async function toggleBindingAction(formData: FormData): Promise<void> {
  "use server";
  const orgId = (formData.get("orgId") as string | null) ?? "";
  const bindingId = (formData.get("bindingId") as string | null) ?? "";
  const next = (formData.get("next") as string | null) ?? "";
  if (!orgId || !bindingId || !["active", "paused"].includes(next)) return;
  const ctx = await assertAdmin(orgId);

  const binding = await prisma.slackChannelBinding.findFirst({
    where: { id: bindingId, installation: { organizationId: orgId } },
    select: { id: true, status: true },
  });
  if (!binding) notFound();
  await prisma.slackChannelBinding.update({
    where: { id: binding.id },
    data: { status: next },
  });
  await recordAudit(prisma, {
    eventType: "slack.binding_updated",
    actorUserId: ctx.userId,
    organizationId: orgId,
    resourceType: "slack_channel_binding",
    resourceId: binding.id,
    changes: { before: { status: binding.status }, after: { status: next } },
  });
  revalidatePath(`/app/orgs/${orgId}/settings/slack`);
  redirect(`/app/orgs/${orgId}/settings/slack?ok=binding-updated`);
}

async function saveSpendAction(formData: FormData): Promise<void> {
  "use server";
  const orgId = (formData.get("orgId") as string | null) ?? "";
  if (!orgId) return;
  const ctx = await assertAdmin(orgId);

  const dollars = Number.parseFloat(((formData.get("monthlyUsd") as string | null) ?? "").trim());
  if (!Number.isFinite(dollars) || dollars < 0 || dollars > 100_000) {
    redirect(`/app/orgs/${orgId}/settings/slack?error=budget-invalid`);
  }
  const hardStop = (formData.get("hardStop") as string | null) === "on";
  const monthlyCostCents = Math.round(dollars * 100);

  const limit = await prisma.integrationSpendLimit.upsert({
    where: { organizationId: orgId },
    create: { organizationId: orgId, monthlyCostCents, hardStop },
    update: { monthlyCostCents, hardStop },
  });
  await recordAudit(prisma, {
    eventType: "slack.spend_limit_updated",
    actorUserId: ctx.userId,
    organizationId: orgId,
    resourceType: "integration_spend_limit",
    resourceId: limit.id,
    changes: { after: { monthlyCostCents, hardStop } },
  });
  revalidatePath(`/app/orgs/${orgId}/settings/slack`);
  redirect(`/app/orgs/${orgId}/settings/slack?ok=spend-saved`);
}

// ─── Page ───────────────────────────────────────────────────────────────────

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function SlackSettingsPage({ params, searchParams }: PageProps) {
  if (!slackIntegrationEnabled()) notFound();
  const { id: orgId } = await params;
  const sp = await searchParams;

  const user = await currentUser();
  if (!user) redirect("/");
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId: orgId },
    include: { organization: { select: { name: true } } },
  });
  if (!membership) notFound();
  const canManage = canManageMembers(membership.role as OrgRole);

  const [installation, spend, runs] = await Promise.all([
    prisma.slackInstallation.findFirst({
      where: { organizationId: orgId, status: "active" },
      include: { bindings: { orderBy: { createdAt: "asc" } } },
    }),
    checkAgentSpendLimit(orgId),
    prisma.agentRun.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
  ]);

  // Agent → brain pairs with a write grant, for the binding form.
  let pairs: Array<{ agentId: string; agentName: string; brainId: string; brainName: string }> = [];
  if (installation) {
    try {
      pairs = await withTenant({ organizationId: orgId, unscoped: true }, async ({ tx }) => {
        const grants = await tx.brainAccess.findMany({
          where: { agentId: { not: null }, role: { in: ["editor", "owner"] } },
          include: { brain: { select: { id: true, name: true } } },
        });
        const agentIds = [
          ...new Set(grants.map((g) => g.agentId).filter((v): v is string => Boolean(v))),
        ];
        const agents = await tx.agent.findMany({
          where: { id: { in: agentIds } },
          select: { id: true, name: true },
        });
        const nameById = new Map(agents.map((a) => [a.id, a.name]));
        return grants
          .filter((g) => g.agentId && nameById.has(g.agentId))
          .map((g) => ({
            agentId: g.agentId!,
            agentName: nameById.get(g.agentId!)!,
            brainId: g.brain.id,
            brainName: g.brain.name,
          }));
      });
    } catch {
      pairs = [];
    }
  }

  const bindingByChannel = new Map((installation?.bindings ?? []).map((b) => [b.channelId, b]));
  const errorMessage = sp.error ? (ERROR_MESSAGES[sp.error] ?? sp.error) : null;
  const okMessage = sp.ok ? (OK_MESSAGES[sp.ok] ?? sp.ok) : null;
  const installMessage = sp.install ? INSTALL_MESSAGES[sp.install] : null;

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <Link
          href={`/app/orgs/${orgId}/settings`}
          className="font-mono text-[11px] tracking-[0.24em] text-[var(--color-muted)] uppercase transition hover:text-[var(--color-ink)]"
        >
          ← settings
        </Link>
        <p className="font-mono text-[11px] tracking-[0.24em] text-[var(--color-muted)] uppercase">
          integrations / slack
        </p>
        <h1 className="text-[28px] leading-tight font-light tracking-[-0.02em] text-[var(--color-ink)]">
          aju in Slack
        </h1>
        <p className="max-w-[560px] text-[13px] leading-6 text-[var(--color-muted)]">
          Mention @aju in a bound channel to search, answer from, and capture into a brain. Each
          channel is bound to one agent identity and one primary brain; everything the agent writes
          is marked agent-authored and starts unvalidated.
        </p>
      </section>

      {(errorMessage || installMessage?.kind === "error") && (
        <div className="rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-panel)]/60 p-4">
          <p className="font-mono text-[11px] tracking-[0.24em] text-[var(--color-accent)] uppercase">
            error
          </p>
          <p className="mt-1 text-[13px] text-[var(--color-ink)]">
            {errorMessage ?? installMessage?.text}
          </p>
        </div>
      )}
      {(okMessage || installMessage?.kind === "ok") && (
        <div className="rounded-xl border border-white/10 bg-[var(--color-panel)]/60 p-4">
          <p className="font-mono text-[11px] tracking-[0.24em] text-[var(--color-accent)] uppercase">
            saved
          </p>
          <p className="mt-1 text-[13px] text-[var(--color-ink)]">
            {okMessage ?? installMessage?.text}
          </p>
        </div>
      )}

      {/* Installation */}
      <section className="flex flex-col gap-4 rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-medium text-[var(--color-ink)]">Workspace</h2>
          <span className="font-mono text-[10px] tracking-[0.24em] text-[var(--color-faint)] uppercase">
            owner / admin
          </span>
        </div>
        {installation ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] leading-6 text-[var(--color-muted)]">
              Connected to <span className="text-[var(--color-ink)]">{installation.teamName}</span>{" "}
              <span className="font-mono text-[11px] text-[var(--color-faint)]">
                ({installation.teamId})
              </span>
            </p>
            <form action={uninstallAction}>
              <input type="hidden" name="orgId" value={orgId} />
              <button
                type="submit"
                disabled={!canManage}
                className="inline-flex items-center justify-center rounded-md border border-[var(--color-accent)]/40 px-3 py-1.5 font-mono text-[11px] tracking-[0.2em] text-[var(--color-accent)] uppercase transition hover:border-[var(--color-accent)]/70 hover:bg-white/[0.02] disabled:cursor-not-allowed disabled:opacity-50"
              >
                disconnect
              </button>
            </form>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] leading-6 text-[var(--color-muted)]">
              Not connected. Installing adds the aju bot to your Slack workspace; nothing happens
              until you bind a channel.
            </p>
            <div>
              <a
                href={`/api/integrations/slack/oauth/start?org=${orgId}`}
                className="inline-flex items-center justify-center rounded-md border border-[var(--color-accent)]/40 px-3 py-1.5 font-mono text-[11px] tracking-[0.2em] text-[var(--color-accent)] uppercase transition hover:border-[var(--color-accent)]/70 hover:bg-white/[0.02]"
              >
                add to slack
              </a>
            </div>
          </div>
        )}
      </section>

      {/* Bindings */}
      {installation && (
        <section className="flex flex-col gap-4 rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5">
          <h2 className="text-[15px] font-medium text-[var(--color-ink)]">Channel bindings</h2>
          {installation.bindings.length === 0 ? (
            <p className="text-[13px] leading-6 text-[var(--color-muted)]">
              No channels bound yet.
            </p>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="font-mono text-[10px] tracking-[0.22em] text-[var(--color-faint)] uppercase">
                  <th className="py-2 pr-3 font-normal">channel</th>
                  <th className="py-2 pr-3 font-normal">identity</th>
                  <th className="py-2 pr-3 font-normal">brain</th>
                  <th className="py-2 pr-3 font-normal">status</th>
                  <th className="py-2 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {installation.bindings.map((b) => (
                  <tr key={b.id} className="border-t border-white/5 text-[var(--color-ink)]">
                    <td className="py-2 pr-3">#{b.channelName}</td>
                    <td className="py-2 pr-3">{b.agentName}</td>
                    <td className="py-2 pr-3">{b.brainName}</td>
                    <td className="py-2 pr-3 font-mono text-[11px] tracking-[0.18em] text-[var(--color-muted)] uppercase">
                      {b.status}
                    </td>
                    <td className="py-2 text-right">
                      <form action={toggleBindingAction}>
                        <input type="hidden" name="orgId" value={orgId} />
                        <input type="hidden" name="bindingId" value={b.id} />
                        <input
                          type="hidden"
                          name="next"
                          value={b.status === "active" ? "paused" : "active"}
                        />
                        <button
                          type="submit"
                          disabled={!canManage}
                          className="font-mono text-[11px] tracking-[0.2em] text-[var(--color-accent)] uppercase transition hover:opacity-80 disabled:opacity-50"
                        >
                          {b.status === "active" ? "pause" : "resume"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <form
            action={createBindingAction}
            className="flex flex-col gap-3 border-t border-white/5 pt-4"
          >
            <p className="font-mono text-[10px] tracking-[0.22em] text-[var(--color-faint)] uppercase">
              bind a channel
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] tracking-[0.22em] text-[var(--color-faint)] uppercase">
                  channel id
                </span>
                <input
                  type="text"
                  name="channelId"
                  placeholder="C0123456789"
                  required
                  className="rounded-md border border-white/10 bg-[var(--color-bg)]/60 px-3 py-2 text-[13px] text-[var(--color-ink)] focus:border-white/20 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] tracking-[0.22em] text-[var(--color-faint)] uppercase">
                  identity → brain
                </span>
                <select
                  name="pair"
                  required
                  className="rounded-md border border-white/10 bg-[var(--color-bg)]/60 px-3 py-2 text-[13px] text-[var(--color-ink)] focus:border-white/20 focus:outline-none"
                >
                  <option value="">choose…</option>
                  {pairs.map((p) => (
                    <option key={`${p.agentId}::${p.brainId}`} value={`${p.agentId}::${p.brainId}`}>
                      {p.agentName} → {p.brainName}
                    </option>
                  ))}
                </select>
              </label>
              <input type="hidden" name="orgId" value={orgId} />
              <button
                type="submit"
                disabled={!canManage || pairs.length === 0}
                className="inline-flex items-center justify-center rounded-md border border-[var(--color-accent)]/40 px-3 py-2 font-mono text-[11px] tracking-[0.2em] text-[var(--color-accent)] uppercase transition hover:border-[var(--color-accent)]/70 hover:bg-white/[0.02] disabled:cursor-not-allowed disabled:opacity-50"
              >
                bind
              </button>
            </div>
            <p className="text-[12px] leading-5 text-[var(--color-faint)]">
              Invite @aju to the channel in Slack first. Pairs come from agents with an editor grant
              on a brain — create those under Agents.
            </p>
          </form>
        </section>
      )}

      {/* Spend */}
      <section className="flex flex-col gap-4 rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5">
        <h2 className="text-[15px] font-medium text-[var(--color-ink)]">Monthly budget</h2>
        <p className="text-[13px] leading-6 text-[var(--color-muted)]">
          Used this month: <span className="text-[var(--color-ink)]">{usd(spend.spentCents)}</span>{" "}
          of {usd(spend.limitCents)}
          {spend.limitCents === DEFAULT_MONTHLY_COST_CENTS && " (default)"}. With hard stop on,
          mentions over budget get a fixed reply and no model call.
        </p>
        <form action={saveSpendAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="orgId" value={orgId} />
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] tracking-[0.22em] text-[var(--color-faint)] uppercase">
              budget (usd / month)
            </span>
            <input
              type="number"
              name="monthlyUsd"
              step="0.01"
              min="0"
              defaultValue={(spend.limitCents / 100).toFixed(2)}
              className="w-36 rounded-md border border-white/10 bg-[var(--color-bg)]/60 px-3 py-2 text-[13px] text-[var(--color-ink)] focus:border-white/20 focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-2 py-2 text-[13px] text-[var(--color-muted)]">
            <input type="checkbox" name="hardStop" defaultChecked={spend.hardStop} />
            hard stop
          </label>
          <button
            type="submit"
            disabled={!canManage}
            className="inline-flex items-center justify-center rounded-md border border-[var(--color-accent)]/40 px-3 py-2 font-mono text-[11px] tracking-[0.2em] text-[var(--color-accent)] uppercase transition hover:border-[var(--color-accent)]/70 hover:bg-white/[0.02] disabled:cursor-not-allowed disabled:opacity-50"
          >
            save budget
          </button>
        </form>
      </section>

      {/* Run log */}
      <section className="flex flex-col gap-4 rounded-xl border border-white/10 bg-[var(--color-panel)]/85 p-5">
        <h2 className="text-[15px] font-medium text-[var(--color-ink)]">Recent runs</h2>
        {runs.length === 0 ? (
          <p className="text-[13px] leading-6 text-[var(--color-muted)]">
            No runs yet. Mention @aju in a bound channel.
          </p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="font-mono text-[10px] tracking-[0.22em] text-[var(--color-faint)] uppercase">
                <th className="py-2 pr-3 font-normal">when</th>
                <th className="py-2 pr-3 font-normal">channel</th>
                <th className="py-2 pr-3 font-normal">status</th>
                <th className="py-2 pr-3 font-normal">tokens</th>
                <th className="py-2 pr-3 font-normal">cost</th>
                <th className="py-2 font-normal">error</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-white/5 text-[var(--color-ink)]">
                  <td className="py-2 pr-3 font-mono text-[11px] text-[var(--color-muted)]">
                    {r.createdAt.toISOString().replace("T", " ").slice(0, 16)}
                  </td>
                  <td className="py-2 pr-3">
                    #{bindingByChannel.get(r.channelId)?.channelName ?? r.channelId}
                  </td>
                  <td className="py-2 pr-3 font-mono text-[11px] tracking-[0.18em] text-[var(--color-muted)] uppercase">
                    {r.status}
                  </td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-[var(--color-muted)]">
                    {r.inputTokens + r.outputTokens}
                  </td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-[var(--color-muted)]">
                    {usd(r.costCents)}
                  </td>
                  <td className="py-2 font-mono text-[11px] text-[var(--color-faint)]">
                    {r.error ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
