"use client";

import { useEffect, useState } from "react";

type Counts = {
  validated: number;
  unvalidated: number;
  stale: number;
  disqualified: number;
};

type ByProvenance = {
  human: number;
  agent: number;
  ingested: number;
};

type StatusResp = {
  brain: string;
  total: number;
  counts: Counts;
  byProvenance: ByProvenance;
};

/**
 * Breakdown bar shown above the doc list. Fetches once on mount; if a
 * `refreshKey` changes (parent passes the focused doc id), re-fetches so
 * the bar reflects validations made via the picker without a full reload.
 *
 * Bar segments are color-coded: green=validated, amber=stale, muted=
 * unvalidated, red=disqualified. Each segment width is proportional to
 * its share of the total. Hover surfaces an exact count + the provenance
 * breakdown.
 */
export default function ValidationBar({
  brainName,
  refreshKey,
}: {
  brainName: string;
  refreshKey?: string | number | null;
}) {
  const [data, setData] = useState<StatusResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(
          `/api/vault/validation/status?brain=${encodeURIComponent(brainName)}`,
        );
        if (!res.ok) {
          setError("status_unavailable");
          return;
        }
        const body = (await res.json()) as StatusResp;
        if (!cancelled) {
          setData(body);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("status_unavailable");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [brainName, refreshKey]);

  if (error || !data || data.total === 0) {
    // Silent on error: the bar is informational, not load-bearing.
    return null;
  }

  const segs: Array<{ key: keyof Counts; pct: number; bg: string }> = [
    { key: "validated", pct: pct(data.counts.validated, data.total), bg: "bg-emerald-500/70" },
    { key: "stale", pct: pct(data.counts.stale, data.total), bg: "bg-amber-500/70" },
    { key: "disqualified", pct: pct(data.counts.disqualified, data.total), bg: "bg-red-500/70" },
    { key: "unvalidated", pct: pct(data.counts.unvalidated, data.total), bg: "bg-white/10" },
  ];

  const tooltip = [
    `${data.counts.validated} validated`,
    `${data.counts.unvalidated} unvalidated`,
    `${data.counts.stale} stale`,
    `${data.counts.disqualified} disqualified`,
    "—",
    `human: ${data.byProvenance.human}`,
    `agent: ${data.byProvenance.agent}`,
    `ingested: ${data.byProvenance.ingested}`,
  ].join("\n");

  return (
    <div
      className="flex items-center gap-2 font-mono text-[10px] text-[var(--color-faint)]"
      title={tooltip}
    >
      <span className="uppercase tracking-[0.18em]">validation</span>
      <div className="flex h-1.5 w-48 overflow-hidden rounded-full border border-white/5">
        {segs.map((s) => (
          <div key={s.key} className={s.bg} style={{ width: `${s.pct}%` }} />
        ))}
      </div>
      <span className="text-[var(--color-muted)]">
        {data.counts.validated}/{data.total} validated
      </span>
    </div>
  );
}

function pct(n: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (n / total) * 100));
}
