type Props = {
  grandfathered: number;
  cap: number;
};

export default function GrandfatherCounter({ grandfathered, cap }: Props) {
  const pct = Math.max(0, Math.min(100, (grandfathered / cap) * 100));
  const remaining = Math.max(0, cap - grandfathered);

  return (
    <div className="w-full max-w-[440px] flex flex-col items-center gap-3">
      <div className="flex items-center gap-3 font-mono text-[11px] tracking-[0.14em] uppercase">
        <span className="relative flex items-center">
          <span className="aju-pulse absolute inline-block size-[7px] rounded-full bg-[var(--color-accent)]" />
          <span className="inline-block size-[7px] rounded-full bg-[var(--color-accent)] opacity-40" />
        </span>
        <span className="text-[var(--color-accent)]">open beta</span>
        <span className="text-[var(--color-faint)]">·</span>
        <span className="text-[var(--color-ink)]">
          {grandfathered} / {cap} ajus
        </span>
        <span className="text-[var(--color-faint)]">·</span>
        <span className="text-[var(--color-muted)]">{remaining} left</span>
      </div>

      <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-white/5">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-accent)] shadow-[0_0_14px_rgba(34,197,94,0.6)] transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
