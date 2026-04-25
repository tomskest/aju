/**
 * Validation for filename + category fragments that are interpolated into S3
 * object keys (e.g. `${brainName}/files/${category}/${filename}`).
 *
 * Without these checks, a caller could supply `category = "../../../etc"` or a
 * filename containing `/` or `\` and escape the intended key prefix, either
 * colliding with other brains' objects or naming files that break downstream
 * path-segment parsing. We reject anything that contains path separators, a
 * `..` sequence, a leading dot (hidden files), control characters, or values
 * that are empty or >255 chars. Filenames must additionally match a
 * conservative allow-list; categories are kebab/snake-case identifiers only.
 */

const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/;
const FILENAME_RE = /^[A-Za-z0-9._\- ]+$/;
const CATEGORY_RE = /^[A-Za-z0-9_-]+$/;

export type PathSegmentKind = "filename" | "category";

export type ValidationOk = { ok: true; value: string };
export type ValidationErr = { ok: false; code: string };
export type ValidationResult = ValidationOk | ValidationErr;

export function validateS3PathSegment(
  raw: unknown,
  kind: PathSegmentKind,
): ValidationResult {
  const code = kind === "filename" ? "invalid_filename" : "invalid_category";

  if (typeof raw !== "string") return { ok: false, code };
  const value = raw.trim();

  if (value.length === 0 || value.length > 255) return { ok: false, code };
  if (value.startsWith(".")) return { ok: false, code };
  if (value.includes("/") || value.includes("\\")) return { ok: false, code };
  if (value.includes("..")) return { ok: false, code };
  if (CONTROL_CHARS_RE.test(value)) return { ok: false, code };

  const allowList = kind === "filename" ? FILENAME_RE : CATEGORY_RE;
  if (!allowList.test(value)) return { ok: false, code };

  return { ok: true, value };
}
