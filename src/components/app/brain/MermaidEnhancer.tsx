"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Wrap server-rendered markdown HTML and progressively replace any
 * `<pre><code class="language-mermaid">…</code></pre>` block with a
 * rendered SVG. Adds an "Edit" overlay button that calls `onEditBlock`
 * with the original mermaid source so the parent component can open
 * the editor modal.
 *
 * Mermaid is dynamically imported on first paint so the ~500KB runtime
 * is loaded only when the page actually contains diagrams. SSR-safe.
 */
type MermaidBlockMeta = {
  /** Stable id assigned when the block is found in the article DOM. */
  id: string;
  /** Original mermaid source extracted from the code element. */
  source: string;
};

type Props = {
  html: string;
  /** Called when the user clicks the Edit overlay on a rendered diagram. */
  onEditBlock?: (block: MermaidBlockMeta) => void;
  /** Disable the Edit overlay (read-only viewers). */
  canEdit?: boolean;
  className?: string;
};

let mermaidLoadPromise: Promise<typeof import("mermaid").default> | null = null;

async function loadMermaid(): Promise<typeof import("mermaid").default> {
  if (!mermaidLoadPromise) {
    mermaidLoadPromise = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "default",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      });
      return mermaid;
    });
  }
  return mermaidLoadPromise;
}

export default function MermaidEnhancer({
  html,
  onEditBlock,
  canEdit = false,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderedKey, setRenderedKey] = useState(0);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    // Find all mermaid code blocks. They render as
    // <pre><code class="language-mermaid">SOURCE</code></pre>
    const codeBlocks = Array.from(
      root.querySelectorAll<HTMLElement>("code.language-mermaid"),
    );
    if (codeBlocks.length === 0) return;

    let cancelled = false;

    (async () => {
      const mermaid = await loadMermaid();
      if (cancelled) return;

      for (let i = 0; i < codeBlocks.length; i++) {
        const codeEl = codeBlocks[i];
        const pre = codeEl.parentElement;
        if (!pre || pre.tagName !== "PRE") continue;
        // Already enhanced on a previous pass — skip.
        if (pre.dataset.mermaidEnhanced === "1") continue;

        const source = codeEl.textContent ?? "";
        const id = `mermaid-${Date.now()}-${i}`;

        let svg: string;
        try {
          const result = await mermaid.render(id, source);
          svg = result.svg;
        } catch (err) {
          // Render failed (syntax error etc.) — leave the original code
          // block visible so the user can fix it. Annotate it as failed
          // so we don't keep retrying.
          pre.dataset.mermaidEnhanced = "error";
          const note = document.createElement("div");
          note.className =
            "mt-1 text-xs text-red-600 font-mono";
          note.textContent = `mermaid render failed: ${
            err instanceof Error ? err.message : String(err)
          }`;
          pre.parentElement?.insertBefore(note, pre.nextSibling);
          continue;
        }

        // Build the wrapper:
        //   <figure class="mermaid-figure" data-source="…">
        //     <div class="mermaid-svg">…</div>
        //     [Edit button if canEdit]
        //   </figure>
        const figure = document.createElement("figure");
        figure.className =
          "mermaid-figure relative my-4 overflow-auto rounded border border-[var(--color-line)] bg-white p-3";
        figure.dataset.mermaidSource = source;
        figure.dataset.mermaidEnhanced = "1";

        const svgWrap = document.createElement("div");
        svgWrap.className = "mermaid-svg flex justify-center";
        svgWrap.innerHTML = svg;
        figure.appendChild(svgWrap);

        if (canEdit && onEditBlock) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = "Edit";
          btn.className =
            "absolute right-2 top-2 rounded border border-[var(--color-line)] bg-white px-2 py-0.5 text-xs hover:bg-[var(--color-tint)]";
          btn.addEventListener("click", () => {
            onEditBlock({ id, source });
          });
          figure.appendChild(btn);
        }

        pre.replaceWith(figure);
      }
    })().catch((err) => {
      console.error("[mermaid-enhancer] failed:", err);
    });

    return () => {
      cancelled = true;
    };
    // Re-run when the html content changes (after a save).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, renderedKey]);

  // The article body is set via dangerouslySetInnerHTML — this is the
  // same HTML the parent rendered server-side, just with the post-paint
  // mermaid enhancement applied above.
  return (
    <div
      ref={containerRef}
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
      // Force a re-render when html changes so the useEffect runs again.
      key={`mermaid-host-${html.length}-${renderedKey}`}
    />
  );
}
