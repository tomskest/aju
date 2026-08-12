import {
  Marked,
  type Tokens,
  type TokenizerAndRendererExtension,
} from "marked";

// A project-scoped Marked instance so we don't mutate the global default.
// Raw HTML in the markdown is dropped rather than passed through, because KB
// content is repo-controlled but we still don't want authors to sneak in
// scripts or iframes.
const marked = new Marked({
  async: false,
  gfm: true,
  breaks: false,
});

// The one exception: the internal wikilink anchors that resolveWikilinksToMarkdown
// emits (`<a href="/app/brain/…" class="wikilink…">…</a>`). Those are generated,
// not author-typed, so they're safe to pass through — and stripping them was what
// made wikilinks render as dead plain text. The pattern is anchored end-to-end
// (exact href scheme, only the wikilink class, no other attributes), so a
// hand-written `<a onclick=…>` or a foreign href does not match and is still
// dropped along with every other raw tag.
const WIKILINK_ANCHOR =
  /^<a href="\/app\/brain\/[^"<>]*" class="wikilink(?: wikilink-missing)?">$/;

function isWikilinkAnchor(html: string): boolean {
  return html === "</a>" || WIKILINK_ANCHOR.test(html);
}

marked.use({
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag): string {
      return isWikilinkAnchor(text) ? text : "";
    },
  },
});

// Reader highlights: `==text==` renders as <mark>. Obsidian-flavoured
// syntax, not GFM, so it needs a custom inline extension. The same raw
// markers are what agents read in the source; rendering them keeps the
// human view in sync with the annotation. Guards: no whitespace or `=`
// hugging the inside of the markers, so `a == b` comparisons in prose
// stay untouched (code spans are consumed by the codespan tokenizer
// before this extension ever sees them).
const highlightExtension: TokenizerAndRendererExtension = {
  name: "highlight",
  level: "inline",
  start(src: string) {
    const i = src.indexOf("==");
    return i === -1 ? undefined : i;
  },
  tokenizer(src: string) {
    const match = /^==(?![\s=])([\s\S]*?[^\s=])==(?!=)/.exec(src);
    if (!match) return undefined;
    return {
      type: "highlight",
      raw: match[0],
      text: match[1],
      tokens: this.lexer.inlineTokens(match[1]),
    };
  },
  renderer(token) {
    return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`;
  },
};

marked.use({ extensions: [highlightExtension] });

export function renderMarkdown(body: string): string {
  const result = marked.parse(body, { async: false });
  // With async:false and a sync renderer, marked returns a string.
  return typeof result === "string" ? result : "";
}
