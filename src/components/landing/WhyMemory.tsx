import { Eyebrow, H2, Section } from "./LandingPrimitives";

const POINTS = [
  {
    num: "01",
    title: "durable, not ephemeral",
    body: "things you tell the agent stay told. a note from march is still there in november, with the same shape.",
  },
  {
    num: "02",
    title: "shared across agents",
    body: "claude, cursor, a cron job, your own script — they all read and write the same brain over HTTP or MCP.",
  },
  {
    num: "03",
    title: "inspectable, exportable",
    body: "it's markdown and files. open them in your editor. grep them. git them. leave whenever.",
  },
  {
    num: "04",
    title: "scoped per tenant",
    body: "each org gets its own postgres database on neon. your memory, your api keys, your audit log — not a shared vector of everyone's stuff.",
  },
];

export default function WhyMemory() {
  return (
    <Section id="why">
      <Eyebrow>01 · positioning</Eyebrow>
      <H2>
        agents forget.
        <br />
        <em className="not-italic text-[var(--color-faint)]">
          aju is how they remember.
        </em>
      </H2>

      <div className="mt-14 grid grid-cols-1 gap-12 md:grid-cols-2 md:gap-12">
        <blockquote className="m-0 border-l-2 border-[var(--color-accent)] py-0.5 pl-5 text-[22px] font-light leading-[1.5] tracking-[-0.01em] text-[var(--color-ink)]">
          &quot;every conversation starts from zero. context windows grow,
          but a 200k window you refill every morning is not memory —
          it&apos;s a bigger scratch pad.&quot;
          <small className="mt-4 block font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
            — the why, in one line
          </small>
        </blockquote>

        <div className="flex flex-col">
          {POINTS.map((p, i) => (
            <div
              key={p.num}
              className={`grid grid-cols-[40px_1fr] items-baseline gap-5 border-t border-white/5 py-5 ${
                i === POINTS.length - 1 ? "border-b" : ""
              }`}
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-faint)]">
                {p.num}
              </div>
              <div>
                <h3 className="m-0 mb-1.5 text-[15px] font-medium leading-[1.4] text-[var(--color-ink)]">
                  {p.title}
                </h3>
                <p className="m-0 text-[13px] leading-[1.65] text-[var(--color-muted)]">
                  {p.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
