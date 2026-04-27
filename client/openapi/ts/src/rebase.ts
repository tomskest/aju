// Auto-rebase helper for /api/vault/update.
//
// Implements the protocol from the design discussion:
//
//   loop up to N times:
//     read doc            → get head_hash + content
//     apply your edit     → new_content
//     POST update(baseHash, baseContent, content)
//     if 200 → done
//     if 200 + merged → done (server merged)
//     if 409 stale_base_hash → re-read, re-apply, retry
//     if 409 merge_conflict  → surface to caller, no automatic retry
//
// The "intent" is encoded as a function `applyEdit(currentContent) =>
// newContent`, so on every retry the caller's logic runs against the
// freshest head. That is the difference between a CAS retry loop and
// a blind force-write — the latter would silently clobber the racing
// edit, the former incorporates it.

import type { Client } from "@hey-api/client-fetch";
import { readDocument, updateDocument } from "./generated/sdk.gen.js";
import type {
  Document,
  DocumentUpdateConflict,
} from "./generated/types.gen.js";

export type ApplyEdit = (currentContent: string) => string | Promise<string>;

export type UpdateWithRebaseOptions = {
  client: Client;
  path: string;
  brain?: string;
  source?: string;
  /** Edit function applied to whatever head the server returns on each loop iteration. */
  applyEdit: ApplyEdit;
  /** Max read→edit→update cycles before giving up. Default 5. */
  maxAttempts?: number;
};

export type UpdateWithRebaseResult =
  | { ok: true; document: Document; attempts: number; merged: boolean }
  | {
      ok: false;
      reason: "merge_conflict" | "max_attempts_exhausted";
      conflict?: DocumentUpdateConflict;
      attempts: number;
    };

/**
 * Race-safe update: re-reads, re-applies the caller's edit function, and
 * retries on stale-base CAS rejects until the server commits (possibly
 * via three-way merge) or a real merge_conflict surfaces.
 *
 * Usage:
 *
 * ```ts
 * const result = await updateWithRebase({
 *   client,
 *   path: "topics/foo.md",
 *   applyEdit: (current) => current + "\n\n## Update\nnew section\n",
 * });
 * if (!result.ok) {
 *   if (result.reason === "merge_conflict") {
 *     // Hand off to a human or rerender the conflicted text.
 *   }
 * }
 * ```
 */
export async function updateWithRebase(
  opts: UpdateWithRebaseOptions,
): Promise<UpdateWithRebaseResult> {
  const max = opts.maxAttempts ?? 5;
  for (let attempt = 1; attempt <= max; attempt++) {
    const read = await readDocument({
      client: opts.client,
      query: opts.brain
        ? { brain: opts.brain, path: opts.path }
        : { path: opts.path },
    });
    if (read.error) {
      // Read failures aren't a CAS issue — propagate.
      throw new Error(
        `read ${opts.path} failed: ${JSON.stringify(read.error)}`,
      );
    }
    // The generated client widens body unions; we know /api/vault/document
    // returns Document so narrow here once.
    const head = read.data as unknown as Document;
    const headContent = head.content ?? "";
    const headHash = head.contentHash;
    const newContent = await opts.applyEdit(headContent);

    const updated = await updateDocument({
      client: opts.client,
      query: opts.brain ? { brain: opts.brain } : undefined,
      body: {
        path: opts.path,
        content: newContent,
        source: opts.source ?? "sdk-rebase",
        baseHash: headHash,
        baseContent: headContent,
      },
    });

    if (!updated.error) {
      const data = updated.data as unknown as Document & {
        merged?: boolean;
      };
      const merged = Boolean(data?.merged);
      return { ok: true, document: data, attempts: attempt, merged };
    }

    // The generated client packs the parsed JSON body of a 4xx into
    // `error`. For 409 it is shaped as DocumentUpdateConflict.
    const errBody = updated.error as Partial<DocumentUpdateConflict>;
    if (errBody?.error === "merge_conflict") {
      return {
        ok: false,
        reason: "merge_conflict",
        conflict: errBody as DocumentUpdateConflict,
        attempts: attempt,
      };
    }
    if (errBody?.error === "stale_base_hash") {
      // Loop: read again, re-apply, retry.
      continue;
    }
    // Other errors aren't CAS-related — propagate.
    throw new Error(
      `update ${opts.path} failed: ${JSON.stringify(updated.error)}`,
    );
  }
  return { ok: false, reason: "max_attempts_exhausted", attempts: max };
}
