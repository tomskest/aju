/**
 * Validators barrel.
 *
 * Centralized input validation for HTTP request bodies and query strings.
 * Every entrypoint that takes user input MUST go through one of these
 * schemas — not `body as { foo?: unknown }` casts.
 */
export * from "./email";
export * from "./primitives";
export * from "./request";
