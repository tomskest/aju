import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — aju",
  description: "Privacy Policy for the aju.sh hosted service.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-ink)]">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Link
          href="/"
          className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)] transition hover:text-[var(--color-ink)]"
        >
          ← aju.sh
        </Link>

        <h1 className="mt-8 text-[32px] font-light leading-tight tracking-[-0.02em]">
          Privacy Policy
        </h1>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
          last updated: 2026-04-22
        </p>

        <div className="mt-10 space-y-8 text-[14px] leading-7 text-[var(--color-ink)]/90">
          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              1. Data Controller
            </h2>
            <p className="mt-2">
              The data controller for the aju.sh hosted service is{" "}
              <span className="font-mono text-[var(--color-ink)]">
                TARK Technology OÜ
              </span>{" "}
              (registry code{" "}
              <span className="font-mono">16901627</span>), registered in Saku,
              Estonia. You can reach us at{" "}
              <a
                href="mailto:security@aju.sh"
                className="font-mono text-[var(--color-accent)] underline-offset-4 hover:underline"
              >
                security@aju.sh
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              2. Data We Collect
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>your email address (required for sign-in);</li>
              <li>authentication sessions and API key metadata;</li>
              <li>
                content you upload to your brains — documents, files,
                frontmatter, and links;
              </li>
              <li>
                vector embeddings generated from your content to power search;
              </li>
              <li>
                usage events (search counts, create counts, and similar
                telemetry) used for quota enforcement and product analytics;
              </li>
              <li>
                approximate IP address and user-agent string, kept for account
                security and abuse detection.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              3. Legal Basis for Processing
            </h2>
            <p className="mt-2">
              We process personal data on two legal bases under the GDPR:
              performance of the contract between you and us (Art. 6(1)(b)),
              and our legitimate interest in operating, securing, and improving
              the Service (Art. 6(1)(f)). Where we rely on legitimate interest,
              we balance it against your rights and freedoms.
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              4. Data Architecture and Tenant Isolation
            </h2>
            <p className="mt-2">
              Your content is isolated at the database level, not just at the
              query level. Specifically:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                A single{" "}
                <span className="font-mono">aju_control</span> database holds
                shared identity and billing-adjacent records: users,
                sessions, API keys, organization memberships, and the
                directory that maps each organization to its tenant database.
                This is the only database that contains cross-org metadata.
              </li>
              <li>
                Every organization gets its own dedicated Postgres database
                (named{" "}
                <span className="font-mono">org_&lt;id&gt;</span>) that
                contains all of that organization&rsquo;s brains, documents,
                wikilinks, file metadata, agents, per-brain access grants,
                and audit logs. No other organization&rsquo;s database is
                reachable from within a tenant database.
              </li>
              <li>
                Inside each tenant database we additionally apply Postgres
                Row-Level Security policies scoped to{" "}
                <span className="font-mono">brain_id</span>. This means even
                a user with several brains in the same organization sees only
                the brains they have been explicitly granted access to —
                search, listing, and graph queries all filter at the SQL
                layer, not downstream.
              </li>
              <li>
                Binary files you upload (PDFs, images, attachments) are
                stored in an S3-compatible object storage bucket on Railway
                under a per-organization key prefix. The database keeps
                only metadata and — where a file is text-extractable — a
                plain-text representation for search.
              </li>
              <li>
                Vector embeddings used for semantic search live in the same
                tenant database as the source document, using the{" "}
                <span className="font-mono">pgvector</span> extension. They
                do not leave your tenant DB.
              </li>
            </ul>
            <p className="mt-3">
              Enterprise customers can request a physically separate Neon
              project, a read-only direct Postgres connection string to their
              own tenant database, or both. Contact us at{" "}
              <a
                href="mailto:security@aju.sh"
                className="font-mono text-[var(--color-accent)] underline-offset-4 hover:underline"
              >
                security@aju.sh
              </a>{" "}
              to arrange it.
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              5. Where Your Data Lives
            </h2>
            <p className="mt-2">
              Primary data stores and regions:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <span className="font-mono text-[var(--color-ink)]">
                  Neon
                </span>{" "}
                (serverless Postgres) — hosts the{" "}
                <span className="font-mono">aju_control</span> database and
                every per-organization{" "}
                <span className="font-mono">org_&lt;id&gt;</span> tenant
                database. Region: AWS{" "}
                <span className="font-mono">eu-central-1</span> (Frankfurt).
              </li>
              <li>
                <span className="font-mono text-[var(--color-ink)]">
                  Railway
                </span>{" "}
                — runs the stateless application containers (the Next.js app
                at{" "}
                <span className="font-mono">aju.sh</span> and the MCP
                gateway at{" "}
                <span className="font-mono">mcp.aju.sh</span>) and hosts the
                S3-compatible object-storage bucket we use for binary
                uploads.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              6. Retention
            </h2>
            <p className="mt-2">
              We retain your account and content for as long as your account
              remains active. If you delete your account, we purge your
              content from the active tenant database within thirty (30) days
              — deleting a note, file, or brain is an immediate{" "}
              <span className="font-mono">DELETE</span> in Postgres and in
              the storage bucket,
              not a soft flag. Our Neon tenant databases use point-in-time
              recovery windows of seven (7) days for operational resilience;
              backups are not used to resurrect content after a user-initiated
              deletion other than to recover from a production incident.
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              7. Sub-processors
            </h2>
            <p className="mt-2">
              We rely on a small number of infrastructure providers to run the
              Service. Each one has a data-processing agreement with us and is
              bound to confidentiality and security obligations:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <span className="font-mono text-[var(--color-ink)]">
                  Neon, Inc.
                </span>{" "}
                — serverless Postgres. Hosts the control-plane and every
                per-organization tenant database described above.
              </li>
              <li>
                <span className="font-mono text-[var(--color-ink)]">
                  Railway Corp.
                </span>{" "}
                — stateless application hosting and an S3-compatible
                object-storage bucket for binary uploads.
              </li>
              <li>
                <span className="font-mono text-[var(--color-ink)]">
                  Cloudflare, Inc.
                </span>{" "}
                — DNS; bot protection (Turnstile); edge networking. Does not
                store customer content.
              </li>
              <li>
                <span className="font-mono text-[var(--color-ink)]">
                  Resend
                </span>{" "}
                — transactional email (magic links, device-code
                confirmations).
              </li>
              <li>
                <span className="font-mono text-[var(--color-ink)]">
                  Voyage AI
                </span>{" "}
                — embedding-model inference for vector search. We use the API
                with data-retention opt-out where available.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              8. Your Rights
            </h2>
            <p className="mt-2">
              Under the GDPR you have the right to:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                access the personal data we hold about you (Art. 15);
              </li>
              <li>
                request erasure of your personal data (Art. 17);
              </li>
              <li>
                receive a portable export of the content you uploaded (Art.
                20);
              </li>
              <li>
                object to processing based on our legitimate interest, or
                withdraw consent at any time where consent is the basis.
              </li>
            </ul>
            <p className="mt-3">
              To exercise any of these rights, email{" "}
              <a
                href="mailto:security@aju.sh"
                className="font-mono text-[var(--color-accent)] underline-offset-4 hover:underline"
              >
                security@aju.sh
              </a>{" "}
              from the address associated with your account. We will respond
              within thirty (30) days. You can also lodge a complaint with the
              Estonian Data Protection Inspectorate (Andmekaitse Inspektsioon)
              or your local supervisory authority.
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              9. Cookies
            </h2>
            <p className="mt-2">
              We use a single first-party cookie (<span className="font-mono">aju_session</span>)
              to keep you signed in. We do not use advertising, analytics, or
              cross-site tracking cookies.
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              10. International Transfers
            </h2>
            <p className="mt-2">
              Primary storage (Neon) and email delivery (Resend) are served
              from the European Economic Area. Some sub-processors
              (Voyage AI, Cloudflare) operate in the United States or rely
              on globally-distributed edge networks. Where personal data is
              transferred outside the European Economic Area, we rely on the
              European Commission&rsquo;s Standard Contractual Clauses and
              supplementary measures as required.
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              11. Changes to This Policy
            </h2>
            <p className="mt-2">
              We will post any update to this Policy on this page and, for
              material changes, notify account holders by email.
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              12. Contact
            </h2>
            <p className="mt-2">
              For privacy questions and data-subject requests, write to{" "}
              <a
                href="mailto:security@aju.sh"
                className="font-mono text-[var(--color-accent)] underline-offset-4 hover:underline"
              >
                security@aju.sh
              </a>
              .
            </p>
          </section>
        </div>

        <div className="mt-16 flex items-center gap-3 border-t border-white/5 pt-6 font-mono text-[11px] text-[var(--color-faint)]">
          <Link href="/" className="hover:text-[var(--color-muted)]">
            aju.sh
          </Link>
          <span>·</span>
          <Link href="/legal/terms" className="hover:text-[var(--color-muted)]">
            terms
          </Link>
          <span>·</span>
          <Link
            href="/legal/acceptable-use"
            className="hover:text-[var(--color-muted)]"
          >
            acceptable use
          </Link>
        </div>
      </div>
    </div>
  );
}
