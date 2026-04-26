"use client";

import { useEffect, useRef } from "react";

/**
 * Renders KB markdown HTML with the project's `kb-prose` style and
 * progressively upgrades any ```mermaid code block into a rendered
 * SVG diagram. Mermaid's runtime is dynamically imported on first
 * paint that contains a diagram, so the ~500KB cost is paid only on
 * pages that actually need it.
 *
 * The HTML comes from a project-scoped Marked instance that strips
 * raw HTML input, so it is safe to inject here.
 */

type Props = {
  html: string;
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
        theme: "base",
        fontFamily:
          'var(--font-mono), ui-monospace, "SF Mono", Menlo, monospace',
        themeVariables: {
          background: "transparent",
          mainBkg: "rgba(34, 197, 94, 0.10)",
          secondBkg: "rgba(255, 255, 255, 0.04)",
          tertiaryColor: "rgba(255, 255, 255, 0.04)",

          primaryColor: "rgba(34, 197, 94, 0.10)",
          primaryBorderColor: "#22c55e",
          primaryTextColor: "#ececee",
          secondaryColor: "rgba(255, 255, 255, 0.04)",
          secondaryBorderColor: "rgba(255, 255, 255, 0.18)",
          secondaryTextColor: "#ececee",
          tertiaryBorderColor: "rgba(255, 255, 255, 0.10)",
          tertiaryTextColor: "#a8a8b0",

          textColor: "#a8a8b0",
          nodeTextColor: "#ececee",
          titleColor: "#ececee",

          lineColor: "rgba(255, 255, 255, 0.45)",
          edgeLabelBackground: "#0e0f12",

          clusterBkg: "rgba(255, 255, 255, 0.02)",
          clusterBorder: "rgba(255, 255, 255, 0.10)",

          noteBkgColor: "rgba(34, 197, 94, 0.10)",
          noteTextColor: "#ececee",
          noteBorderColor: "rgba(34, 197, 94, 0.4)",

          actorBkg: "rgba(34, 197, 94, 0.10)",
          actorBorder: "#22c55e",
          actorTextColor: "#ececee",
          actorLineColor: "rgba(255, 255, 255, 0.30)",
          signalColor: "rgba(255, 255, 255, 0.45)",
          signalTextColor: "#a8a8b0",
          labelBoxBkgColor: "rgba(34, 197, 94, 0.10)",
          labelBoxBorderColor: "#22c55e",
          labelTextColor: "#ececee",
          loopTextColor: "#a8a8b0",
          activationBorderColor: "rgba(255, 255, 255, 0.30)",
          activationBkgColor: "rgba(255, 255, 255, 0.04)",
          sequenceNumberColor: "#050608",

          sectionBkgColor: "rgba(255, 255, 255, 0.04)",
          altSectionBkgColor: "rgba(255, 255, 255, 0.02)",
          sectionBkgColor2: "rgba(255, 255, 255, 0.06)",
          excludeBkgColor: "rgba(255, 255, 255, 0.02)",
          taskBorderColor: "#22c55e",
          taskBkgColor: "rgba(34, 197, 94, 0.10)",
          taskTextColor: "#ececee",
          taskTextLightColor: "#ececee",
          taskTextOutsideColor: "#a8a8b0",
          taskTextClickableColor: "#22c55e",
          activeTaskBorderColor: "#22c55e",
          activeTaskBkgColor: "rgba(34, 197, 94, 0.18)",
          gridColor: "rgba(255, 255, 255, 0.06)",
          doneTaskBkgColor: "rgba(255, 255, 255, 0.10)",
          doneTaskBorderColor: "rgba(255, 255, 255, 0.20)",
          critBorderColor: "#ef4444",
          critBkgColor: "rgba(239, 68, 68, 0.18)",
          todayLineColor: "#22c55e",

          pie1: "#22c55e",
          pie2: "rgba(96, 232, 120, 0.7)",
          pie3: "rgba(96, 232, 120, 0.45)",
          pie4: "rgba(255, 255, 255, 0.5)",
          pie5: "rgba(255, 255, 255, 0.3)",
          pie6: "rgba(255, 255, 255, 0.15)",
          pieTitleTextColor: "#ececee",
          pieSectionTextColor: "#050608",
          pieLegendTextColor: "#a8a8b0",
          pieStrokeColor: "#0e0f12",
          pieOpacity: "0.95",
        },
      });
      return mermaid;
    });
  }
  return mermaidLoadPromise;
}

export default function KbProse({ html, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

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
        if (pre.dataset.mermaidEnhanced === "1") continue;

        const source = codeEl.textContent ?? "";
        const id = `mermaid-${Date.now()}-${i}`;

        let svg: string;
        try {
          const result = await mermaid.render(id, source);
          svg = result.svg;
        } catch (err) {
          pre.dataset.mermaidEnhanced = "error";
          const note = document.createElement("div");
          note.className = "mermaid-error";
          note.textContent = `mermaid: ${
            err instanceof Error ? err.message : String(err)
          }`;
          pre.parentElement?.insertBefore(note, pre.nextSibling);
          continue;
        }

        const figure = document.createElement("figure");
        figure.className = "mermaid-figure";
        figure.dataset.mermaidSource = source;
        figure.dataset.mermaidEnhanced = "1";

        const label = document.createElement("span");
        label.className = "mermaid-label";
        label.textContent = "mermaid";
        figure.appendChild(label);

        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "mermaid-copy";
        copyBtn.textContent = "copy";
        copyBtn.title = "Copy diagram source";
        copyBtn.addEventListener("click", () => {
          void navigator.clipboard.writeText(source).then(
            () => {
              copyBtn.textContent = "copied";
              window.setTimeout(() => {
                copyBtn.textContent = "copy";
              }, 1200);
            },
            () => {
              copyBtn.textContent = "failed";
            },
          );
        });
        figure.appendChild(copyBtn);

        const svgWrap = document.createElement("div");
        svgWrap.className = "mermaid-svg";
        svgWrap.innerHTML = svg;
        figure.appendChild(svgWrap);

        pre.replaceWith(figure);
      }
    })().catch((err) => {
      console.error("[kb-prose] mermaid enhancement failed:", err);
    });

    return () => {
      cancelled = true;
    };
  }, [html]);

  return (
    <div
      ref={containerRef}
      className={className ?? "kb-prose"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
