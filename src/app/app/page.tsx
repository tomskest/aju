import { redirect } from "next/navigation";
import { currentUser, getActiveOrganizationId } from "@/lib/auth";
import { prisma, tenantDbFor } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Logged-in landing. The product's primary surface is the brain explorer,
 * so we resolve the user's default brain and redirect there. If they have
 * no brains yet, we send them to /app/console where they can create one.
 *
 * Default-brain pick: any brain they have access to, ordered by createdAt
 * so the first brain they were given access to wins. Server-side redirect
 * means no client-side flash.
 */
export default async function AppHome() {
  const user = await currentUser();
  if (!user) redirect("/");

  const organizationId = await getActiveOrganizationId();
  if (!organizationId) redirect("/app/console");

  const tenant = await tenantDbFor(organizationId);
  const access = await tenant.brainAccess.findFirst({
    where: { userId: user.id },
    include: { brain: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (access) {
    redirect(`/app/brain/${encodeURIComponent(access.brain.name)}`);
  }

  // No explicit grants — org members still have implicit editor access to
  // `type: "org"` brains, so land them on the first one instead of the
  // console.
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, organizationId },
    select: { id: true },
  });
  if (membership) {
    const orgBrain = await tenant.brain.findFirst({
      where: { type: "org" },
      select: { name: true },
      orderBy: { createdAt: "asc" },
    });
    if (orgBrain) {
      redirect(`/app/brain/${encodeURIComponent(orgBrain.name)}`);
    }
  }

  redirect("/app/console");
}
