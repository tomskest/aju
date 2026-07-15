import { describe, it, expect } from "vitest";
import {
  findQueryBlocks,
  renderQueryResult,
  resolveDocumentContent,
  type QueryRow,
  type QuerySpec,
} from "./query-block";
import { renderMarkdown } from "./kb-markdown";
import { resolveWikilinksToMarkdown } from "./render-wikilinks";

function row(over: Partial<QueryRow>): QueryRow {
  return {
    id: "c1",
    path: "collab/handoffs/a.md",
    title: "A handoff",
    doc_status: "OPEN",
    doc_type: "handoff",
    tags: ["collab", "handoff"],
    frontmatter: { from: "@BE", to: "@FE" },
    created_at: new Date("2026-07-14T10:00:00Z"),
    updated_at: new Date("2026-07-14T12:00:00Z"),
    ...over,
  };
}

describe("findQueryBlocks", () => {
  it("parses a full spec", () => {
    const content = [
      "# Board",
      "",
      "```aju-query",
      "from: collab/handoffs",
      "where:",
      "  status: [OPEN, IN_REVIEW]",
      "  tags: [handoff]",
      "sort: created desc",
      "columns: [title, from, to, status]",
      "limit: 25",
      "as: table",
      "```",
      "",
      "end",
    ].join("\n");

    const blocks = findQueryBlocks(content);
    expect(blocks).toHaveLength(1);
    const spec = blocks[0].spec as QuerySpec;
    expect(spec.from).toBe("collab/handoffs");
    expect(spec.where).toEqual({ status: ["OPEN", "IN_REVIEW"], tags: ["handoff"] });
    expect(spec.sort).toBe("created desc");
    expect(spec.columns).toEqual(["title", "from", "to", "status"]);
    expect(spec.limit).toBe(25);
    expect(spec.as).toBe("table");
  });

  it("finds multiple blocks and ignores prose", () => {
    const content =
      "```aju-query\nwhere:\n  status: OPEN\n```\n\ntext\n\n```aju-query\nwhere:\n  status: DONE\n```";
    const blocks = findQueryBlocks(content);
    expect(blocks).toHaveLength(2);
    expect((blocks[0].spec as QuerySpec).where).toEqual({ status: "OPEN" });
    expect((blocks[1].spec as QuerySpec).where).toEqual({ status: "DONE" });
  });

  it("returns none when there is no block", () => {
    expect(findQueryBlocks("# just a note\n\nno blocks here")).toHaveLength(0);
  });

  it("captures a parse error instead of throwing", () => {
    const content = "```aju-query\nwhere: [this: is: bad\n```";
    const blocks = findQueryBlocks(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].spec).toBeNull();
    expect(blocks[0].error).toBeTruthy();
  });
});

describe("renderQueryResult", () => {
  it("renders a table with linked title, status and frontmatter columns", () => {
    const spec: QuerySpec = { columns: ["title", "from", "to", "status"] };
    const md = renderQueryResult([row({})], spec);
    const lines = md.split("\n");
    expect(lines[0]).toBe("| Title | From | To | Status |");
    expect(lines[1]).toBe("| --- | --- | --- | --- |");
    expect(lines[2]).toBe(
      "| [[collab/handoffs/a|A handoff]] | @BE | @FE | OPEN |",
    );
  });

  it("escapes pipes and newlines in cells", () => {
    const md = renderQueryResult(
      [row({ title: "a | b\nc", frontmatter: {} })],
      { columns: ["title"] },
    );
    expect(md.split("\n")[2]).toBe("| [[collab/handoffs/a|a \\| b c]] |");
  });

  it("joins array tags", () => {
    const md = renderQueryResult([row({})], { columns: ["tags"] });
    expect(md.split("\n")[2]).toBe("| collab, handoff |");
  });

  it("renders an empty table body when there are no rows", () => {
    const md = renderQueryResult([], { columns: ["title", "status"] });
    expect(md).toBe("| Title | Status |\n| --- | --- |\n|  |  |");
  });

  it("renders a list when as: list", () => {
    const md = renderQueryResult([row({})], {
      as: "list",
      columns: ["title", "status", "from"],
    });
    expect(md).toBe("- [[collab/handoffs/a|A handoff]] — OPEN · @BE");
  });

  it("uses created/updated date columns", () => {
    const md = renderQueryResult([row({})], { columns: ["created", "updated"] });
    expect(md.split("\n")[2]).toBe("| 2026-07-14 | 2026-07-14 |");
  });
});

describe("resolveDocumentContent (no DB paths)", () => {
  const fakeTx = {} as never;

  it("returns content unchanged when there are no blocks", async () => {
    const content = "# note\n\nbody with no query";
    expect(await resolveDocumentContent(fakeTx, ["b1"], content)).toBe(content);
  });

  it("replaces a malformed block with an inline notice, not an error", async () => {
    const content = "before\n\n```aju-query\nwhere: [bad: yaml:\n```\n\nafter";
    const out = await resolveDocumentContent(fakeTx, ["b1"], content);
    expect(out).toContain("before");
    expect(out).toContain("after");
    expect(out).toContain("⚠️ aju-query");
    expect(out).not.toContain("```aju-query");
  });
});

describe("web render composition (table markdown → HTML)", () => {
  it("renders a query table with a clickable wikilink through the page pipeline", () => {
    // Mirrors page.tsx: renderQueryResult → resolveWikilinks → renderMarkdown.
    const table = renderQueryResult([row({})], {
      columns: ["title", "status"],
    });
    const md = resolveWikilinksToMarkdown(
      table,
      ["collab/handoffs/a.md"],
      "Crewpoint",
      "collab/board.md",
    );
    const html = renderMarkdown(md);
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Title</th>");
    expect(html).toContain("<th>Status</th>");
    // The item title is now a real clickable wikilink, not stripped to text.
    expect(html).toContain(
      '<a href="/app/brain/Crewpoint/collab/handoffs/a.md" class="wikilink">A handoff</a>',
    );
    expect(html).toContain("OPEN");
  });

  it("keeps a dangling wikilink clickable with the missing class", () => {
    const md = resolveWikilinksToMarkdown(
      "See [[collab/handoffs/gone|Gone]].",
      ["collab/handoffs/a.md"],
      "Crewpoint",
      "collab/board.md",
    );
    const html = renderMarkdown(md);
    expect(html).toContain('class="wikilink wikilink-missing"');
    expect(html).toContain("?missing=");
    expect(html).toContain(">Gone</a>");
  });

  it("still strips scripts and hand-written anchors (no injection)", () => {
    const html = renderMarkdown(
      'Hi <script>alert(1)</script> <a href="https://evil.test" onclick="x()">bad</a>',
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("evil.test");
    expect(html).not.toContain("<a ");
  });
});
