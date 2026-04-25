import Link from "next/link";

type Concept = {
  term: string;
  definition: React.ReactNode;
};

const CONCEPTS: Concept[] = [
  {
    term: "Brain",
    definition: (
      <>
        A container for documents. You can have many. Each brain has its own
        access control, API keys, and search index. Most humans start with
        one; agents often get their own for scoped access. See{" "}
        <Link
          href="/docs/cli#brains"
          className="underline-offset-4 hover:underline"
        >
          brain commands
        </Link>
        .
      </>
    ),
  },
  {
    term: "Document",
    definition: (
      <>
        A markdown file stored in a brain. Uploaded PDFs are extracted to text
        and stored as documents too. Documents have frontmatter, tags, and
        wikilinks. Paths are virtual strings like{" "}
        <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
          journal/2026-04-17.md
        </code>
        .
      </>
    ),
  },
  {
    term: "Wikilink",
    definition: (
      <>
        An inline reference of the form{" "}
        <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
          [[Like This]]
        </code>
        . Wikilinks automatically create graph edges between documents. Use{" "}
        <Link
          href="/docs/cli#graph"
          className="underline-offset-4 hover:underline"
        >
          backlinks
        </Link>{" "}
        to trace what references a document.
      </>
    ),
  },
  {
    term: "Embedding",
    definition: (
      <>
        A vector representation of document content used for semantic search.
        Generated on write. Default provider: OpenAI{" "}
        <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
          text-embedding-3-small
        </code>
        . If you self-host you can configure a different provider.
      </>
    ),
  },
  {
    term: "Agent",
    definition: (
      <>
        A non-human principal that can access one or more brains. Agents have
        their own scoped API keys — separate from human credentials — so you
        can give an agent access to a single brain without exposing your
        account.
      </>
    ),
  },
  {
    term: "API key",
    definition: (
      <>
        A credential used to call the aju API. Scoped to a user or an agent.
        Keys are prefixed{" "}
        <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
          aju_live_
        </code>{" "}
        or{" "}
        <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
          aju_test_
        </code>{" "}
        depending on the environment. Treat them like passwords — rotate on
        leak.
      </>
    ),
  },
  {
    term: "Organization",
    definition: (
      <>
        A team-level container for shared brains. Organizations arrive in a
        later phase; for now a brain is owned by a single user.
      </>
    ),
  },
];

export default function ConceptsPage() {
  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
          Concepts
        </p>
        <h1 className="text-[32px] font-light leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)]">
          The vocabulary.
        </h1>
        <p className="text-[14.5px] leading-relaxed text-[var(--color-muted)]">
          Seven terms that come up everywhere else in these docs.
        </p>
      </header>

      <dl className="flex flex-col">
        {CONCEPTS.map((c, i) => (
          <div
            key={c.term}
            className={`flex flex-col gap-2 py-5 ${
              i === 0 ? "" : "border-t border-white/5"
            }`}
          >
            <dt className="font-medium text-[15px] text-[var(--color-ink)]">
              {c.term}
            </dt>
            <dd className="text-[14px] leading-relaxed text-[var(--color-muted)]">
              {c.definition}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
