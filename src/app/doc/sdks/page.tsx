import Link from "next/link";

type Sdk = {
  id: "typescript" | "python" | "go";
  label: string;
  install: string;
  quickstart: string;
  packageHref: string;
  packageLabel: string;
};

const SDKS: Sdk[] = [
  {
    id: "typescript",
    label: "TypeScript",
    install: "npm install @aju/sdk",
    quickstart: `import { createAjuClient, api } from "@aju/sdk";

const client = createAjuClient({ apiKey: process.env.AJU_API_KEY! });

const { data } = await api.searchVault({
  client,
  query: { q: "weekly notes", brain: "Personal", limit: 10 },
});

console.log(data?.results);`,
    packageHref:
      "https://github.com/tomskest/aju/tree/main/client/openapi/ts",
    packageLabel: "client/openapi/ts",
  },
  {
    id: "python",
    label: "Python",
    install: "pip install aju",
    quickstart: `from aju import AjuClient
from aju._generated.api.vault import search_vault

client = AjuClient(api_key="aju_live_...")
resp = search_vault.sync(
    client=client,
    q="weekly notes",
    brain="Personal",
    limit=10,
)

for hit in resp.results:
    print(hit.path, hit.rank)`,
    packageHref: "https://github.com/tomskest/aju/tree/main/client/openapi/py",
    packageLabel: "client/openapi/py",
  },
  {
    id: "go",
    label: "Go",
    install: "go get github.com/tomskest/aju/client/openapi/go/ajuclient",
    quickstart: `import "github.com/tomskest/aju/client/openapi/go/ajuclient"

c, _ := ajuclient.New("aju_live_...")

brain := "Personal"
limit := 10
resp, _ := c.SearchVault(ctx, &ajuclient.SearchVaultParams{
    Q:     "weekly notes",
    Brain: &brain,
    Limit: &limit,
})`,
    packageHref: "https://github.com/tomskest/aju/tree/main/client/openapi/go",
    packageLabel: "client/openapi/go",
  },
];

export default function SdksPage() {
  return (
    <article className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
          SDKs
        </p>
        <h1 className="text-[32px] font-light leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)]">
          Typed clients in three languages.
        </h1>
        <p className="text-[14.5px] leading-relaxed text-[var(--color-muted)]">
          TypeScript, Python, and Go — all generated from a single OpenAPI
          spec so every language stays in lockstep with the API. Add a new
          endpoint, regenerate, and the typed clients update together.
        </p>
      </header>

      <section className="flex flex-col gap-3 rounded-xl border border-white/5 bg-[var(--color-panel)]/50 px-5 py-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
          How it works
        </p>
        <ol className="flex flex-col gap-2 font-mono text-[12.5px] leading-[1.7] text-[var(--color-muted)]">
          <li>
            <span className="text-[var(--color-faint)]">01 </span>
            the API surface lives in{" "}
            <a
              href="https://github.com/tomskest/aju/blob/main/client/openapi/openapi.yaml"
              className="text-[var(--color-accent)] underline-offset-4 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              client/openapi/openapi.yaml
            </a>
          </li>
          <li>
            <span className="text-[var(--color-faint)]">02 </span>
            one script regenerates TS, Python, and Go clients from that spec
          </li>
          <li>
            <span className="text-[var(--color-faint)]">03 </span>
            spec change + regenerated code ship together — no drift between
            languages
          </li>
        </ol>
      </section>

      {/* Jump nav */}
      <nav className="flex flex-wrap gap-2 font-mono text-[11px]">
        {SDKS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded-md border border-white/5 px-2.5 py-1 text-[var(--color-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)]"
          >
            {s.label}
          </a>
        ))}
      </nav>

      {SDKS.map((sdk) => (
        <section
          key={sdk.id}
          id={sdk.id}
          className="flex flex-col gap-4 scroll-mt-20"
        >
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-mono text-[16px] text-[var(--color-ink)]">
              {sdk.label}
            </h2>
            <a
              href={sdk.packageHref}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[11px] text-[var(--color-muted)] transition hover:text-[var(--color-ink)]"
            >
              {sdk.packageLabel} →
            </a>
          </div>

          <div className="flex flex-col gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
              Install
            </p>
            <pre className="m-0 overflow-x-auto rounded-md border border-white/5 bg-[var(--color-panel)]/50 px-4 py-3 font-mono text-[12.5px] text-[var(--color-ink)]">
              {sdk.install}
            </pre>
          </div>

          <div className="flex flex-col gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
              Quickstart
            </p>
            <pre className="m-0 overflow-x-auto whitespace-pre rounded-md border border-white/5 bg-[var(--color-panel)]/50 px-4 py-3 font-mono text-[12.5px] leading-[1.7] text-[var(--color-ink)]">
              {sdk.quickstart}
            </pre>
          </div>
        </section>
      ))}

      <section className="flex flex-col gap-3 border-t border-white/5 pt-10">
        <h2 className="font-mono text-[16px] text-[var(--color-ink)]">
          What the SDKs wrap
        </h2>
        <p className="text-[13.5px] leading-relaxed text-[var(--color-muted)]">
          All three SDKs cover the same surface: vault documents (search,
          semantic-search, deep-search, browse, read, create, update,
          delete), the wikilink graph (related, backlinks, graph, changes),
          index operations (reindex, rebuild-links), binary files
          (list, read, presign/confirm upload, delete), and brain listing.
        </p>
        <p className="text-[13.5px] leading-relaxed text-[var(--color-muted)]">
          Authentication is a bearer API key — mint one at{" "}
          <Link
            href="/app/keys"
            className="text-[var(--color-accent)] underline-offset-4 hover:underline"
          >
            /app/keys
          </Link>{" "}
          or via <code className="font-mono text-[12.5px] text-[var(--color-ink)]">aju keys create</code>.
        </p>
        <p className="text-[13.5px] leading-relaxed text-[var(--color-muted)]">
          Prefer a spec-driven workflow in a language we don&rsquo;t yet
          ship? Point any OpenAPI generator at{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            client/openapi/openapi.yaml
          </code>{" "}
          — the spec is the contract.
        </p>
      </section>
    </article>
  );
}
