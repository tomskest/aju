import { describe, expect, it, vi, afterEach } from "vitest";
import {
  PLAN_LIMITS,
  UNLIMITED,
  isUnlimited,
  limitsFor,
  isPaidTier,
} from "./plan-limits";
import type { PlanTier } from "./plan-limits";
import { tierForPriceId, priceIdFor, BILLING_SUBJECT } from "./catalog";
import { applySubscription, subjectFrom } from "./subscription";

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * Ascending generosity. `bestTierForUser` picks by this ordering rather than
 * comparing limits field by field, which is only sound if the ordering is
 * actually monotonic — hence the test below.
 */
const ASCENDING: PlanTier[] = [
  "free",
  "beta_legacy",
  "pro",
  "team",
  "beta_founder",
];

describe("plan limits", () => {
  it("ranks tiers monotonically on every axis", () => {
    const axes = [
      "brains",
      "documentsPerBrain",
      "apiKeysMax",
      "searchesPerMonth",
      "embeddingTokensPerMonth",
      "storageBytesMax",
    ] as const;

    for (let i = 1; i < ASCENDING.length; i++) {
      const lower = PLAN_LIMITS[ASCENDING[i - 1]];
      const higher = PLAN_LIMITS[ASCENDING[i]];
      for (const axis of axes) {
        expect(
          higher[axis],
          `${ASCENDING[i]}.${axis} must be >= ${ASCENDING[i - 1]}.${axis}`,
        ).toBeGreaterThanOrEqual(lower[axis]);
      }
    }
  });

  it("falls back to free for unknown or missing tiers", () => {
    expect(limitsFor(undefined)).toBe(PLAN_LIMITS.free);
    expect(limitsFor(null)).toBe(PLAN_LIMITS.free);
    expect(limitsFor("enterprise_platinum")).toBe(PLAN_LIMITS.free);
    expect(limitsFor("pro")).toBe(PLAN_LIMITS.pro);
  });

  it("treats only the sentinel-sized caps as unlimited", () => {
    expect(isUnlimited(PLAN_LIMITS.team.brains)).toBe(true);
    expect(isUnlimited(PLAN_LIMITS.pro.brains)).toBe(false);
    expect(isUnlimited(PLAN_LIMITS.free.brains)).toBe(false);
  });

  it("keeps every tier's storage cap below the sentinel", () => {
    // The byte-denominated caps run into the hundreds of billions. A sentinel
    // below them once made every plan's storage and files tiles render as
    // unlimited on the usage page while enforcement still rejected uploads.
    for (const tier of ASCENDING) {
      expect(
        isUnlimited(PLAN_LIMITS[tier].storageBytesMax),
        `${tier}.storageBytesMax must read as a real cap`,
      ).toBe(false);
    }
  });

  it("keeps the sentinel JSON-safe and clear of derived display math", () => {
    // Serialised into API responses, so it has to survive JSON round-trips.
    expect(Number.isSafeInteger(UNLIMITED)).toBe(true);
    // The usage page multiplies documentsPerBrain by the org's brain count
    // before running it through isUnlimited; even an absurd brain count must
    // not push a finite per-brain cap across the sentinel.
    const largestPerBrain = Math.max(
      ...ASCENDING.map((t) => PLAN_LIMITS[t].documentsPerBrain),
    );
    expect(isUnlimited(largestPerBrain * 1_000_000)).toBe(false);
  });

  it("keeps the beta cohort strictly better off than free", () => {
    // The promise made to the beta cohort is that they never get worse than
    // they were. If free ever overtakes beta_legacy this silently breaks it.
    expect(PLAN_LIMITS.beta_legacy.brains).toBeGreaterThan(
      PLAN_LIMITS.free.brains,
    );
    expect(PLAN_LIMITS.beta_legacy.storageBytesMax).toBeGreaterThan(
      PLAN_LIMITS.free.storageBytesMax,
    );
  });

  it("identifies buyable tiers", () => {
    expect(isPaidTier("pro")).toBe(true);
    expect(isPaidTier("team")).toBe(true);
    expect(isPaidTier("beta_legacy")).toBe(false);
    expect(isPaidTier("free")).toBe(false);
  });
});

describe("catalog", () => {
  it("resolves a price id per tier and interval", () => {
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_pro_m");
    vi.stubEnv("STRIPE_PRICE_TEAM_YEARLY", "price_team_y");
    expect(priceIdFor("pro", "monthly")).toBe("price_pro_m");
    expect(priceIdFor("team", "yearly")).toBe("price_team_y");
  });

  it("throws rather than silently selling nothing when a price is unset", () => {
    vi.stubEnv("STRIPE_PRICE_PRO_YEARLY", "");
    expect(() => priceIdFor("pro", "yearly")).toThrow(
      /STRIPE_PRICE_PRO_YEARLY/,
    );
  });

  it("maps a price id back to the tier it grants", () => {
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_pro_m");
    vi.stubEnv("STRIPE_PRICE_PRO_YEARLY", "price_pro_y");
    vi.stubEnv("STRIPE_PRICE_TEAM_MONTHLY", "price_team_m");
    vi.stubEnv("STRIPE_PRICE_TEAM_YEARLY", "price_team_y");

    expect(tierForPriceId("price_pro_m")).toBe("pro");
    expect(tierForPriceId("price_pro_y")).toBe("pro");
    expect(tierForPriceId("price_team_m")).toBe("team");
    expect(tierForPriceId("price_team_y")).toBe("team");
  });

  it("returns null for an unmapped price so the caller can refuse to act", () => {
    // The webhook must NOT downgrade on an unrecognised price — far more
    // likely a Dashboard-created price we haven't wired up than a real signal.
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_pro_m");
    expect(tierForPriceId("price_created_in_dashboard")).toBeNull();
  });

  it("does not confuse an unset price env with a matching price id", () => {
    // Every price env unset means process.env lookups return undefined. An
    // implementation comparing loosely could match undefined against a
    // missing id and hand out the wrong tier.
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "");
    vi.stubEnv("STRIPE_PRICE_PRO_YEARLY", "");
    vi.stubEnv("STRIPE_PRICE_TEAM_MONTHLY", "");
    vi.stubEnv("STRIPE_PRICE_TEAM_YEARLY", "");
    expect(tierForPriceId("")).toBeNull();
  });

  it("bills Pro to the user and Team to the organization", () => {
    expect(BILLING_SUBJECT.pro).toBe("user");
    expect(BILLING_SUBJECT.team).toBe("organization");
  });
});

describe("subscription subject routing", () => {
  const sub = (metadata: Record<string, string>) =>
    ({ metadata }) as never;

  it("reads a well-formed subject", () => {
    expect(
      subjectFrom(
        sub({ aju_subject_type: "user", aju_subject_id: "usr_1" }),
      ),
    ).toEqual({ type: "user", id: "usr_1" });

    expect(
      subjectFrom(
        sub({ aju_subject_type: "organization", aju_subject_id: "org_1" }),
      ),
    ).toEqual({ type: "organization", id: "org_1" });
  });

  it("refuses a subject with an unknown type", () => {
    // Guards against a subscription created by hand in the Dashboard, where
    // a typo'd type would otherwise route an entitlement to the wrong table.
    expect(
      subjectFrom(sub({ aju_subject_type: "team", aju_subject_id: "x" })),
    ).toBeNull();
  });

  it("refuses a subject with no id", () => {
    expect(subjectFrom(sub({ aju_subject_type: "user" }))).toBeNull();
  });

  it("refuses a subscription with no metadata at all", () => {
    expect(subjectFrom({} as never)).toBeNull();
  });
});

describe("applySubscription", () => {
  type FakeSub = {
    id: string;
    status: string;
    priceId?: string;
    subject?: { type: string; id: string };
    quantity?: number;
  };

  /** Just enough Stripe.Subscription shape for applySubscription to read. */
  const fakeSub = (spec: FakeSub) =>
    ({
      id: spec.id,
      status: spec.status,
      cancel_at_period_end: false,
      metadata: spec.subject
        ? {
            aju_subject_type: spec.subject.type,
            aju_subject_id: spec.subject.id,
          }
        : {},
      items: {
        data: [
          {
            price: spec.priceId ? { id: spec.priceId } : undefined,
            current_period_end: 1_900_000_000,
            quantity: spec.quantity ?? 1,
          },
        ],
      },
    }) as never;

  /** In-memory stand-in for the control-plane client. */
  const fakeDb = (rows: {
    user?: {
      planTier: string;
      grandfatheredAt: Date | null;
      stripeSubscriptionId: string | null;
    } | null;
    org?: { planTier: string; stripeSubscriptionId: string | null } | null;
  }) => ({
    user: {
      findUnique: vi.fn(async () => rows.user ?? null),
      update: vi.fn(async () => ({})),
    },
    organization: {
      findUnique: vi.fn(async () => rows.org ?? null),
      update: vi.fn(async () => ({})),
    },
  });

  const proUser = (stored: string | null) => ({
    planTier: "pro",
    grandfatheredAt: null,
    stripeSubscriptionId: stored,
  });

  it("ignores a revoke for a subscription other than the one on record", async () => {
    // A late `deleted` for a replaced or duplicate subscription must not
    // strip the tier the surviving subscription still pays for.
    const db = fakeDb({ user: proUser("sub_current") });
    await applySubscription(
      fakeSub({
        id: "sub_stale",
        status: "canceled",
        subject: { type: "user", id: "usr_1" },
      }),
      db as never,
    );
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("ignores a revoke when no subscription id was ever recorded", async () => {
    const db = fakeDb({ user: proUser(null) });
    await applySubscription(
      fakeSub({
        id: "sub_stale",
        status: "canceled",
        subject: { type: "user", id: "usr_1" },
      }),
      db as never,
    );
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("applies a revoke from the subscription on record", async () => {
    const db = fakeDb({ user: proUser("sub_live") });
    await applySubscription(
      fakeSub({
        id: "sub_live",
        status: "canceled",
        subject: { type: "user", id: "usr_1" },
      }),
      db as never,
    );
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          planTier: "free",
          subscriptionStatus: "canceled",
        }),
      }),
    );
  });

  it("ignores an org revoke for a subscription not on record", async () => {
    const db = fakeDb({
      org: { planTier: "team", stripeSubscriptionId: "sub_current" },
    });
    await applySubscription(
      fakeSub({
        id: "sub_stale",
        status: "canceled",
        subject: { type: "organization", id: "org_1" },
      }),
      db as never,
    );
    expect(db.organization.update).not.toHaveBeenCalled();
  });

  it("grants regardless of which subscription id is stored", async () => {
    // Granting stays last-write-wins: a fresh subscription must be able to
    // take over from a replaced one without matching the stale stored id.
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_pro_m");
    const db = fakeDb({ user: proUser("sub_old") });
    await applySubscription(
      fakeSub({
        id: "sub_new",
        status: "active",
        priceId: "price_pro_m",
        subject: { type: "user", id: "usr_1" },
      }),
      db as never,
    );
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          planTier: "pro",
          stripeSubscriptionId: "sub_new",
        }),
      }),
    );
  });

  it("throws on a granting event whose price maps to no tier", async () => {
    // A throw makes the webhook 500 and roll back its idempotency marker, so
    // Stripe's retry window stays open for a STRIPE_PRICE_* env fix. Acking
    // would permanently discard a paid-for grant.
    const db = fakeDb({ user: proUser(null) });
    await expect(
      applySubscription(
        fakeSub({
          id: "sub_x",
          status: "active",
          priceId: "price_created_in_dashboard",
          subject: { type: "user", id: "usr_1" },
        }),
        db as never,
      ),
    ).rejects.toThrow(/unmapped price/);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("still swallows a subscription pointing at an unknown user", async () => {
    // A deleted user is a permanent miss: retrying can never succeed, so the
    // event is acknowledged rather than left to hammer the retry queue.
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_pro_m");
    const db = fakeDb({ user: null });
    await expect(
      applySubscription(
        fakeSub({
          id: "sub_x",
          status: "active",
          priceId: "price_pro_m",
          subject: { type: "user", id: "usr_ghost" },
        }),
        db as never,
      ),
    ).resolves.toBeUndefined();
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
