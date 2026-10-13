/**
 * Tests for the brain set behind `?brain=all`. The fake tenant behaves like
 * a connection whose role bypasses RLS: an unfiltered brain list returns
 * every brain in the org. Resolution must still return only the caller's
 * grants plus, for humans, the org brains.
 */
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import type { AuthSuccess } from "@/lib/auth";
import { resolveAccessibleBrainIds, resolveBrainIds, isBrainError } from "./brain";

type Brain = { id: string; name: string; type: "org" | "personal" };
type Grant = { brainId: string; userId?: string; agentId?: string; role: string };

const brains: Brain[] = [
  { id: "team", name: "Team", type: "org" },
  { id: "notes", name: "Notes", type: "org" },
  { id: "alice", name: "Alice", type: "personal" },
  { id: "aliceprivate", name: "Alice-Private", type: "personal" },
  { id: "aliceshared", name: "Alice-Shared", type: "personal" },
  { id: "bob", name: "Bob", type: "personal" },
];

const grants: Grant[] = [
  { brainId: "alice", userId: "u-alice", role: "owner" },
  { brainId: "aliceprivate", userId: "u-alice", role: "owner" },
  { brainId: "aliceshared", userId: "u-alice", role: "owner" },
  { brainId: "aliceshared", userId: "u-bob", role: "editor" },
  { brainId: "bob", userId: "u-bob", role: "owner" },
  { brainId: "notes", agentId: "a-sync", role: "editor" },
  { brainId: "aliceshared", agentId: "a-sync", role: "editor" },
];

function matches<T extends Record<string, unknown>>(row: T, where?: Record<string, unknown>): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && "in" in v) return (v.in as unknown[]).includes(row[k]);
    return row[k] === v;
  });
}

// Only the query shapes brain.ts uses; anything else would be a new
// dependency on RLS and should fail loudly here.
const tenant = {
  brain: {
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) =>
      brains.filter((b) => matches(b, where)),
  },
  brainAccess: {
    findMany: async ({ where }: { where: Record<string, unknown> }) => {
      const { brain, ...rest } = where as { brain?: { name: { in: string[] } } };
      return grants
        .filter((g) => matches(g, rest))
        .map((g) => ({ ...g, brain: brains.find((b) => b.id === g.brainId)! }))
        .filter((g) => !brain || brain.name.in.includes(g.brain.name));
    },
  },
} as never;

const human = (userId: string): AuthSuccess => ({ identity: userId, userId, scopes: ["read"] });
const agent = (agentId: string): AuthSuccess => ({
  identity: `agent:${agentId}`,
  userId: "u-alice",
  agentId,
  scopes: ["read"],
});

describe("resolveAccessibleBrainIds", () => {
  it("gives a member their grants and the org brains, never another person's personal brains", async () => {
    const ids = await resolveAccessibleBrainIds(tenant, human("u-bob"));
    expect(ids.sort()).toEqual(["aliceshared", "bob", "notes", "team"]);
  });

  it("gives an agent its grants only, no org fallback and no owner's brains", async () => {
    const ids = await resolveAccessibleBrainIds(tenant, agent("a-sync"));
    expect(ids.sort()).toEqual(["aliceshared", "notes"]);
  });

  it("gives a member with no grants the org brains only", async () => {
    const ids = await resolveAccessibleBrainIds(tenant, human("u-carol"));
    expect(ids.sort()).toEqual(["notes", "team"]);
  });

  it("keeps the full list for env-var callers", async () => {
    const ids = await resolveAccessibleBrainIds(tenant, undefined);
    expect(ids).toHaveLength(brains.length);
  });
});

describe("resolveBrainIds with ?brain=all", () => {
  const req = new NextRequest("https://aju.test/api/vault/search?q=x&brain=all");

  it("searches only what the caller can open", async () => {
    const result = await resolveBrainIds(tenant, req, human("u-bob"));
    if (isBrainError(result)) throw new Error("unexpected error response");
    expect(result.map((b) => b.brainName).sort()).toEqual(["Alice-Shared", "Bob", "Notes", "Team"]);
    expect(result.find((b) => b.brainName === "Alice-Shared")?.accessRole).toBe("editor");
  });

  it("refuses a named personal brain the caller was never given", async () => {
    const named = new NextRequest("https://aju.test/api/vault/search?q=x&brain=Alice-Private");
    const result = await resolveBrainIds(tenant, named, human("u-bob"));
    expect(isBrainError(result) && result.status).toBe(403);
  });
});
