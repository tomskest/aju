import Link from "next/link";

export const metadata = {
  title: "Acceptable Use — aju",
  description: "Acceptable Use Policy for the aju.sh hosted service.",
};

export default function AcceptableUsePage() {
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
          Acceptable Use Policy
        </h1>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
          last updated: 2026-04-17
        </p>

        <div className="mt-10 space-y-8 text-[14px] leading-7 text-[var(--color-ink)]/90">
          <section>
            <p>
              This policy applies to everyone who uses the aju.sh hosted
              service operated by TARK Technology OÜ. It complements our{" "}
              <Link
                href="/legal/terms"
                className="text-[var(--color-accent)] underline-offset-4 hover:underline"
              >
                Terms of Service
              </Link>
              . Breaking these rules may result in rate-limiting, suspension,
              or termination of your account.
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              Prohibited Content
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                content that is illegal in Estonia or in your jurisdiction;
              </li>
              <li>
                child sexual abuse material (CSAM) — we report CSAM to the
                appropriate authorities;
              </li>
              <li>
                hate speech, harassment, threats of violence, or content that
                incites real-world harm;
              </li>
              <li>
                malware, phishing kits, or content designed to compromise
                third-party systems;
              </li>
              <li>
                content that infringes another party&rsquo;s intellectual
                property, privacy, or publicity rights.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              Prohibited Activities
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                scraping or probing other tenants, data, or internal
                infrastructure;
              </li>
              <li>
                automated abuse of embedding quotas or bulk ingestion beyond
                fair-use limits;
              </li>
              <li>
                reverse-engineering, decompiling, or otherwise attempting to
                extract source code from non-public components of the Service
                without written permission;
              </li>
              <li>
                circumventing or attempting to circumvent authentication, rate
                limits, or tenant isolation;
              </li>
              <li>
                using the Service to generate, distribute, or coordinate spam.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              Rate Limits and Fair Use
            </h2>
            <p className="mt-2">
              We enforce rate limits on API requests, embedding generation, and
              storage to keep the Service reliable for everyone. Limits may
              change over time; we may temporarily reduce or suspend access if
              your usage threatens the stability of the Service or the
              experience of other tenants.
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              Enforcement
            </h2>
            <p className="mt-2">
              We may investigate suspected violations and take any action we
              consider appropriate, including warning you, removing content,
              rate-limiting, suspending access, or terminating your account.
              Where legally required, we will cooperate with law-enforcement
              authorities.
            </p>
          </section>

          <section>
            <h2 className="text-[16px] font-medium text-[var(--color-ink)]">
              Reporting Abuse
            </h2>
            <p className="mt-2">
              If you believe the Service is being used to violate this policy,
              please report it to{" "}
              <a
                href="mailto:abuse@aju.sh"
                className="font-mono text-[var(--color-accent)] underline-offset-4 hover:underline"
              >
                abuse@aju.sh
              </a>
              . Include enough detail for us to identify the account or
              content in question. For security vulnerabilities, please use{" "}
              <a
                href="mailto:security@aju.sh"
                className="font-mono text-[var(--color-accent)] underline-offset-4 hover:underline"
              >
                security@aju.sh
              </a>{" "}
              instead.
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
            href="/legal/privacy"
            className="hover:text-[var(--color-muted)]"
          >
            privacy
          </Link>
        </div>
      </div>
    </div>
  );
}
