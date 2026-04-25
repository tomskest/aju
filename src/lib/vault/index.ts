/**
 * Vault domain barrel.
 *
 * Brains, brain access, knowledge-base helpers, document parsing, and the
 * wikilink graph. Callers import from `@/lib/vault` regardless of which
 * file inside houses the symbol.
 */
export * from "./brain";
export * from "./brain-delete";
export * from "./kb";
export * from "./kb-markdown";
export * from "./parse";
export * from "./link-resolver";
export * from "./rebuild-links";
