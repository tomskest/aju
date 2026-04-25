/**
 * Shared type helpers for multi-tenant organization primitives.
 *
 * Downstream agents consume these types to stay aligned on role/status
 * string literals and core permission predicates.
 */

export type OrgRole = "owner" | "admin" | "member";

export const ORG_ROLES: readonly OrgRole[] = ["owner", "admin", "member"] as const;

/** Membership is "active" once `acceptedAt` is set; otherwise "pending". */
export type MembershipStatus = "pending" | "active";

export type InvitationStatus = "pending" | "expired" | "accepted" | "canceled";

export type AccessRequestStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "canceled";

export type DomainVerificationMethod =
  | "email_match"
  | "dns_txt"
  | "admin_override";

// ---------- Role hierarchy / permission predicates ----------

/** Only the owner can rename, delete, or change plan/billing. */
export function canManageOrg(role: OrgRole): boolean {
  return role === "owner";
}

/** Owner and admin can add/remove members and change their roles. */
export function canManageMembers(role: OrgRole): boolean {
  return role === "owner" || role === "admin";
}

/** Owner and admin can send invitations and approve access requests. */
export function canInvite(role: OrgRole): boolean {
  return role === "owner" || role === "admin";
}

// ---------- Slug helpers ----------

const SLUG_MAX_LENGTH = 40;

/**
 * Normalize a name into a URL-safe slug.
 *
 * - Strips diacritics / accents via NFD decomposition
 * - Lowercases
 * - Replaces whitespace and underscores with `-`
 * - Drops any character not in `[a-z0-9-]`
 * - Collapses runs of `-` into a single `-`
 * - Trims leading/trailing `-`
 * - Caps length at 40 chars (and trims trailing `-` again after the cap)
 *
 * Returns `""` if no valid characters remain.
 */
export function slugify(name: string): string {
  if (typeof name !== "string") return "";

  const stripped = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // combining diacritics
    .toLowerCase();

  const normalized = stripped
    .replace(/[\s_]+/g, "-") // whitespace / underscore → hyphen
    .replace(/[^a-z0-9-]+/g, "") // drop everything else
    .replace(/-+/g, "-") // collapse runs of hyphens
    .replace(/^-+|-+$/g, ""); // trim leading/trailing hyphens

  if (normalized.length <= SLUG_MAX_LENGTH) return normalized;

  return normalized.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, "");
}
