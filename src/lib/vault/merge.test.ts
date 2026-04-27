/**
 * Smoke tests for the three-way merge that powers the CAS protocol on
 * /api/vault/update and the aju_update MCP tool.
 *
 * Each test simulates the same two-agent race:
 *
 *   1. Both agents read the same `base` content (and the same baseHash).
 *   2. Agent A commits first → head becomes `theirs`.
 *   3. Agent B then commits with baseHash=hash(base) and content=`mine`.
 *      Server sees the hash mismatch, runs threeWayMerge(base, theirs, mine).
 *
 * The test asserts the decision the server should make — clean merge vs
 * conflict — and verifies the merged buffer round-trips the changes from
 * both sides.
 */
import { describe, expect, it } from "vitest";
import { threeWayMerge } from "./merge";

describe("threeWayMerge — protocol smoke tests", () => {
  it("auto-merges non-overlapping additions on both sides", () => {
    // Realistic markdown note. Both agents append to different sections.
    const base = [
      "# Topic foo",
      "",
      "## Background",
      "Original background paragraph.",
      "",
      "## Notes",
      "Initial notes line.",
      "",
    ].join("\n");

    // Agent A appends to Background.
    const theirs = [
      "# Topic foo",
      "",
      "## Background",
      "Original background paragraph.",
      "Additional context added by agent A.",
      "",
      "## Notes",
      "Initial notes line.",
      "",
    ].join("\n");

    // Agent B appends to Notes.
    const mine = [
      "# Topic foo",
      "",
      "## Background",
      "Original background paragraph.",
      "",
      "## Notes",
      "Initial notes line.",
      "Note added by agent B.",
      "",
    ].join("\n");

    const result = threeWayMerge(base, theirs, mine);
    expect(result.ok).toBe(true);
    if (!result.ok) return; // narrow

    // Both edits land cleanly in the merged buffer.
    expect(result.merged).toContain("Additional context added by agent A.");
    expect(result.merged).toContain("Note added by agent B.");
    // Original surviving content stays intact.
    expect(result.merged).toContain("Original background paragraph.");
    expect(result.merged).toContain("Initial notes line.");
  });

  it("returns conflict markers when both sides edit the same line", () => {
    const base = "Title: Original\nBody line one.\nBody line two.\n";
    // Both agents edit the same line — overlapping edit, must conflict.
    const theirs = "Title: Renamed by A\nBody line one.\nBody line two.\n";
    const mine = "Title: Renamed by B\nBody line one.\nBody line two.\n";

    const result = threeWayMerge(base, theirs, mine);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    // diff3 conflict markers must appear in the surfaced text.
    expect(result.conflicted).toContain("<<<<<<<");
    expect(result.conflicted).toContain("=======");
    expect(result.conflicted).toContain(">>>>>>>");
    // Both candidate values are preserved so a human (or downstream
    // agent) can see what each side intended.
    expect(result.conflicted).toContain("Renamed by A");
    expect(result.conflicted).toContain("Renamed by B");
  });

  it("collapses identical edits on both sides (no false conflict)", () => {
    // Both agents made the SAME change — server should merge, not bounce.
    const base = "alpha\nbeta\ngamma\n";
    const theirs = "alpha\nBETA\ngamma\n";
    const mine = "alpha\nBETA\ngamma\n";

    const result = threeWayMerge(base, theirs, mine);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.merged).toContain("BETA");
    // No marker text should leak into a clean merge.
    expect(result.merged).not.toContain("<<<<<<<");
  });

  it("commits to mine when theirs is unchanged (degenerates to fast-forward)", () => {
    const base = "one\ntwo\nthree\n";
    const theirs = "one\ntwo\nthree\n"; // upstream untouched
    const mine = "one\ntwo\nthree\nfour\n";

    const result = threeWayMerge(base, theirs, mine);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.merged).toContain("four");
  });

  it("commits to theirs when mine is unchanged (caller resends prior content)", () => {
    const base = "one\ntwo\nthree\n";
    const theirs = "one\ntwo\nthree\nfour\n";
    const mine = "one\ntwo\nthree\n"; // caller didn't actually change anything

    const result = threeWayMerge(base, theirs, mine);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.merged).toContain("four");
  });

  it("preserves frontmatter when only the body changes on both sides", () => {
    // Realistic shape: YAML frontmatter at top, two body sections below.
    const base = [
      "---",
      "tags: [foo, bar]",
      "---",
      "# Doc",
      "",
      "## A",
      "section a body",
      "",
      "## B",
      "section b body",
      "",
    ].join("\n");

    const theirs = base.replace("section a body", "section a body — A's edit");
    const mine = base.replace("section b body", "section b body — B's edit");

    const result = threeWayMerge(base, theirs, mine);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.merged).toContain("tags: [foo, bar]");
    expect(result.merged).toContain("section a body — A's edit");
    expect(result.merged).toContain("section b body — B's edit");
  });
});
