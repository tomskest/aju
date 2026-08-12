import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./kb-markdown";

describe("==highlight== extension", () => {
  it("renders ==text== as <mark>", () => {
    expect(renderMarkdown("a ==big deal== b")).toContain(
      "<mark>big deal</mark>",
    );
  });

  it("renders ~~text~~ as <del> alongside highlights", () => {
    const html = renderMarkdown("~~stale~~ and ==important==");
    expect(html).toContain("<del>stale</del>");
    expect(html).toContain("<mark>important</mark>");
  });

  it("nests inline formatting inside a highlight", () => {
    expect(renderMarkdown("==a **b** c==")).toContain(
      "<mark>a <strong>b</strong> c</mark>",
    );
  });

  it("leaves == inside inline code alone", () => {
    const html = renderMarkdown("check `a == b` here");
    expect(html).not.toContain("<mark>");
    expect(html).toContain("a == b");
  });

  it("leaves bare == comparisons in prose alone", () => {
    expect(renderMarkdown("a == b and c == d")).not.toContain("<mark>");
  });
});
