import { z } from "zod";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalize an email for storage. Returns `null` for non-strings or anything
 * that doesn't look like an email after trimming. Lowercases the whole address
 * (including the local part) so equality comparisons are case-insensitive
 * everywhere downstream.
 *
 * Use this at every entrypoint that accepts an email — signup, magic-link
 * verify, invitations, access requests, member add. Storing case-divergent
 * forms of the same address has bitten us in invitation-accept flows where
 * the comparison is sometimes case-sensitive and sometimes not.
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmed)) return null;
  return trimmed;
}

/** zod schema for an already-normalized email. Pair with `normalizeEmail`. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(EMAIL_RE, "invalid_email");
