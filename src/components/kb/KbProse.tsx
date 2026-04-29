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

function parseColorToRgb(input: string): [number, number, number] | null {
  const s = input.trim().toLowerCase();
  if (!s || s === "none" || s === "transparent" || s.startsWith("url(")) {
    return null;
  }
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return [r, g, b];
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
      return [r, g, b];
    }
    return null;
  }
  const m = s.match(/rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/);
  if (m) {
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  return null;
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function fillIsLight(el: Element): boolean | null {
  const attr = el.getAttribute("fill");
  let raw: string | null = attr;
  if (!raw || raw === "none") {
    const styleFill = (el as SVGElement).style?.fill;
    if (styleFill) raw = styleFill;
  }
  if (!raw && typeof window !== "undefined") {
    raw = window.getComputedStyle(el).fill;
  }
  if (!raw) return null;
  const rgb = parseColorToRgb(raw);
  if (!rgb) return null;
  return relativeLuminance(rgb) > 0.55;
}

function fixSvgContrast(svg: SVGElement) {
  const groups = svg.querySelectorAll<SVGGElement>(
    "g.node, g.cluster, g.actor, g.task, g.section",
  );
  groups.forEach((g) => {
    const shape = g.querySelector(
      "rect, polygon, circle, ellipse, path",
    ) as Element | null;
    if (!shape) return;
    const light = fillIsLight(shape);
    if (light !== true) return;

    const dark = "#0e0f12";
    g.querySelectorAll<SVGTextElement>("text, tspan").forEach((t) => {
      t.setAttribute("fill", dark);
      t.style.fill = dark;
    });
    g.querySelectorAll<HTMLElement>(
      "foreignObject *, .nodeLabel, .label, .edgeLabel",
    ).forEach((el) => {
      el.style.color = dark;
    });
  });
}

function openMermaidFullscreen(sourceSvg: SVGElement) {
  const overlay = document.createElement("div");
  overlay.className = "mermaid-fullscreen";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Diagram fullscreen view");

  const toolbar = document.createElement("div");
  toolbar.className = "mermaid-fullscreen-toolbar";

  const mkBtn = (label: string, title: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mermaid-fullscreen-btn";
    b.textContent = label;
    b.title = title;
    return b;
  };

  const zoomOutBtn = mkBtn("−", "Zoom out");
  const zoomInBtn = mkBtn("+", "Zoom in");
  const fitBtn = mkBtn("fit", "Fit to screen (0)");
  const closeBtn = mkBtn("close", "Close (Esc)");
  toolbar.append(zoomOutBtn, zoomInBtn, fitBtn, closeBtn);

  const hint = document.createElement("div");
  hint.className = "mermaid-fullscreen-hint";
  hint.textContent = "drag to pan · scroll to zoom · esc to close";

  const canvas = document.createElement("div");
  canvas.className = "mermaid-fullscreen-canvas";

  const stage = document.createElement("div");
  stage.className = "mermaid-fullscreen-stage";
  const clonedSvg = sourceSvg.cloneNode(true) as SVGElement;
  clonedSvg.removeAttribute("style");
  stage.appendChild(clonedSvg);

  canvas.append(stage);
  overlay.append(toolbar, canvas, hint);
  document.body.appendChild(overlay);

  const prevBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  let scale = 1;
  let tx = 0;
  let ty = 0;

  const apply = () => {
    stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  };

  const fit = () => {
    stage.style.transform = "translate(0px, 0px) scale(1)";
    const stageRect = stage.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    if (!stageRect.width || !stageRect.height) {
      apply();
      return;
    }
    const padding = 96;
    const sx = (canvasRect.width - padding) / stageRect.width;
    const sy = (canvasRect.height - padding) / stageRect.height;
    scale = Math.max(0.1, Math.min(sx, sy, 6));
    tx = (canvasRect.width - stageRect.width * scale) / 2;
    ty = (canvasRect.height - stageRect.height * scale) / 2;
    apply();
  };

  const zoomAt = (factor: number, cx: number, cy: number) => {
    const newScale = Math.max(0.1, Math.min(12, scale * factor));
    const k = newScale / scale;
    tx = cx - k * (cx - tx);
    ty = cy - k * (cy - ty);
    scale = newScale;
    apply();
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
  };
  canvas.addEventListener("wheel", onWheel, { passive: false });

  let dragging = false;
  let dragX = 0;
  let dragY = 0;
  let dragTx = 0;
  let dragTy = 0;
  let dragId = -1;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    dragId = e.pointerId;
    canvas.setPointerCapture(dragId);
    canvas.classList.add("dragging");
    dragX = e.clientX;
    dragY = e.clientY;
    dragTx = tx;
    dragTy = ty;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    tx = dragTx + (e.clientX - dragX);
    ty = dragTy + (e.clientY - dragY);
    apply();
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove("dragging");
    if (dragId !== -1) {
      try {
        canvas.releasePointerCapture(dragId);
      } catch {
        /* pointer already released */
      }
    }
    dragId = -1;
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  const centerZoom = (factor: number) => {
    const r = canvas.getBoundingClientRect();
    zoomAt(factor, r.width / 2, r.height / 2);
  };
  zoomInBtn.addEventListener("click", () => centerZoom(1.25));
  zoomOutBtn.addEventListener("click", () => centerZoom(1 / 1.25));
  fitBtn.addEventListener("click", fit);

  const close = () => {
    canvas.removeEventListener("wheel", onWheel);
    document.removeEventListener("keydown", onKey);
    document.body.style.overflow = prevBodyOverflow;
    overlay.remove();
  };
  closeBtn.addEventListener("click", close);

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      close();
    } else if (e.key === "0") {
      fit();
    } else if (e.key === "+" || e.key === "=") {
      centerZoom(1.25);
    } else if (e.key === "-" || e.key === "_") {
      centerZoom(1 / 1.25);
    }
  }
  document.addEventListener("keydown", onKey);

  requestAnimationFrame(fit);
}

export default function KbProse({ html, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.log("[kb-prose] effect fired, html bytes:", html?.length ?? 0);
    const root = containerRef.current;
    if (!root) {
      console.log("[kb-prose] bailout: no containerRef");
      return;
    }

    const codeBlocks = Array.from(
      root.querySelectorAll<HTMLElement>("code.language-mermaid"),
    );
    console.log("[kb-prose] codeBlocks found:", codeBlocks.length);
    if (codeBlocks.length === 0) return;

    let cancelled = false;

    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "childList" && (m.addedNodes.length || m.removedNodes.length)) {
          console.log("[kb-prose] DOM mutation in kb-prose:", {
            target: (m.target as Element).tagName,
            added: m.addedNodes.length,
            removed: m.removedNodes.length,
            removedTags: Array.from(m.removedNodes).map((n) => (n as Element).tagName).join(","),
          });
        }
      }
    });
    obs.observe(root, { childList: true, subtree: true });

    (async () => {
      console.log("[kb-prose] loading mermaid…");
      const mermaid = await loadMermaid();
      console.log("[kb-prose] mermaid loaded, cancelled?", cancelled);
      if (cancelled) return;

      for (let i = 0; i < codeBlocks.length; i++) {
        const codeEl = codeBlocks[i];
        const pre = codeEl.parentElement;
        console.log("[kb-prose] iter", i, "parentTag:", pre?.tagName, "enhanced:", pre?.dataset.mermaidEnhanced);
        if (!pre || pre.tagName !== "PRE") continue;
        if (pre.dataset.mermaidEnhanced === "1") continue;

        const source = codeEl.textContent ?? "";
        const id = `mermaid-${Date.now()}-${i}`;
        console.log("[kb-prose] calling mermaid.render", { id, sourceBytes: source.length, hasNewlines: source.includes("\n") });

        let svg: string;
        try {
          const result = await mermaid.render(id, source);
          svg = result.svg;
          console.log("[kb-prose] render OK, svg bytes:", svg.length);
        } catch (err) {
          console.error("[kb-prose] render threw:", err);
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

        const expandBtn = document.createElement("button");
        expandBtn.type = "button";
        expandBtn.className = "mermaid-expand";
        expandBtn.textContent = "expand";
        expandBtn.title = "Open fullscreen (drag to pan, scroll to zoom)";
        figure.appendChild(expandBtn);

        const svgWrap = document.createElement("div");
        svgWrap.className = "mermaid-svg";
        svgWrap.innerHTML = svg;
        figure.appendChild(svgWrap);

        const renderedSvg = svgWrap.querySelector("svg");
        if (renderedSvg) fixSvgContrast(renderedSvg);

        expandBtn.addEventListener("click", () => {
          const svgEl = svgWrap.querySelector("svg");
          if (svgEl) openMermaidFullscreen(svgEl);
        });

        console.log("[kb-prose] replacing pre with figure, pre still in DOM?", document.contains(pre));
        pre.replaceWith(figure);
        console.log("[kb-prose] replace done, figure in DOM?", document.contains(figure));
      }
    })().catch((err) => {
      console.error("[kb-prose] mermaid enhancement failed:", err);
    });

    return () => {
      cancelled = true;
      obs.disconnect();
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
