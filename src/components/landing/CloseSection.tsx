import Link from "next/link";
import InstallBlock from "./InstallBlock";

export default function CloseSection({
  grandfathered,
  cap,
}: {
  grandfathered: number;
  cap: number;
}) {
  return (
    <section className="relative z-[2] pb-24 pt-[120px] text-center">
      <div className="mx-auto max-w-[1120px] px-8">
        <h2
          className="m-0 mb-6 text-[clamp(96px,18vw,200px)] font-light leading-[0.9] tracking-[-0.05em] text-[var(--color-ink)]"
          style={{ textShadow: "0 2px 20px rgba(5,6,8,0.9), 0 0 40px rgba(5,6,8,0.8)" }}
        >
          aju
        </h2>
        <p className="m-0 mb-10 font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-muted)]">
          memory for AI agents
        </p>

        <div className="mx-auto max-w-[520px]">
          <InstallBlock />
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
            <span className="text-[var(--color-accent)]">
              {grandfathered} / {cap}
            </span>{" "}
            &nbsp;·&nbsp; beta cohort filling &nbsp;·&nbsp;{" "}
            <Link href="/kb" className="text-[var(--color-faint)] hover:text-[var(--color-muted)]">
              read the kb ↗
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
