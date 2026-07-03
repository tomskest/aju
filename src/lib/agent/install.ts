/**
 * Install-time guards for the Slack integration.
 *
 * One Slack workspace ↔ one aju org. The schema's unique constraint is
 * (organizationId, teamId), which alone would let the same workspace be
 * bound to two different orgs — and the events receiver routes by teamId,
 * so a second binding would let an insider with install rights siphon
 * channel captures into their own org. This guard closes that at the only
 * place installations are created (the OAuth callback).
 */
import { prisma } from "@/lib/db";

/**
 * Returns the OTHER org already holding an active installation for this
 * Slack team, or null if the team is free (or only bound to this same org,
 * which is the ordinary reinstall path).
 */
export async function findTeamConflict(
  teamId: string,
  organizationId: string,
): Promise<{ organizationId: string } | null> {
  return prisma.slackInstallation.findFirst({
    where: {
      teamId,
      status: "active",
      organizationId: { not: organizationId },
    },
    select: { organizationId: true },
  });
}
