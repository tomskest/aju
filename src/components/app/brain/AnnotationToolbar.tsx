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

/** Visible text captured around the selection to disambiguate repeats. */
const CONTEXT_CHARS = 64;

function readSelection(container: HTMLElement | null): SelectionQuote | null {
  if (!container) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;

  // Diagram figures render SVG whose text doesn't exist in the source.
  for (const node of [range.startContainer, range.endContainer]) {
    const el =
      node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement;
    if (el?.closest("figure.mermaid-figure")) return null;
  }

  const text = sel.toString();
  if (text.trim().length < 3 || text.length > 1000) return null;

  const before = document.createRange();
  before.selectNodeContents(container);
  before.setEnd(range.startContainer, range.startOffset);
  const after = document.createRange();
  after.selectNodeContents(container);
  after.setStart(range.endContainer, range.endOffset);

  return {
    text,
    before: before.toString().slice(-CONTEXT_CHARS),
    after: after.toString().slice(0, CONTEXT_CHARS),
  };
}

export default function AnnotationToolbar({
  containerRef,
  busy,
  note,
  onAnnotate,
  onDismissNote,
}: Props) {
  const [quote, setQuote] = useState<SelectionQuote | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    const update = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        setQuote(readSelection(containerRef.current));
      });
    };
    update();
    document.addEventListener("selectionchange", update);
    return () => {
      document.removeEventListener("selectionchange", update);
      cancelAnimationFrame(frame.current);
    };
  }, [containerRef]);

  // A note sticks to the selection that produced it and clears as soon
  // as the user moves on to a different selection.
  const noteQuoteText = useRef<string | null>(null);
  useEffect(() => {
    if (note) noteQuoteText.current = quote?.text ?? null;
    // Capture only when the note appears; quote is read, not depended on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note]);
  useEffect(() => {
    if (note && (quote?.text ?? null) !== noteQuoteText.current) {
      onDismissNote();
    }
  }, [quote, note, onDismissNote]);

  if (!quote && !note) return null;

  const act = (kind: AnnotationKind) => {
    if (quote && !busy) onAnnotate(kind, quote);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-lg border border-white/10 bg-[var(--color-panel)] px-2.5 py-2 shadow-[0_12px_40px_rgba(0,0,0,0.55)]">
        {quote && (
          <>
            {/* pointerdown + preventDefault so tapping the button doesn't
                collapse the selection before the action fires. */}
            <button
              type="button"
              disabled={busy}
              title="Mark as stale (~~strike~~)"
              onPointerDown={(e) => {
                e.preventDefault();
                act("strike");
              }}
              className="rounded-md border border-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)] disabled:opacity-40"
            >
              <span className="line-through">strike</span>
            </button>
            <button
              type="button"
              disabled={busy}
              title="Flag as important (==highlight==)"
              onPointerDown={(e) => {
                e.preventDefault();
                act("highlight");
              }}
              className="rounded-md border border-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)] disabled:opacity-40"
            >
              <span className="rounded-sm bg-yellow-200/15 px-1">highlight</span>
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
