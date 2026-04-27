import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Append-only audit log for control-plane mutations. The persistent surface
 * is `audit_event` (see `data/control/schema.prisma`). Vault doc/file
 * mutations live in the per-tenant `vault_change_log` and are NOT logged
 * here — this table covers everything else: key mints/revokes, role
 * changes, org rename/delete, agent grants, OAuth token issuance, etc.
 *
 * Three rules of thumb:
 *
 *   1. Failures NEVER break the mutation. Audit is best-effort: if the
 *      insert throws, we log to console and return — the caller's
 *      operation has already succeeded. (Soft commit semantics; the
 *      forensic-trail invariant is "we try", not "we guarantee".)
 *
 *   2. Pass `tx` when audit must commit atomically with the mutation.
 *      For example, key revocation: the revoke + audit row should land
 *      together so we never see a revoked key without an audit entry.
 *      Outside a transaction (control plane GETs that mutate as a side
 *      effect) call `recordAudit(prisma, ...)`.
 *
 *   3. Don't log read events. The audit_event table is for *changes*.
 *      Read traces belong in request logs.
 */

type ControlClient = typeof prisma | Prisma.TransactionClient;

/**
 * Closed enum of canonical event types. New types are added to this list
 * as new mutating surfaces are wired in. Stable string identifiers so
 * downstream tooling (dashboards, exports) can pivot on them safely.
 */
export type AuditEventType =
  // API keys
  | "key.minted"
  | "key.revoked"
  // Org membership
  | "member.role_changed"
  | "member.removed"
  // Org lifecycle
  | "org.created"
  | "org.renamed"
  | "org.flag_changed"
  | "org.deleted"
  // Agent grants (per-brain access)
  | "agent.created"
  | "agent.granted"
  | "agent.revoked"
  | "agent.deleted"
  // User grants (per-brain access)
  | "brain.access.granted"
  | "brain.access.updated"
  | "brain.access.revoked"
  // Invitations
  | "invitation.created"
  | "invitation.canceled"
  // Domain claims
  | "domain.claimed"
  | "domain.removed";

export type AuditPayload = {
  eventType: AuditEventType;
  actorUserId?: string | null;
  actorApiKeyId?: string | null;
  /**
   * Set when the principal performing the action is an agent (the bearer
   * key was minted with `agentId`). The agent's row lives in the tenant
   * DB; this is a denormalized string, no FK.
   */
  agentId?: string | null;
  organizationId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  /**
   * Optional before/after diff. Shape is event-specific; common pattern:
   *   { before: { role: "owner" }, after: { role: "admin" } }
   */
  changes?: unknown;
  /**
   * Free-form context — request-id, user-agent, OAuth client id, etc.
   */
  metadata?: unknown;
  ipAddress?: string | null;
};

export async function recordAudit(
  client: ControlClient,
  evt: AuditPayload,
): Promise<void> {
  try {
    await client.auditEvent.create({
      data: {
        eventType: evt.eventType,
        actorUserId: evt.actorUserId ?? null,
        actorApiKeyId: evt.actorApiKeyId ?? null,
        agentId: evt.agentId ?? null,
        organizationId: evt.organizationId ?? null,
        resourceType: evt.resourceType ?? null,
        resourceId: evt.resourceId ?? null,
        changes: (evt.changes ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        metadata: (evt.metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        ipAddress: evt.ipAddress ?? null,
      },
    });
  } catch (err) {
    // Audit must never break the underlying mutation.
    console.error(
      `[audit] failed to record ${evt.eventType} for ${evt.resourceType}:${evt.resourceId}:`,
      err,
    );
  }
}

/**
 * Best-effort client IP from common reverse-proxy headers. Used to stamp
 * audit rows with the request origin.
 */
export function clientIp(req: NextRequest): string | null {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}
