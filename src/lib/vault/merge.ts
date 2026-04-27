import { merge as diff3Merge } from "node-diff3";

export type ThreeWayMergeResult =
  | { ok: true; merged: string }
  | { ok: false; conflicted: string };

/**
 * Three-way line merge of three text buffers using the diff3 algorithm.
 *
 *   base   — the content the writer originally read (their merge base)
 *   theirs — the current head content on the server (someone else's edit
 *            that landed since the writer read)
 *   mine   — the writer's new content
 *
 * On clean merge (no overlapping changes) returns the merged buffer.
 * On conflict, returns the conflicted buffer with `<<<<<<<`/`=======`/
 * `>>>>>>>` markers so the caller can render or hand off to a human.
 *
 * Line-based — that's good enough for markdown notes where edits are
 * typically additive (new sections, frontmatter tweaks). Token-level
 * merge would be a future refinement.
 */
export function threeWayMerge(
  base: string,
  theirs: string,
  mine: string,
): ThreeWayMergeResult {
  // node-diff3's merge() treats `a` as mine (the local change being applied)
  // and `b` as theirs (the upstream change). Default `stringSeparator` is
  // /\s+/ (token-level merge), which would explode markdown into one word
  // per merge unit and produce surprising output. Force /\r?\n/ so the
  // merge is line-based — that's the right granularity for prose / code.
  // `excludeFalseConflicts` collapses identical edits on both sides.
  const result = diff3Merge<string>(mine, base, theirs, {
    excludeFalseConflicts: true,
    stringSeparator: /\r?\n/,
  });

  const joined = result.result.join("\n");
  if (result.conflict) {
    return { ok: false, conflicted: joined };
  }
  return { ok: true, merged: joined };
}
