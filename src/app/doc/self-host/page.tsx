import CodeBlock from "@/components/doc/CodeBlock";

const CLONE_CMD =
  "git clone https://github.com/tomskest/aju.git && cd aju";

const INSTALL_RUN = "npm install && npm run build && npm start";

const COMPOSE_CMD = "docker compose up -d && npm install && npm run dev";

const GEN_SECRET = "openssl rand -base64 32";

type EnvGroup = {
  name: string;
  vars: { name: string; note: string }[];
};

const ENV_GROUPS: EnvGroup[] = [
  {
    name: "Datastores",
    vars: [
      {
        name: "DATABASE_URL",
        note: "Postgres 15+ with the pgvector extension installed",
      },
    ],
  },
  {
    name: "Object storage (S3-compatible)",
    vars: [
      {
        name: "AWS_ENDPOINT_URL",
        note: "S3-compatible endpoint — R2, Minio, or AWS S3",
      },
      { name: "AWS_ACCESS_KEY_ID", note: "Bucket read/write credentials" },
      { name: "AWS_SECRET_ACCESS_KEY", note: "Bucket read/write credentials" },
      { name: "AWS_BUCKET", note: "Bucket name" },
      { name: "AWS_REGION", note: "Bucket region (e.g. auto, us-east-1)" },
    ],
  },
  {
    name: "AI provider",
    vars: [
      {
        name: "VOYAGE_API_KEY",
        note: "Used for embeddings (voyage-4-large, 1024-dim)",
      },
    ],
  },
  {
    name: "Email",
    vars: [
      { name: "RESEND_API_KEY", note: "Transactional email provider" },
      {
        name: "EMAIL_FROM",
        note: "Verified sender address (e.g. hello@your-domain)",
      },
    ],
  },
  {
    name: "Bot protection",
    vars: [
      {
        name: "TURNSTILE_SITE_KEY",
        note: "Cloudflare Turnstile site key — or omit to disable",
      },
      {
        name: "TURNSTILE_SECRET_KEY",
        note: "Cloudflare Turnstile secret",
      },
    ],
  },
  {
    name: "App",
    vars: [
      {
        name: "NEXT_PUBLIC_APP_URL",
        note: "Public URL of your deployment, e.g. https://aju.example.com",
      },
      {
        name: "BETTER_AUTH_SECRET",
        note: "One-time 32-byte secret for sessions — generate once and keep it",
      },
    ],
  },
];

export default function SelfHostPage() {
  return (
    <article className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
          Self-host
        </p>
        <h1 className="text-[32px] font-light leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)]">
          Run the whole stack yourself.
        </h1>
        <p className="text-[14.5px] leading-relaxed text-[var(--color-muted)]">
          aju is Apache 2.0. If the hosted service at aju.sh isn&rsquo;t a fit —
          air-gapped compliance, custom models, cost control — stand it up on
          your own infra. This is a quickstart, not a production runbook.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-medium text-[var(--color-ink)]">
          1. Clone the repo
        </h2>
        <CodeBlock code={CLONE_CMD} prompt />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-medium text-[var(--color-ink)]">
          2. Requirements
        </h2>
        <ul className="flex flex-col gap-2 text-[14px] leading-relaxed text-[var(--color-muted)]">
          <li className="flex gap-3">
            <span
              aria-hidden
              className="mt-[7px] size-[6px] shrink-0 rounded-full bg-[var(--color-accent)]"
            />
            <span>Postgres 15+ with the pgvector extension</span>
          </li>
          <li className="flex gap-3">
            <span
              aria-hidden
              className="mt-[7px] size-[6px] shrink-0 rounded-full bg-[var(--color-accent)]"
            />
            <span>
              An S3-compatible bucket — Cloudflare R2, Minio, or AWS S3
            </span>
          </li>
          <li className="flex gap-3">
            <span
              aria-hidden
              className="mt-[7px] size-[6px] shrink-0 rounded-full bg-[var(--color-accent)]"
            />
            <span>A Voyage AI API key (for embeddings)</span>
          </li>
          <li className="flex gap-3">
            <span
              aria-hidden
              className="mt-[7px] size-[6px] shrink-0 rounded-full bg-[var(--color-accent)]"
            />
            <span>A Resend API key (for transactional email)</span>
          </li>
          <li className="flex gap-3">
            <span
              aria-hidden
              className="mt-[7px] size-[6px] shrink-0 rounded-full bg-[var(--color-accent)]"
            />
            <span>
              A Cloudflare Turnstile site, or disable bot protection by leaving
              the keys unset
            </span>
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-medium text-[var(--color-ink)]">
          3. Environment variables
        </h2>
        <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">
          Copy{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            .env.example
          </code>{" "}
          to{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            .env
          </code>{" "}
          and fill in the following.
        </p>
        <div className="flex flex-col gap-5">
          {ENV_GROUPS.map((group) => (
            <div
              key={group.name}
              className="rounded-xl border border-white/5 bg-[var(--color-panel)]/50 p-4"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
                {group.name}
              </p>
              <ul className="mt-3 flex flex-col gap-2">
                {group.vars.map((v) => (
                  <li
                    key={v.name}
                    className="grid grid-cols-1 gap-1 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)] sm:gap-4"
                  >
                    <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
                      {v.name}
                    </code>
                    <span className="text-[13px] text-[var(--color-muted)]">
                      {v.note}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-[13px] text-[var(--color-muted)]">
          Generate the auth secret once and keep it stable:
        </p>
        <CodeBlock code={GEN_SECRET} prompt />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-medium text-[var(--color-ink)]">
          4. Install and run
        </h2>
        <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">
          The start command runs a Prisma{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            db push
          </code>{" "}
          on boot, which creates tables on a fresh database.
        </p>
        <CodeBlock code={INSTALL_RUN} prompt />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-medium text-[var(--color-ink)]">
          5. Or: dev with docker-compose
        </h2>
        <p className="text-[14px] leading-relaxed text-[var(--color-muted)]">
          The included{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            docker-compose.yml
          </code>{" "}
          brings up Postgres (with pgvector) for local development.
          Run the app with{" "}
          <code className="font-mono text-[12.5px] text-[var(--color-ink)]">
            npm run dev
          </code>{" "}
          against those services.
        </p>
        <CodeBlock code={COMPOSE_CMD} prompt />
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[var(--color-panel)]/40 p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
          6. What you own
        </p>
        <p className="text-[14px] leading-relaxed text-[var(--color-ink)]">
          You are responsible for operations, backups, email deliverability,
          and compliance with the laws that apply to your data. For a managed
          option with none of that, use the hosted service at{" "}
          <a
            href="https://aju.sh"
            className="underline-offset-4 hover:underline"
          >
            aju.sh
          </a>
          .
        </p>
      </section>
    </article>
  );
}
