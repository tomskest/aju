import type { ReactNode } from "react";

/**
 * Small shared primitives used across every landing section — eyebrow,
 * section shell, and a mono-styled command snippet. Kept here to avoid
 * nineteen copies of the same Tailwind class string.
 */

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 inline-flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
      <span className="inline-block h-px w-4 bg-[var(--color-faint)]" />
      {children}
    </p>
  );
}

export function Section({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`relative z-[2] bg-transparent py-24 ${className}`}
    >
      <div className="mx-auto max-w-[1120px] px-8">{children}</div>
    </section>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return (
    <h2
      className="mt-5 text-[clamp(32px,4vw,48px)] font-light leading-[1.1] tracking-[-0.03em] text-[var(--color-ink)]"
      style={{ textShadow: "0 2px 20px rgba(5,6,8,0.9), 0 0 40px rgba(5,6,8,0.8)" }}
    >
      {children}
    </h2>
  );
}
