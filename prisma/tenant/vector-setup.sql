-- pgvector setup for aju — runs on every app boot via scripts/apply-post-migrate.ts
-- Idempotent (safe to re-apply).
--
-- Dimension 1024 matches voyage-4-large (see src/lib/embeddings.ts EMBEDDING_DIMENSIONS).

CREATE EXTENSION IF NOT EXISTS vector;

-- Embedding columns on the two tables that get vectorized
ALTER TABLE vault_documents ADD COLUMN IF NOT EXISTS embedding vector(1024);
ALTER TABLE vault_files     ADD COLUMN IF NOT EXISTS embedding vector(1024);

-- HNSW indexes for fast cosine similarity search
CREATE INDEX IF NOT EXISTS idx_vault_documents_embedding_hnsw
  ON vault_documents USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_vault_files_embedding_hnsw
  ON vault_files USING hnsw (embedding vector_cosine_ops);
