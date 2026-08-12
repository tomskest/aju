import { describe, expect, it } from "vitest";
import { annotateSource, type SelectionQuote } from "./annotate";

function q(text: string, before = "", after = ""): SelectionQuote {
  return { text, before, after };
}

function expectWrapped(
  result: ReturnType<typeof annotateSource>,
): Extract<ReturnType<typeof annotateSource>, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result;
}

describe("annotateSource", () => {
  it("wraps a plain selection in strike markers", () => {
    const src = "First paragraph.\n\nSecond paragraph here.\n";
    const r = expectWrapped(annotateSource(src, q("Second paragraph"), "strike"));
    expect(r.action).toBe("wrapped");
    expect(r.content).toBe("First paragraph.\n\n~~Second paragraph~~ here.\n");
  });

  it("wraps a selection in highlight markers", () => {
    const src = "Note this fact.\n";
    const r = expectWrapped(annotateSource(src, q("this fact"), "highlight"));
    expect(r.content).toBe("Note ==this fact==.\n");
  });

  it("rejects selections that are too short", () => {
    const r = annotateSource("some text\n", q("so"), "strike");
    expect(r).toEqual({ ok: false, reason: "too_short" });
  });

  it("reports not_found for text that isn't in the source", () => {
    const r = annotateSource("some text\n", q("entirely absent"), "strike");
    expect(r).toEqual({ ok: false, reason: "not_found" });
  });

  it("expands a selection that crosses a bold boundary", () => {
    const src = "**Position is the contract.** Chunk order matters.\n";
    const r = expectWrapped(
      annotateSource(src, q("the contract. Chunk"), "strike"),
    );
    expect(r.content).toBe(
      "~~**Position is the contract.** Chunk~~ order matters.\n",
    );
  });

  it("nests inside bold without expanding", () => {
    const src = "**Position is the contract.**\n";
    const r = expectWrapped(annotateSource(src, q("is the"), "strike"));
    expect(r.content).toBe("**Position ~~is the~~ contract.**\n");
  });

  it("expands to cover a whole inline code span", () => {
    const src = "Set `booking_passenger.position` to 1.\n";
    const r = expectWrapped(
      annotateSource(src, q("passenger.position"), "strike"),
    );
    expect(r.content).toBe("Set ~~`booking_passenger.position`~~ to 1.\n");
  });

  it("expands to cover a whole wikilink", () => {
    const src = "See [[eng/api|the API doc]] for details.\n";
    const r = expectWrapped(annotateSource(src, q("API doc for"), "strike"));
    expect(r.content).toBe("See ~~[[eng/api|the API doc]] for~~ details.\n");
  });

  it("expands a selection that crosses a markdown link boundary", () => {
    const src = "Read [the guide](https://x.y) now.\n";
    const r = expectWrapped(annotateSource(src, q("guide now"), "strike"));
    expect(r.content).toBe("Read ~~[the guide](https://x.y) now~~.\n");
  });

  it("disambiguates repeated phrases using context", () => {
    const src = "alpha target beta\n\ngamma target delta\n";
    const r = expectWrapped(
      annotateSource(src, q("target", "gamma ", " delta"), "strike"),
    );
    expect(r.content).toBe("alpha target beta\n\ngamma ~~target~~ delta\n");
  });

  it("rejects ambiguous matches with identical contexts", () => {
    const src = "x abc y\n\nx abc y\n";
    const r = annotateSource(src, q("abc", "x ", " y"), "strike");
    expect(r).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("rejects selections spanning two paragraphs", () => {
    const src = "End one.\n\nStart two.\n";
    const r = annotateSource(src, q("one.\nStart"), "strike");
    expect(r).toEqual({ ok: false, reason: "crosses_blocks" });
  });

  it("rejects selections spanning list items", () => {
    const src = "- item one\n- item two\n";
    const r = annotateSource(src, q("one\nitem two"), "strike");
    expect(r).toEqual({ ok: false, reason: "crosses_blocks" });
  });

  it("rejects selections inside fenced code", () => {
    const src = "Para.\n\n```js\nconst a = 1;\n```\n\nAfter.\n";
    const r = annotateSource(src, q("const a = 1;"), "strike");
    expect(r).toEqual({ ok: false, reason: "inside_code_block" });
  });

  it("anchors inside headings after the marker", () => {
    const src = "## Known gaps\n\nBody.\n";
    const r = expectWrapped(annotateSource(src, q("Known gaps"), "strike"));
    expect(r.content).toBe("## ~~Known gaps~~\n\nBody.\n");
  });

  it("anchors inside list items past the bullet", () => {
    const src =
      "- **Readiness is whole-party.** One passenger blocks the party.\n";
    const r = expectWrapped(
      annotateSource(src, q("whole-party. One passenger"), "strike"),
    );
    expect(r.content).toBe(
      "- ~~**Readiness is whole-party.** One passenger~~ blocks the party.\n",
    );
  });

  it("anchors inside table cells", () => {
    const src = "| a | b |\n|---|---|\n| foo bar | baz |\n";
    const r = expectWrapped(annotateSource(src, q("foo bar"), "strike"));
    expect(r.content).toBe("| a | b |\n|---|---|\n| ~~foo bar~~ | baz |\n");
  });

  it("ignores frontmatter when anchoring", () => {
    const src = "---\ntitle: target\n---\n\ntarget here.\n";
    const r = expectWrapped(annotateSource(src, q("target"), "strike"));
    expect(r.content).toBe("---\ntitle: target\n---\n\n~~target~~ here.\n");
  });

  it("wraps across a soft line break inside a paragraph", () => {
    const src = "one\ntwo three\n";
    const r = expectWrapped(annotateSource(src, q("one\ntwo"), "strike"));
    expect(r.content).toBe("~~one\ntwo~~ three\n");
  });

  it("toggles an exact strike off", () => {
    const src = "Some ~~stale fact~~ here.\n";
    const r = expectWrapped(annotateSource(src, q("stale fact"), "strike"));
    expect(r.action).toBe("unwrapped");
    expect(r.content).toBe("Some stale fact here.\n");
  });

  it("toggles the whole span off from a partial selection", () => {
    const src = "Some ~~stale old fact~~ here.\n";
    const r = expectWrapped(annotateSource(src, q("old"), "strike"));
    expect(r.action).toBe("unwrapped");
    expect(r.content).toBe("Some stale old fact here.\n");
  });

  it("strikes inside a highlight without disturbing it", () => {
    const src = "==alpha beta gamma==\n";
    const r = expectWrapped(annotateSource(src, q("beta"), "strike"));
    expect(r.content).toBe("==alpha ~~beta~~ gamma==\n");
  });

  it("trims whitespace so markers hug the text", () => {
    const src = "keep this part safe\n";
    const r = expectWrapped(annotateSource(src, q(" this part "), "strike"));
    expect(r.content).toBe("keep ~~this part~~ safe\n");
  });

  it("appends an attribution comment when an author is given", () => {
    const src = "Note this fact.\n";
    const r = expectWrapped(
      annotateSource(src, q("this fact"), "highlight", {
        author: "toomas@x.y",
        date: "2026-08-12",
      }),
    );
    expect(r.content).toBe(
      "Note ==this fact==<!-- highlighted by toomas@x.y on 2026-08-12 -->.\n",
    );
  });

  it("removes the attribution comment when toggling off", () => {
    const src = "Some ~~stale fact~~<!-- struck by a@b.c on 2026-08-10 --> here.\n";
    const r = expectWrapped(annotateSource(src, q("stale fact"), "strike"));
    expect(r.action).toBe("unwrapped");
    expect(r.content).toBe("Some stale fact here.\n");
  });

  it("anchors cleanly next to an existing attribution comment", () => {
    const src =
      "alpha ~~beta~~<!-- struck by x@y.z on 2026-01-01 --> gamma delta\n";
    const r = expectWrapped(annotateSource(src, q("gamma delta"), "strike"));
    expect(r.content).toBe(
      "alpha ~~beta~~<!-- struck by x@y.z on 2026-01-01 --> ~~gamma delta~~\n",
    );
  });

  it("keeps a comment-free unwrap intact when kinds differ", () => {
    const src = "Some ~~stale~~<!-- struck by a@b.c on 2026-08-10 --> ==hot== here.\n";
    const r = expectWrapped(annotateSource(src, q("hot"), "highlight"));
    expect(r.action).toBe("unwrapped");
    expect(r.content).toBe(
      "Some ~~stale~~<!-- struck by a@b.c on 2026-08-10 --> hot here.\n",
    );
  });
});
