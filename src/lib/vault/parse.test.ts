/**
 * Tests for normalizeDirectory, which shapes user-supplied directory filters
 * (browse route, agent tool, MCP tool) to match the slash-free form that
 * parseDocument stores via path.dirname — an exact-match query against
 * "engineering/plans/" would otherwise return zero rows.
 */
import { describe, it, expect } from "vitest";
import { normalizeDirectory } from "./parse";

describe("normalizeDirectory", () => {
  it("leaves a clean directory untouched", () => {
    expect(normalizeDirectory("engineering/plans")).toBe("engineering/plans");
  });

  it("strips a trailing slash", () => {
    expect(normalizeDirectory("engineering/plans/")).toBe("engineering/plans");
  });

  it("strips a leading slash", () => {
    expect(normalizeDirectory("/engineering/plans")).toBe("engineering/plans");
  });

  it("strips repeated slashes on both ends", () => {
    expect(normalizeDirectory("//engineering/plans//")).toBe(
      "engineering/plans",
    );
  });

  it("normalizes backslashes like parseDocument does", () => {
    expect(normalizeDirectory("engineering\\plans\\")).toBe(
      "engineering/plans",
    );
  });

  it("reduces a bare slash to the empty string (root listing)", () => {
    expect(normalizeDirectory("/")).toBe("");
  });
});
