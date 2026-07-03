import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: { slackInstallation: { findFirst } },
}));

import { findTeamConflict } from "./install";

describe("findTeamConflict", () => {
  beforeEach(() => {
    findFirst.mockReset();
  });

  it("only matches ACTIVE installations of OTHER orgs for the team", async () => {
    findFirst.mockResolvedValue(null);
    await findTeamConflict("T123", "org_self");
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        teamId: "T123",
        status: "active",
        organizationId: { not: "org_self" },
      },
      select: { organizationId: true },
    });
  });

  it("returns null when the team is free (or bound to this same org)", async () => {
    findFirst.mockResolvedValue(null);
    expect(await findTeamConflict("T123", "org_self")).toBeNull();
  });

  it("surfaces the other org when the team is already bound elsewhere", async () => {
    findFirst.mockResolvedValue({ organizationId: "org_other" });
    expect(await findTeamConflict("T123", "org_self")).toEqual({
      organizationId: "org_other",
    });
  });
});
