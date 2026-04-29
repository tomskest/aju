/**
 * Shared SQL fragments for the validation layer's retrieval changes.
 *
 * Three primitives, used by FTS / semantic / deep-search routes and the
 * matching MCP tools:
 *
 *   - buildValidationSqlFilter()    → AND-clause exclude/include predicates
 *   - buildValidationBoostExpr()    → CASE expression added to ranking score
 *   - isStaleByTime()               → result-time half-life flag (computed,
 *                                     not stored, so a half-life change
 *                                     takes effect on the next query)
 *
 * Every retrieval site MUST apply the same filter so the contract is
 * uniform: default mode excludes `disqualified`; `--facts` keeps only
 * `validated`; flags toggle stale / disqualified inclusion.
 */
import { Prisma } from "@prisma/client-tenant";

export type ValidationFilterOpts = {
  /** When true, return ONLY validated. Implies disqualified+unvalidated+stale excluded. */
  factsOnly?: boolean;
  /** When false (default), exclude `disqualified`. When true, include them. */
  includeDisqualified?: boolean;
  /** When false, exclude `stale`. Default true — stale rides along in default mode. */
  includeStale?: boolean;
  /** Restrict by provenance. Undefined = any provenance. */
  provenance?: "human" | "agent" | "ingested";
};

/**
 * Build the WHERE-clause fragment that excludes/includes rows by
 * validation_status and provenance. Returns Prisma.empty when no
 * predicates apply, so callers can splice it unconditionally:
 *
 *   WHERE foo = bar ${buildValidationSqlFilter(opts)}
 *
 * Note: `Prisma.empty` evaluates to no SQL; the leading AND in the
 * fragment is conditional. Callers should ensure there's at least one
 * preceding clause (every search query has the brain_id filter).
 */
export function buildValidationSqlFilter(
  opts: ValidationFilterOpts = {},
): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];

  if (opts.factsOnly) {
    clauses.push(Prisma.sql`validation_status = 'validated'`);
  } else {
    if (!opts.includeDisqualified) {
      clauses.push(Prisma.sql`validation_status <> 'disqualified'`);
    }
    if (opts.includeStale === false) {
      clauses.push(Prisma.sql`validation_status <> 'stale'`);
    }
  }

  if (opts.provenance) {
    clauses.push(Prisma.sql`provenance = ${opts.provenance}`);
  }

  if (clauses.length === 0) return Prisma.empty;
  return Prisma.sql` AND ${Prisma.join(clauses, " AND ")}`;
}

/** Default rank weights when no per-brain BrainSettings row applies. */
export const DEFAULT_RANK_WEIGHTS = {
  validated: 0.1,
  stale: -0.05,
  human: 0.05,
} as const;

export type RankWeights = {
  validated: number;
  stale: number;
  human: number;
};

/**
 * Boost expression added to the ranking score. Returns a SUM of two
 * conditional terms — one for status, one for provenance. Apply post-
 * normalization in RRF mode (the route helpers already normalize rrf_score
 * by maxRrf before adding the boost).
 *
 * For vector mode, apply the boost in an OUTER SELECT over the HNSW-
 * filtered candidate window. Adding a CASE expression to the inner ORDER
 * BY would defeat the index; the outer SELECT re-sorts the candidate set
 * (e.g. top 100) and the index still does its job for the inner scan.
 */
export function buildValidationBoostExpr(
  weights: RankWeights = DEFAULT_RANK_WEIGHTS,
): Prisma.Sql {
  return Prisma.sql`(
    CASE
      WHEN validation_status = 'validated' THEN ${weights.validated}
      WHEN validation_status = 'stale' THEN ${weights.stale}
      ELSE 0
    END
    + CASE WHEN provenance = 'human' THEN ${weights.human} ELSE 0 END
  )`;
}

/**
 * Compute whether a `validated` doc has crossed the brain's half-life.
 * Surfaces in the result `validation` block as `staleByTime: true` so the
 * LLM (via the skill prompt) can flag age when the user is making a
 * decision. Doesn't auto-demote — that would erase the explicit human
 * validation event.
 */
export function isStaleByTime(
  validatedAt: Date | string | null,
  halfLifeDays: number | null | undefined,
): boolean {
  if (!validatedAt) return false;
  const half = halfLifeDays ?? 180;
  if (half <= 0) return false;
  const ts =
    typeof validatedAt === "string"
      ? new Date(validatedAt).getTime()
      : validatedAt.getTime();
  if (Number.isNaN(ts)) return false;
  const ageMs = Date.now() - ts;
  return ageMs > half * 24 * 60 * 60 * 1000;
}

/**
 * Shape the per-result validation block returned to all consumers. The
 * skill prompt at `client/cli/cmd/skill_body.md` documents how Claude
 * should interpret each combination.
 */
export type ValidationBlock = {
  status: string;
  provenance: string;
  validatedAt: string | null;
  validatedBy: string | null;
  staleByTime?: boolean;
};

export function makeValidationBlock(row: {
  validation_status?: string | null;
  validationStatus?: string | null;
  provenance?: string | null;
  validated_at?: Date | null;
  validatedAt?: Date | null;
  validated_by?: string | null;
  validatedBy?: string | null;
}, halfLifeDays?: number): ValidationBlock {
  const status = row.validation_status ?? row.validationStatus ?? "unvalidated";
  const provenance = row.provenance ?? "human";
  const at = row.validated_at ?? row.validatedAt ?? null;
  const by = row.validated_by ?? row.validatedBy ?? null;
  return {
    status,
    provenance,
    validatedAt: at instanceof Date ? at.toISOString() : at,
    validatedBy: by,
    staleByTime: status === "validated"
      ? isStaleByTime(at, halfLifeDays)
      : false,
  };
}
