/**
 * Embeddings domain barrel.
 *
 * Voyage AI embedding generation, vector helpers, per-doc/file updates, and
 * brain reindex. Callers import from `@/lib/embeddings` regardless of which
 * file inside houses the symbol.
 */
export * from "./embeddings";
export * from "./update";
export * from "./reindex";
