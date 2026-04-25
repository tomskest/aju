import CodeBlock from "@/components/doc/CodeBlock";

type Step = {
  n: number;
  title: string;
  body: React.ReactNode;
  command: string;
};

const STEPS: Step[] = [
  {
    n: 1,
    title: "Install the CLI",
    body: (
      <>
        One line, no dependencies beyond a POSIX shell. The installer writes a
        single binary to <code className="font-mono text-[12.5px] text-[var(--color-ink)]">~/.local/bin/aju</code>{" "}
        and adds it to your path if needed.
      </>
    ),
    command: "curl -fsSL install.aju.sh | sh",
  },
  {
    n: 2,
    title: "Log in",
    body: (
      <>
        Opens your browser, presents a short device code, and waits for you to
        approve it. On approval the CLI receives an API key and saves it to{" "}
        <code className="font-mono text-[12.5px] text-[var(--color-ink)]">~/.config/aju/credentials</code>{" "}
        with user-only read permissions.
      </>
    ),
    command: "aju login",
  },
  {
    n: 3,
    title: "Create a brain",
    body: (
      <>
        A brain is a container for documents. You can make as many as you
        want — a scratchpad, a journal, a project knowledge base. Or skip this
        step and use the default brain named{" "}
        <code className="font-mono text-[12.5px] text-[var(--color-ink)]">brain</code>.
      </>
    ),
    command: "aju brains create personal",
  },
  {
    n: 4,
    title: "Write a document",
    body: (
      <>
        Documents are markdown. Pipe content in on stdin. Paths are virtual:
        use folders to organize how you like.
      </>
    ),
    command:
      'echo "# Retro\\n\\nShipped the new search endpoint. Faster than expected." | aju create journal/2026-04-17.md',
  },
  {
    n: 5,
    title: "Search",
    body: (
      <>
        Full-text is instant; semantic search uses OpenAI embeddings and
        returns documents by meaning, not keywords. Both honor the default
        brain selected in the previous step.
      </>
    ),
    command: 'aju search "what did I learn last week"',
  },
];

export default function GettingStartedPage() {
  return (
    <article className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
          Getting started
        </p>
        <h1 className="text-[32px] font-light leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)]">
          From zero to a working brain in five commands.
        </h1>
        <p className="text-[14.5px] leading-relaxed text-[var(--color-muted)]">
          This walkthrough assumes macOS or Linux with a recent shell. Windows
          users can install via WSL or use the MCP server directly.
        </p>
      </header>

      <ol className="flex flex-col gap-8">
        {STEPS.map((step) => (
          <li
            key={step.n}
            className="flex flex-col gap-3 border-l border-white/5 pl-5"
          >
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-[11px] text-[var(--color-accent)]">
                0{step.n}
              </span>
              <h2 className="text-[18px] font-medium text-[var(--color-ink)]">
                {step.title}
              </h2>
            </div>
            <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">
              {step.body}
            </p>
            <div className="pt-1">
              <CodeBlock code={step.command} prompt />
            </div>
          </li>
        ))}
      </ol>

      <section className="rounded-xl border border-white/5 bg-[var(--color-panel)]/40 p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
          next
        </p>
        <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-ink)]">
          Explore the{" "}
          <a
            href="/doc/concepts"
            className="underline-offset-4 hover:underline"
          >
            concepts
          </a>
          , browse the full{" "}
          <a href="/doc/cli" className="underline-offset-4 hover:underline">
            CLI reference
          </a>
          , or plug aju into{" "}
          <a
            href="/doc/claude-code"
            className="underline-offset-4 hover:underline"
          >
            Claude Code
          </a>
          .
        </p>
      </section>
    </article>
  );
}
