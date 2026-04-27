type Command = {
  cmd: string;
  desc: string;
};

type Group = {
  id: string;
  name: string;
  summary: string;
  commands: Command[];
};

const GROUPS: Group[] = [
  {
    id: "auth",
    name: "auth",
    summary: "Sign in, sign out, inspect the current identity.",
    commands: [
      { cmd: "aju login", desc: "Begin device-code login flow; opens browser" },
      { cmd: "aju logout", desc: "Clear local credentials" },
      { cmd: "aju status", desc: "Show current identity + server" },
      { cmd: "aju whoami", desc: "Print your email" },
    ],
  },
  {
    id: "brains",
    name: "brains",
    summary: "Create, list, and switch between brains.",
    commands: [
      { cmd: "aju brains list", desc: "List brains you can access" },
      { cmd: "aju brains create <name>", desc: "Create a new brain" },
      { cmd: "aju brains delete <name>", desc: "Delete a brain" },
      {
        cmd: "aju brains switch <name>",
        desc: "Set default brain for this session",
      },
    ],
  },
  {
    id: "documents",
    name: "documents",
    summary: "Read, write, search, and organize markdown.",
    commands: [
      { cmd: "aju search <query>", desc: "Full-text search" },
      { cmd: "aju semantic <query>", desc: "Semantic (vector) search" },
      { cmd: "aju read <path>", desc: "Read a document" },
      { cmd: "aju browse <dir>", desc: "List documents in a directory" },
      { cmd: "aju create <path>", desc: "Create a document (reads stdin)" },
      { cmd: "aju update <path>", desc: "Update a document (reads stdin)" },
      { cmd: "aju delete <path>", desc: "Delete a document" },
    ],
  },
  {
    id: "graph",
    name: "graph",
    summary: "Explore links and recent changes in the brain.",
    commands: [
      { cmd: "aju backlinks <path>", desc: "Documents linking to <path>" },
      { cmd: "aju related <path>", desc: "Related documents" },
      { cmd: "aju graph", desc: "Vault stats" },
      { cmd: "aju rebuild-links", desc: "Re-index the link graph" },
      { cmd: "aju changes --since <ISO>", desc: "Recent mutations" },
    ],
  },
  {
    id: "files",
    name: "files",
    summary: "Upload and manage binary files (PDFs, images, etc.).",
    commands: [
      { cmd: "aju files list", desc: "List files" },
      { cmd: "aju files read <key>", desc: "Read a file" },
      { cmd: "aju files upload <path>", desc: "Upload a file" },
      { cmd: "aju files delete <key>", desc: "Delete a file" },
    ],
  },
  {
    id: "skill",
    name: "skill",
    summary: "Install and remove Claude Code skill files.",
    commands: [
      { cmd: "aju skill install claude", desc: "Install Claude Code skill files" },
      { cmd: "aju skill remove claude", desc: "Remove installed skill files" },
    ],
  },
  {
    id: "mcp",
    name: "mcp",
    summary: "Expose the brain as a stdio MCP server (advanced).",
    commands: [
      { cmd: "aju mcp serve", desc: "Start stdio MCP server (advanced)" },
    ],
  },
  {
    id: "system",
    name: "system",
    summary: "Maintenance, diagnostics, and version info.",
    commands: [
      { cmd: "aju self-update", desc: "Update the CLI binary from the release manifest" },
      { cmd: "aju news", desc: "Replay unseen announcements" },
      { cmd: "aju doctor", desc: "Diagnose config / auth issues" },
      { cmd: "aju version", desc: "Print CLI version" },
    ],
  },
];

export default function CliReferencePage() {
  return (
    <article className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
          CLI reference
        </p>
        <h1 className="text-[32px] font-light leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)]">
          Every command, grouped.
        </h1>
        <p className="text-[14.5px] leading-relaxed text-[var(--color-muted)]">
          Run <code className="font-mono text-[12.5px] text-[var(--color-ink)]">aju --help</code>{" "}
          at any time for the terminal version of this page.
        </p>
      </header>

      {/* Jump nav */}
      <nav className="flex flex-wrap gap-2 font-mono text-[11px]">
        {GROUPS.map((g) => (
          <a
            key={g.id}
            href={`#${g.id}`}
            className="rounded-md border border-white/5 px-2.5 py-1 text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
          >
            {g.name}
          </a>
        ))}
      </nav>

      {GROUPS.map((group) => (
        <section
          key={group.id}
          id={group.id}
          className="flex flex-col gap-4 scroll-mt-20"
        >
          <div className="flex flex-col gap-1">
            <h2 className="font-mono text-[16px] text-[var(--color-ink)]">
              {group.name}
            </h2>
            <p className="text-[13px] text-[var(--color-muted)]">
              {group.summary}
            </p>
          </div>
          <ul className="rounded-xl border border-white/5 bg-[var(--color-panel)]/50 divide-y divide-white/5">
            {group.commands.map((c) => (
              <li
                key={c.cmd}
                className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:gap-4"
              >
                <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
                  {c.cmd}
                </code>
                <span className="text-[13px] text-[var(--color-muted)]">
                  {c.desc}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}
