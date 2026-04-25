import { Marked } from "marked";

// A project-scoped Marked instance so we don't mutate the global default.
// Raw HTML in the markdown is replaced with a literal notice rather than
// being passed through, because KB content is repo-controlled but we still
// don't want authors to sneak in scripts or iframes.
const marked = new Marked({
  async: false,
  gfm: true,
  breaks: false,
});

marked.use({
  renderer: {
    html(): string {
      return "";
    },
  },
});

export function renderMarkdown(body: string): string {
  const result = marked.parse(body, { async: false });
  // With async:false and a sync renderer, marked returns a string.
  return typeof result === "string" ? result : "";
}
