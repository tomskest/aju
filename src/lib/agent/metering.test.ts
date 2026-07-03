import { describe, expect, it } from "vitest";
import { computeCostCents, monthStart } from "./metering";

describe("computeCostCents", () => {
  it("prices sonnet-5 at $3/$15 per MTok, rounded up to a cent", () => {
    // 100k in + 20k out → 0.30 + 0.30 = $0.60 → 60c
    expect(computeCostCents("claude-sonnet-5", 100_000, 20_000)).toBe(60);
  });

  it("rounds fractional cents up (never undercounts spend)", () => {
    // 1k in + 0 out on sonnet → $0.003 → 1c
    expect(computeCostCents("claude-sonnet-5", 1_000, 0)).toBe(1);
  });

  it("prices opus-4-8 at $5/$25 per MTok", () => {
    expect(computeCostCents("claude-opus-4-8", 1_000_000, 100_000)).toBe(500 + 250);
  });

  it("falls back to the default model's pricing for unknown models", () => {
    expect(computeCostCents("mystery-model", 100_000, 20_000)).toBe(
      computeCostCents("claude-sonnet-5", 100_000, 20_000),
    );
  });

  it("is zero for a refused run that never called the model", () => {
    expect(computeCostCents("claude-sonnet-5", 0, 0)).toBe(0);
  });
});

describe("monthStart", () => {
  it("returns the first of the month, UTC midnight", () => {
    const d = monthStart(new Date("2026-07-03T15:30:00Z"));
    expect(d.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });
});
