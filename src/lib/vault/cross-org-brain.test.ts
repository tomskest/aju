/**
 * Tests for the pure halves of cross-org brain resolution: the access rule
 * shared by the brain page, the rail, and the API, and the path builder the
 * org-switch bounce returns to.
 */
import { describe, it, expect } from "vitest";
import { brainRoleFor, brainPagePath } from "./cross-org-brain";

describe("brainRoleFor", () => {
  it("prefers an explicit BrainAccess role over the org default", () => {
    expect(brainRoleFor("viewer", "org", true)).toBe("viewer");
    expect(brainRoleFor("owner", "personal", false)).toBe("owner");
  });

  it("grants implicit editor on org brains to org members", () => {
    expect(brainRoleFor(null, "org", true)).toBe("editor");
  });

  it("grants nothing on org brains to non-members", () => {
    expect(brainRoleFor(null, "org", false)).toBeNull();
  });

  it("never grants implicit access to a personal brain", () => {
    expect(brainRoleFor(null, "personal", true)).toBeNull();
  });
});

describe("brainPagePath", () => {
  it("builds the brain root when there is no document", () => {
    expect(brainPagePath("Crewpoint", null)).toBe("/app/brain/Crewpoint");
  });

  it("keeps document path separators intact", () => {
    expect(brainPagePath("Crewpoint", "hiring/plus-three-hires.md")).toBe(
      "/app/brain/Crewpoint/hiring/plus-three-hires.md",
    );
  });

  it("encodes each segment so spaces and query chars survive", () => {
    expect(brainPagePath("My Brain", "notes/what now?.md")).toBe(
      "/app/brain/My%20Brain/notes/what%20now%3F.md",
    );
  });

  it("appends the post-switch marker when asked", () => {
    expect(
      brainPagePath("Crewpoint", "hiring/plus-three-hires.md", {
        switched: true,
      }),
    ).toBe("/app/brain/Crewpoint/hiring/plus-three-hires.md?switched=1");
  });

  it("ignores empty segments from stray slashes", () => {
    expect(brainPagePath("Crewpoint", "/hiring//notes.md/")).toBe(
      "/app/brain/Crewpoint/hiring/notes.md",
    );
  });
});
