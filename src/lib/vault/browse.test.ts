/**
 * Tests for deriveSubdirectories, the aggregation behind the subfolder hints
 * that browse consumers (API route, agent tool, MCP tool, CLI) surface so a
 * directory holding only subfolders doesn't look empty.
 */
import { describe, it, expect } from "vitest";
import { deriveSubdirectories } from "./browse";

const groups = [
  { directory: ".", count: 3 },
  { directory: "architecture", count: 1 },
  { directory: "engineering", count: 1 },
  { directory: "engineering/midoffice", count: 7 },
  { directory: "engineering/plans", count: 6 },
  { directory: "engineering/plans/archive", count: 2 },
  { directory: "engineering-x", count: 4 },
];

describe("deriveSubdirectories", () => {
  it("lists top-level folders at the root, ignoring root-level docs", () => {
    expect(deriveSubdirectories(groups, "")).toEqual([
      { path: "architecture", docCount: 1 },
      { path: "engineering", docCount: 16 },
      { path: "engineering-x", docCount: 4 },
    ]);
  });

  it("lists immediate children of a base, aggregating deeper descendants", () => {
    expect(deriveSubdirectories(groups, "engineering")).toEqual([
      { path: "engineering/midoffice", docCount: 7 },
      { path: "engineering/plans", docCount: 8 },
    ]);
  });

  it("does not treat a prefix-sharing sibling as a child", () => {
    // "engineering-x" must not appear under "engineering".
    const children = deriveSubdirectories(groups, "engineering").map(
      (s) => s.path,
    );
    expect(children).not.toContain("engineering-x");
  });

  it("returns an empty list for a leaf directory", () => {
    expect(deriveSubdirectories(groups, "engineering/midoffice")).toEqual([]);
  });

  it("returns an empty list when there are no documents at all", () => {
    expect(deriveSubdirectories([], "")).toEqual([]);
  });
});
