"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { AnnotationKind, SelectionQuote } from "@/lib/vault/annotate";

/**
 * Fixed action bar that appears while text is selected in the rendered
 * doc, offering the annotation vocabulary (strike = stale, highlight =
 * important). A fixed bottom bar rather than a floating popover because
 * iOS shows its own selection callout at the selection, and the two
 * would fight for the same space.
 *
 * Tapping an existing annotation (<del>/<mark>) selects the whole span,
 * so removing one is tap → un-button. Buttons relabel to unstrike /
 * unhighlight when the selection already sits inside that marker.
 *
 * Only mounted when the reader can write and the prose view is showing;
 * the parent owns anchoring, saving, and failure feedback (`note`).
 */

type Props = {
  /** The rendered-prose container; selections outside it are ignored. */
  containerRef: RefObject<HTMLElement | null>;
  busy: boolean;
  /** Feedback from the last attempt (anchor failure, save error). */
  note: string | null;
  onAnnotate: (kind: AnnotationKind, quote: SelectionQuote) => void;
  onDismissNote: () => void;
};

type Selected = {
  quote: SelectionQuote;
  /** Selection sits inside an existing ~~strike~~ / ==highlight==. */
  inDel: boolean;
  inMark: boolean;
};

/** Visible text captured around the selection to disambiguate repeats. */
const CONTEXT_CHARS = 64;

function elementOf(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : node.parentElement;
}

function readSelection(container: HTMLElement | null): Selected | null {
  if (!container) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;

  // Diagram figures render SVG whose text doesn't exist in the source.
  for (const node of [range.startContainer, range.endContainer]) {
    if (elementOf(node)?.closest("figure.mermaid-figure")) return null;
  }

  const text = sel.toString();
  if (text.trim().length < 3 || text.length > 1000) return null;

  const before = document.createRange();
  before.selectNodeContents(container);
  before.setEnd(range.startContainer, range.startOffset);
  const after = document.createRange();
  after.selectNodeContents(container);
  after.setStart(range.endContainer, range.endOffset);

  const anchor = elementOf(range.commonAncestorContainer);
  return {
    quote: {
      text,
      before: before.toString().slice(-CONTEXT_CHARS),
      after: after.toString().slice(0, CONTEXT_CHARS),
    },
    inDel: Boolean(anchor?.closest("del")),
    inMark: Boolean(anchor?.closest("mark")),
  };
}

export default function AnnotationToolbar({
  containerRef,
  busy,
  note,
  onAnnotate,
  onDismissNote,
}: Props) {
  const [selected, setSelected] = useState<Selected | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    const update = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        setSelected(readSelection(containerRef.current));
      });
    };
    update();
    document.addEventListener("selectionchange", update);
    return () => {
      document.removeEventListener("selectionchange", update);
      cancelAnimationFrame(frame.current);
    };
  }, [containerRef]);

  // Tapping an existing annotation selects the whole span, so a single
  // tap on the un-button removes it — no manual text selection needed.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const container = containerRef.current;
      const target = e.target as Element | null;
      if (!container || !target || !container.contains(target)) return;
      // Links inside an annotation still navigate.
      if (target.closest("a")) return;
      const span = target.closest("del, mark");
      if (!span || !container.contains(span)) return;
      const sel = window.getSelection();
      if (!sel) return;
      const range = document.createRange();
      range.selectNodeContents(span);
      sel.removeAllRanges();
      sel.addRange(range);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [containerRef]);

  // A note sticks to the selection that produced it and clears as soon
  // as the user moves on to a different selection.
  const noteQuoteText = useRef<string | null>(null);
  useEffect(() => {
    if (note) noteQuoteText.current = selected?.quote.text ?? null;
    // Capture only when the note appears; selection is read, not depended on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note]);
  useEffect(() => {
    if (note && (selected?.quote.text ?? null) !== noteQuoteText.current) {
      onDismissNote();
    }
  }, [selected, note, onDismissNote]);

  if (!selected && !note) return null;

  const act = (kind: AnnotationKind) => {
    if (selected && !busy) onAnnotate(kind, selected.quote);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full items-center gap-2.5 rounded-xl border border-[var(--color-accent)]/35 bg-[var(--color-panel)] px-3 py-2.5 shadow-[0_16px_48px_rgba(0,0,0,0.65),0_0_28px_rgba(34,197,94,0.12)] animate-[annot-rise_0.16s_ease-out]">
        {selected && (
          <>
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)] shadow-[0_0_8px_rgba(34,197,94,0.7)] animate-[aju-pulse_1.8s_ease-in-out_infinite]"
            />
            {/* pointerdown + preventDefault so tapping the button doesn't
                collapse the selection before the action fires. */}
            <button
              type="button"
              disabled={busy}
              title={
                selected.inDel
                  ? "Remove the strike"
                  : "Mark as stale (~~strike~~)"
              }
              onPointerDown={(e) => {
                e.preventDefault();
                act("strike");
              }}
              className="rounded-md border border-white/15 px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink)] transition hover:border-red-400/50 hover:bg-red-400/10 disabled:opacity-40"
            >
              {selected.inDel ? (
                "unstrike"
              ) : (
                <span className="line-through decoration-red-400/70">
                  strike
                </span>
              )}
            </button>
            <button
              type="button"
              disabled={busy}
              title={
                selected.inMark
                  ? "Remove the highlight"
                  : "Flag as important (==highlight==)"
              }
              onPointerDown={(e) => {
                e.preventDefault();
                act("highlight");
              }}
              className="rounded-md border border-white/15 px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink)] transition hover:border-yellow-200/50 hover:bg-yellow-200/10 disabled:opacity-40"
            >
              {selected.inMark ? (
                "unhighlight"
              ) : (
                <span className="rounded-sm bg-yellow-200/20 px-1">
                  highlight
                </span>
              )}
            </button>
            <span className="hidden px-1 font-mono text-[10px] text-[var(--color-faint)] sm:inline">
              {busy ? "saving…" : "saves into the doc"}
            </span>
          </>
        )}
        {note && (
          <>
            <p className="px-1 font-mono text-[11px] text-amber-300">{note}</p>
            <button
              type="button"
              onClick={onDismissNote}
              aria-label="dismiss"
              className="font-mono text-[12px] text-[var(--color-faint)] transition hover:text-[var(--color-ink)]"
            >
              ×
            </button>
          </>
        )}
      </div>
    </div>
  );
}
