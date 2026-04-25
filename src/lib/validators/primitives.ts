import { z } from "zod";

/**
 * Shared zod primitives — reused across request schemas so input rules
 * (length caps, character classes, role enums) live in one place. Extending
 * a primitive here propagates to every schema using it.
 */

// CUID2-shaped ids used by Prisma for Brain, Document, etc.
export const cuidSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+$/, "invalid_id");

// Slugs (orgs, brains-by-name in URLs). Lowercase ASCII + dashes.
export const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "invalid_slug");

// Org role — kept in sync with `ORG_ROLES` in lib/tenant/types.ts.
export const orgRoleSchema = z.enum(["owner", "admin", "member"]);

// API key scopes.
export const apiKeyScopeSchema = z.enum(["read", "write", "admin"]);

// Human-readable name (org, brain, agent, key, etc.). Trimmed; bounded.
export const nameSchema = z.string().trim().min(1).max(120);

// Multi-line description / message — used for invites, access requests,
// agent descriptions. Bounded to keep DB rows reasonable.
export const messageSchema = z.string().trim().max(2000);

// Document path inside a vault — relative, no traversal. Mirrors the
// vault_documents.path constraint.
export const vaultPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => !p.includes(".."), "path_traversal")
  .refine((p) => !p.startsWith("/"), "absolute_path");

// "source" tag stamped on every vault changelog entry — small fixed set.
// Open enum (refine) rather than z.enum so adding a new client doesn't
// require a code change in the schema, but typos are still caught.
export const vaultSourceSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9_-]+$/, "invalid_source");

// DNS-shaped domain name — used by org domain claims. Lowercased + trimmed
// before validation. Max 253 chars per RFC 1035; min 3 catches obvious junk.
export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(253)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/, "invalid_domain");

// Document body — capped to keep DB rows + embedding payloads bounded.
// The cap is generous (500K chars ≈ 100K tokens for a chunked doc); large
// inputs should split into multiple documents.
export const documentContentSchema = z.string().max(500_000);
