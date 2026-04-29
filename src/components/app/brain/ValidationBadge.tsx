"use client";

/**
 * Pure pill rendering for a doc's validation state. Reused as the visual
 * for the picker button in BrainExplorer and (eventually, in Phase 4) in
 * sidebar list rows. No interaction here — see ValidationPicker for click.
 */

export type ValidationStatus =
  | "unvalidated"
  | "validated"
  | "stale"
  | "disqualified";

export type Provenance = "human" | "agent" | "ingested";

export type ValidationState = {
  status: ValidationStatus;
  provenance: Provenance | string;
  validatedAt: string | null;
  validatedBy: string | null;
};

const STATUS_LABEL: Record<ValidationStatus, string> = {
  unvalidated: "unvalidated",
  validated: "validated",
  stale: "stale",
  disqualified: "disqualified",
};

const STATUS_GLYPH: Record<ValidationStatus, string> = {
  unvalidated: "○",
  validated: "✓",
  stale: "◐",
  disqualified: "✕",
};

// Color tokens kept inline (rather than CSS vars) so the pill renders
// recognizably even on pages that don't set the brain theme palette.
const STATUS_CLASSES: Record<ValidationStatus, string> = {
  unvalidated: "border-white/15 text-[var(--color-muted)]",
  validated: "border-emerald-500/40 text-emerald-300",
  stale: "border-amber-500/40 text-amber-300",
  disqualified: "border-red-500/40 text-red-300",
};

export function ValidationBadge({
  state,
  size = "sm",
  className = "",
}: {
  state: ValidationState;
  size?: "sm" | "xs";
  className?: string;
}) {
  const status = (state.status as ValidationStatus) ?? "unvalidated";
  const palette = STATUS_CLASSES[status] ?? STATUS_CLASSES.unvalidated;
  const padding = size === "xs" ? "px-2 py-0.5" : "px-3 py-1.5";
  const text = size === "xs" ? "text-[10px]" : "text-[10px]";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border ${padding} ${text} font-mono uppercase tracking-[0.18em] ${palette} ${className}`}
      title={describe(state)}
    >
      <span aria-hidden className="text-[12px] leading-none">
        {STATUS_GLYPH[status]}
      </span>
      <span>{STATUS_LABEL[status]}</span>
      {state.provenance && state.provenance !== "human" && (
        <span className="ml-1 rounded border border-white/10 px-1 text-[9px] tracking-[0.12em] opacity-70">
          {state.provenance}
        </span>
      )}
    </span>
  );
}

function describe(state: ValidationState): string {
  const parts: string[] = [];
  parts.push(`Status: ${state.status}`);
  parts.push(`Provenance: ${state.provenance}`);
  if (state.validatedAt) {
    parts.push(
      `Validated ${new Date(state.validatedAt).toLocaleDateString()}` +
        (state.validatedBy ? ` by ${state.validatedBy}` : ""),
    );
  }
  return parts.join(" · ");
}
