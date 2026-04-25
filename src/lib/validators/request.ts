import { NextRequest, NextResponse } from "next/server";
import { ZodError, z } from "zod";

/**
 * Parse + validate a JSON request body against a zod schema.
 *
 * On success returns `{ ok: true, value }` with the typed, normalized data
 * (zod's `.transform`/`.toLowerCase()`/`.trim()` apply). On failure returns
 * `{ ok: false, response }` — caller returns the response to short-circuit
 * the handler.
 *
 * Field-level errors are surfaced under `details` so clients can render
 * inline messages without screen-scraping the message string.
 */
export async function validateBody<TSchema extends z.ZodTypeAny>(
  req: NextRequest,
  schema: TSchema,
): Promise<
  | { ok: true; value: z.infer<TSchema> }
  | { ok: false; response: NextResponse }
> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "invalid_json" }, { status: 400 }),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: validationFailure(parsed.error) };
  }
  return { ok: true, value: parsed.data };
}

/**
 * Validate `req.nextUrl.searchParams` against a zod schema. Search params are
 * always strings; the schema is responsible for coercing (use `z.coerce.number()`
 * etc. as needed).
 */
export function validateQuery<TSchema extends z.ZodTypeAny>(
  req: NextRequest,
  schema: TSchema,
):
  | { ok: true; value: z.infer<TSchema> }
  | { ok: false; response: NextResponse } {
  const obj: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    obj[k] = v;
  });
  const parsed = schema.safeParse(obj);
  if (!parsed.success) {
    return { ok: false, response: validationFailure(parsed.error) };
  }
  return { ok: true, value: parsed.data };
}

/**
 * Build a 400 response from a zod error. `details` is a `[path, code]` map
 * the UI can use to attach the error to the offending field. The top-level
 * `error` is always `validation_failed` for predictable client handling.
 */
function validationFailure(err: ZodError): NextResponse {
  const details = err.errors.map((e) => ({
    path: e.path.join("."),
    code: e.message,
  }));
  return NextResponse.json(
    { error: "validation_failed", details },
    { status: 400 },
  );
}
