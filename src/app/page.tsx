import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import AgentsSection from "@/components/landing/AgentsSection";
import CloseSection from "@/components/landing/CloseSection";
import HeroTerminal from "@/components/landing/HeroTerminal";
import HomeNav from "@/components/landing/HomeNav";
import InstallWalk from "@/components/landing/InstallWalk";
import LoginDropdown from "@/components/landing/LoginDropdown";
import McpSection from "@/components/landing/McpSection";
import MentalModel from "@/components/landing/MentalModel";
import SdksSection from "@/components/landing/SdksSection";
import SignupForm from "@/components/landing/SignupForm";
import SiteFooter from "@/components/landing/SiteFooter";
import UseCases from "@/components/landing/UseCases";
import WhyMemory from "@/components/landing/WhyMemory";
import WikilinkRain from "@/components/landing/WikilinkRain";

export const dynamic = "force-dynamic";

const COHORT_CAP = 100;

async function getStats() {
  try {
    const grandfathered = await prisma.user.count({
      where: { grandfatheredAt: { not: null } },
    });
    return { grandfathered, cap: COHORT_CAP };
  } catch {
    // If the DB isn't reachable, render the landing with a zero counter rather
    // than crashing. Users can still see the page.
    return { grandfathered: 0, cap: COHORT_CAP };
  }
}

/**
 * Accepts either a same-origin path (starting with `/`) or a full HTTPS URL
 * whose host ends in `.aju.sh` (e.g. `https://mcp.aju.sh/authorize?...`).
 * External hosts are rejected so a malicious `?return_to=...` can't turn
 * the landing page into an open redirect.
 */
function safeReturnTo(raw: string | undefined): string | undefined {
  if (!raw) return undefined;

  if (raw.startsWith("/")) {
    if (raw.startsWith("//")) return undefined;
    if (raw.startsWith("/\\")) return undefined;
    if (/^\/[a-z][a-z0-9+.-]*:/i.test(raw)) return undefined;
    return raw;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return undefined;
    const host = parsed.hostname.toLowerCase();
    if (host === "aju.sh" || host.endsWith(".aju.sh")) {
      return parsed.toString();
    }
  } catch {
    // fall through
  }
  return undefined;
}

const EMAIL_PREFILL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeEmailPrefill(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (raw.length > 254) return undefined;
  if (!EMAIL_PREFILL_RE.test(raw)) return undefined;
  return raw;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string; email?: string }>;
}) {
  const [{ grandfathered, cap }, signedInUser] = await Promise.all([
    getStats(),
    currentUser().catch(() => null),
  ]);
  const cohortOpen = grandfathered < cap;
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  const params = await searchParams;
  const returnTo = safeReturnTo(params.return_to);
  const initialEmail = safeEmailPrefill(params.email);

  // If the user is already signed in and arrived here because something else
  // bounced them through aju.sh to complete auth (e.g. mcp.aju.sh's OAuth
  // flow), skip the landing page entirely and send them onward.
  if (signedInUser && returnTo) {
    redirect(returnTo);
  }

  const navRight = signedInUser ? (
    <Link
      href="/app"
      className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-[var(--color-panel)]/85 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-ink)] backdrop-blur-sm transition hover:border-[var(--color-accent)]/40 hover:text-[var(--color-accent)]"
    >
      <span>console</span>
      <span aria-hidden>→</span>
    </Link>
  ) : (
    <LoginDropdown siteKey={siteKey} returnTo={returnTo} />
  );

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[var(--color-bg)] text-[var(--color-ink)]">
      {/* Fixed site-wide ambient rain behind everything */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <WikilinkRain variant="ambient" seed={3} />
      </div>

      <HomeNav rightSlot={navRight} />

      {/* HERO */}
      <section className="relative z-[2] overflow-hidden pb-16 pt-10 md:pb-20 md:pt-14">
        {/* Knock down the site-wide ambient rain under the hero so the
            hero's own rain layer reads cleanly. Without this, two rain
            layers stack and the headline becomes unreadable. */}
        <div
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{ background: "rgba(5,6,8,0.75)" }}
        />
        <div className="pointer-events-none absolute inset-0 z-[1]">
          <WikilinkRain variant="hero" />
        </div>

        <div className="relative z-[2] mx-auto max-w-[1120px] px-8">
          <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-[1.1fr_0.9fr] md:gap-14">
            <div>
              <p className="m-0 inline-flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-faint)]">
                <span className="inline-block h-px w-4 bg-[var(--color-faint)]" />
                memory infrastructure · open source
              </p>

              <h1
                className="m-0 mt-4 text-[clamp(40px,6.2vw,72px)] font-light leading-[1.02] tracking-[-0.035em] text-[var(--color-ink)]"
                style={{
                  textShadow:
                    "0 2px 20px rgba(5,6,8,0.95), 0 0 40px rgba(5,6,8,0.9)",
                }}
              >
                memory{" "}
                <span className="text-[var(--color-accent)]">for</span>{" "}
                agents.{" "}
                <em className="not-italic text-[var(--color-faint)]">
                  not chat history.
                </em>
              </h1>

              <p
                className="m-0 mt-5 max-w-[540px] text-[17px] font-light leading-[1.55] text-[var(--color-muted)]"
                style={{
                  textShadow:
                    "0 2px 20px rgba(5,6,8,0.95), 0 0 40px rgba(5,6,8,0.9)",
                }}
              >
                an open, CLI-first memory store for AI agents. markdown +
                files + a wikilink graph + vector search — scoped per-tenant,
                queryable over HTTP and MCP.
              </p>

              <div className="mt-6 max-w-[460px]">
                {cohortOpen ? (
                  <SignupForm
                    siteKey={siteKey}
                    returnTo={returnTo}
                    initialEmail={initialEmail}
                  />
                ) : (
                  <div className="w-full rounded-xl border border-white/10 bg-[var(--color-panel)]/85 px-4 py-4 text-center">
                    <p className="m-0 text-[13px] text-[var(--color-ink)]">
                      beta cohort is full. paid signups coming next.
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
                <Link
                  href="#model"
                  className="text-[var(--color-muted)] transition hover:text-[var(--color-ink)]"
                >
                  how it works ↓
                </Link>
                <span className="text-[var(--color-faint)]">·</span>
                <Link
                  href="#install"
                  className="text-[var(--color-muted)] transition hover:text-[var(--color-ink)]"
                >
                  install →
                </Link>
                <span className="text-[var(--color-faint)]">·</span>
                <span>
                  <span className="text-[var(--color-accent)]">
                    {grandfathered}/{cap}
                  </span>{" "}
                  ajus · {Math.max(0, cap - grandfathered)} left
                </span>
              </div>
            </div>

            <div>
              <HeroTerminal />
            </div>
          </div>
        </div>
      </section>

      <WhyMemory />

      {/* MENTAL MODEL */}
      <section
        id="model"
        className="relative z-[2] bg-transparent py-24"
      >
        <div className="mx-auto max-w-[1120px] px-8">
          <MentalModel />
        </div>
      </section>

      {/* INSTALL WALK */}
      <section
        id="install"
        className="relative z-[2] bg-transparent py-24"
      >
        <div className="mx-auto max-w-[1120px] px-8">
          <InstallWalk />
        </div>
      </section>

      <McpSection />
      <SdksSection />
      <AgentsSection />
      <UseCases />
      <CloseSection grandfathered={grandfathered} cap={cap} />
      <SiteFooter />
    </div>
  );
}
