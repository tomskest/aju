import Link from "next/link";

export const metadata = {
  title: "Terms of Service — aju",
  description: "Terms of Service for the aju.sh hosted service.",
};

export default function TermsPage() {
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
          Terms of Service
        </h1>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
          last updated: 2026-04-22
        </p>

        <div className="mt-10 space-y-8 text-[14px] leading-7 text-[var(--color-ink)]/90">
          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              1. Operator
            </h2>
            <p className="mt-2">
              The aju.sh hosted service (the &ldquo;Service&rdquo;) is operated
              by{" "}
              <span className="font-mono text-[var(--color-ink)]">
                TARK Technology OÜ
              </span>
              , an Estonian private limited company (registry code{" "}
              <span className="font-mono">16901627</span>) with its registered
              office in Saku, Estonia. In these Terms, &ldquo;we,&rdquo;
              &ldquo;us,&rdquo; and &ldquo;our&rdquo; refer to TARK Technology
              OÜ.
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              2. The Service
            </h2>
            <p className="mt-2">
              aju.sh is memory infrastructure for AI agents. It lets you store,
              search, and expose structured knowledge via a CLI, an HTTP API,
              and the Model Context Protocol. The open-source client is
              licensed separately under Apache 2.0; these Terms govern your use
              of the hosted service only.
            </p>
            <p className="mt-2">
              Under the hood, each organization is provisioned a dedicated
              Postgres database on Neon for its brains, documents, wikilinks,
              file metadata, and audit logs. Binary file content lives in an
              S3-compatible object-storage bucket on Railway under a
              per-organization prefix. Shared identity records (users,
              sessions, API keys, org memberships) live in a separate
              control-plane database. This DB-per-tenant model is
              described in detail in our{" "}
              <Link
                href="/legal/privacy"
                className="text-[var(--color-accent)] underline-offset-4 hover:underline"
              >
                Privacy Policy
              </Link>
              ; it is the basis on which we commit that no query from one
              organization can reach another organization&rsquo;s data.
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              3. Eligibility
            </h2>
            <p className="mt-2">
              You must be at least 13 years old to use the Service (or the
              minimum age required in your jurisdiction, whichever is higher).
              By using the Service, you represent that you meet this
              requirement.
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              4. Beta Program
            </h2>
            <p className="mt-2">
              The closed beta runs through 30 June 2026. Users who sign up
              during the beta window (&ldquo;Beta Cohort&rdquo;) receive free
              access to the beta plan limits for the duration of that window.
              After 30 June 2026, the service may transition to a paid model,
              a reduced free tier, or another arrangement to be announced
              before that date. TARK Technology OÜ will communicate any such
              transition to Beta Cohort members by email at least fourteen
              (14) days in advance.
            </p>
            <p className="mt-2">
              Regardless of the transition outcome, your content remains your
              property. You may export all data you have uploaded or created
              on the service at any time, before or after the beta ends, via
              the documented export endpoint (
              <span className="font-mono text-[var(--color-ink)]">
                GET /api/me/export
              </span>
              ) or the{" "}
              <span className="font-mono text-[var(--color-ink)]">
                aju export
              </span>{" "}
              command.
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              5. Your Obligations
            </h2>
            <p className="mt-2">You agree not to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                upload, generate, or distribute content that is illegal or
                infringes the rights of others;
              </li>
              <li>
                scrape, probe, or reverse-engineer the Service or other
                tenants&rsquo; data;
              </li>
              <li>
                abuse embedding, rate, or storage quotas, or use the Service to
                generate automated spam;
              </li>
              <li>
                interfere with, or attempt to compromise, the integrity or
                security of the Service.
              </li>
            </ul>
            <p className="mt-3">
              See also our{" "}
              <Link
                href="/legal/acceptable-use"
                className="text-[var(--color-accent)] underline-offset-4 hover:underline"
              >
                Acceptable Use Policy
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              6. Content You Upload
            </h2>
            <p className="mt-2">
              You retain ownership of the documents, files, and other content
              you upload. You grant us a limited, non-exclusive license to
              store, process, and transmit that content solely as necessary to
              operate the Service on your behalf (including generating
              embeddings and serving search results through our APIs).
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              7. Data Security, Isolation, and Portability
            </h2>
            <p className="mt-2">
              We commit to the following in relation to content you upload:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                Each organization&rsquo;s vault data (documents, wikilinks,
                file metadata, embeddings, audit logs) is stored in its own
                dedicated Postgres database. We do not run a shared tenant
                schema, shared vector index, or cross-organization join
                surface.
              </li>
              <li>
                Binary files are stored in an S3-compatible object-storage
                bucket on Railway under a per-organization key prefix,
                separate from other organizations&rsquo; prefixes.
              </li>
              <li>
                Within each tenant database, per-brain access is enforced by
                Postgres Row-Level Security policies scoped to{" "}
                <span className="font-mono">brain_id</span>, not by
                application-layer filtering alone.
              </li>
              <li>
                You may export all of your data at any time via{" "}
                <span className="font-mono">GET /api/me/export</span> or the{" "}
                <span className="font-mono">aju export</span> command. The
                export is a self-contained JSON file (plus your uploaded
                binaries on request) with no lock-in.
              </li>
              <li>
                Enterprise customers may request a physically separate Neon
                project, a read-only direct Postgres connection string to
                their own tenant database, or both, subject to a separate
                agreement.
              </li>
            </ul>
            <p className="mt-2">
              See our{" "}
              <Link
                href="/legal/privacy"
                className="text-[var(--color-accent)] underline-offset-4 hover:underline"
              >
                Privacy Policy
              </Link>{" "}
              for the full architectural description and the list of
              sub-processors.
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              8. Termination
            </h2>
            <p className="mt-2">
              You may terminate your account at any time by deleting it through
              the dashboard or by contacting us. We may suspend or terminate
              your access if you materially breach these Terms or our
              Acceptable Use Policy, or if required by law. On termination, we
              will purge your content in accordance with our{" "}
              <Link
                href="/legal/privacy"
                className="text-[var(--color-accent)] underline-offset-4 hover:underline"
              >
                Privacy Policy
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              9. Disclaimers
            </h2>
            <p className="mt-2">
              The Service is provided &ldquo;as is&rdquo; and &ldquo;as
              available,&rdquo; without warranties of any kind, whether
              express, implied, or statutory, including warranties of
              merchantability, fitness for a particular purpose, and
              non-infringement. We do not warrant that the Service will be
              uninterrupted, error-free, or meet your specific requirements.
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              10. Limitation of Liability
            </h2>
            <p className="mt-2">
              To the maximum extent permitted by law, TARK Technology OÜ, its
              directors, employees, and agents will not be liable for any
              indirect, incidental, special, consequential, or punitive
              damages, or any loss of profits, revenue, data, or goodwill,
              arising out of or related to your use of the Service. Our
              aggregate liability for any claim arising out of these Terms is
              capped at the greater of (a) the amounts you paid us for the
              Service in the twelve (12) months preceding the claim, or (b)
              one hundred euros (€100).
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              11. Changes to These Terms
            </h2>
            <p className="mt-2">
              We may update these Terms from time to time. If we make material
              changes, we will notify account holders by email to the address
              on file. Continued use of the Service after the changes take
              effect constitutes acceptance of the updated Terms.
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              12. Governing Law
            </h2>
            <p className="mt-2">
              These Terms are governed by the laws of the Republic of Estonia,
              without regard to its conflict-of-laws rules. Any dispute
              arising out of these Terms will be resolved by the courts of
              Harju County, Estonia, unless mandatory consumer-protection law
              in your jurisdiction requires otherwise.
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              13. Contact
            </h2>
            <p className="mt-2">
              Questions about these Terms can be directed to{" "}
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
          <Link
            href="/legal/privacy"
            className="hover:text-[var(--color-muted)]"
          >
            privacy
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
