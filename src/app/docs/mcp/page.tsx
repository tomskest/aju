import CodeBlock from "@/components/docs/CodeBlock";

const REMOTE_CLAUDE_DESKTOP = `{
  "mcpServers": {
    "aju": {
      "url": "https://mcp.aju.sh/mcp",
      "headers": {
        "Authorization": "Bearer aju_live_<your key>"
      }
    }
  }
}`;

const REMOTE_CLAUDE_AI = `{
  "type": "url",
  "url": "https://mcp.aju.sh/mcp",
  "name": "aju",
  "authorization_token": "aju_live_<your key>"
}`;

const REMOTE_OPENCODE = `{
  "mcp": {
    "aju": {
      "url": "https://mcp.aju.sh/mcp",
      "headers": {
        "Authorization": "Bearer aju_live_<your key>"
      }
    }
  }
}`;

const REMOTE_CURSOR = `{
  "mcpServers": {
    "aju": {
      "url": "https://mcp.aju.sh/mcp",
      "headers": {
        "Authorization": "Bearer aju_live_<your key>"
      }
    }
  }
}`;

const STDIO_FALLBACK = `{
  "mcpServers": {
    "aju": {
      "command": "aju",
      "args": ["mcp", "serve"],
      "env": { "AJU_API_KEY": "aju_live_<your key>" }
    }
  }
}`;

export default function McpPage() {
  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
          MCP
        </p>
        <h1 className="text-[32px] font-light leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)]">
          Connect aju to any MCP client.
        </h1>
        <p className="text-[14.5px] leading-relaxed text-[var(--color-muted)]">
          aju exposes a remote MCP endpoint. Any MCP-capable host — Claude
          Desktop, Claude.ai, Cursor, OpenCode, and others — can connect
          directly using your API key. No local binary to run, no background
          process to babysit.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-medium text-[var(--color-ink)]">
          The endpoint
        </h2>
        <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">
          Point any MCP client at the URL below and authenticate with a
          bearer token minted via{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            aju keys create
          </code>
          {" "}(or the{" "}
          <a href="/app/keys" className="underline-offset-4 hover:underline">
            keys dashboard
          </a>
          ).
        </p>
        <CodeBlock code="https://mcp.aju.sh/mcp" />
        <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">
          Append{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            ?brain=&lt;name&gt;
          </code>{" "}
          to the URL if you want every tool call over that connection to
          default to a specific brain.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-medium text-[var(--color-ink)]">
          Multi-brain search
        </h2>
        <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            aju_search
          </code>{" "}
          and{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            aju_semantic_search
          </code>{" "}
          accept{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            brain
          </code>{" "}
          as a single string, an array, a comma-separated string
          (<code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            &quot;a,b&quot;
          </code>
          ), or the literal{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            &quot;all&quot;
          </code>{" "}
          to span every brain the caller can access. In hybrid mode, FTS and
          vector candidates from every requested brain are fused in one RRF
          pass, so ranks are comparable across brains — no client-side
          merging. Each result row includes{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            brain
          </code>{" "}
          so the agent knows where each hit came from.
        </p>
        <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">
          Mutating tools (
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            aju_create
          </code>
          ,{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            aju_update
          </code>
          ,{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            aju_delete
          </code>
          ) stay single-brain — a document always lives in exactly one brain.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-medium text-[var(--color-ink)]">
          Claude Desktop
        </h2>
        <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">
          Edit{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            ~/Library/Application Support/Claude/claude_desktop_config.json
          </code>{" "}
          (macOS) or{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            %APPDATA%\Claude\claude_desktop_config.json
          </code>{" "}
          (Windows). Restart Claude Desktop after saving.
        </p>
        <CodeBlock code={REMOTE_CLAUDE_DESKTOP} language="json" />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-medium text-[var(--color-ink)]">
          Claude.ai (web)
        </h2>
        <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">
          In Claude.ai, open <em>Settings → Integrations → Add custom
          integration</em> and paste the values below. Claude.ai speaks the
          same Streamable HTTP transport as the desktop app.
        </p>
        <CodeBlock code={REMOTE_CLAUDE_AI} language="json" />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-medium text-[var(--color-ink)]">
          Cursor
        </h2>
        <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">
          Cursor reads MCP servers from{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            ~/.cursor/mcp.json
          </code>
          . Newer versions also expose an in-app MCP panel — either works.
        </p>
        <CodeBlock code={REMOTE_CURSOR} language="json" />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-medium text-[var(--color-ink)]">
          OpenCode
        </h2>
        <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">
          Add to your OpenCode config (typically{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            ~/.config/opencode/config.json
          </code>
          {" "}— path varies by version).
        </p>
        <CodeBlock code={REMOTE_OPENCODE} language="json" />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-medium text-[var(--color-ink)]">
          Available tools
        </h2>
        <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">
          The server exposes a focused toolset. Each tool accepts an optional{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            brain
          </code>{" "}
          argument; omit it to use your default brain.
        </p>
        <ul className="flex flex-col gap-1.5 text-[14px] leading-relaxed text-[var(--color-muted)]">
          <li>
            <code className="font-mono text-[12.5px] text-[var(--color-ink)]">aju_search</code>{" "}
            — full-text search with snippets
          </li>
          <li>
            <code className="font-mono text-[12.5px] text-[var(--color-ink)]">aju_semantic_search</code>{" "}
            — vector + RRF hybrid search
          </li>
          <li>
            <code className="font-mono text-[12.5px] text-[var(--color-ink)]">aju_read</code>{" "}
            — read a document by path
          </li>
          <li>
            <code className="font-mono text-[12.5px] text-[var(--color-ink)]">aju_browse</code>{" "}
            — list documents in a directory
          </li>
          <li>
            <code className="font-mono text-[12.5px] text-[var(--color-ink)]">aju_create</code>{" "}
            / <code className="font-mono text-[12.5px] text-[var(--color-ink)]">aju_update</code>{" "}
            / <code className="font-mono text-[12.5px] text-[var(--color-ink)]">aju_delete</code>{" "}
            — mutate documents
          </li>
          <li>
            <code className="font-mono text-[12.5px] text-[var(--color-ink)]">aju_backlinks</code>{" "}
            / <code className="font-mono text-[12.5px] text-[var(--color-ink)]">aju_related</code>{" "}
            — link graph lookups
          </li>
          <li>
            <code className="font-mono text-[12.5px] text-[var(--color-ink)]">aju_brains_list</code>{" "}
            — list accessible brains
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-medium text-[var(--color-ink)]">
          Local stdio (optional)
        </h2>
        <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">
          Legacy clients that require a local command instead of a URL can
          still spawn the CLI as a bridge. The remote URL above is the
          recommended path — use this only if your client has no
          Streamable-HTTP support.
        </p>
        <CodeBlock code={STDIO_FALLBACK} language="json" />
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[var(--color-panel)]/40 p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
          Heads up
        </p>
        <p className="text-[14px] leading-relaxed text-[var(--color-ink)]">
          Client config shapes drift between versions. If a snippet above
          doesn&rsquo;t work, check your client&rsquo;s current docs and
          match the field names to theirs — the URL and bearer token stay
          the same.
        </p>
      </section>
    </article>
  );
}
