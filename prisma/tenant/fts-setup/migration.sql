-- Full-text search setup (run after Prisma migrations)

-- Add tsvector column (updated via trigger since GENERATED columns can't use array_to_string)
ALTER TABLE vault_documents ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Trigger function to keep search_vector in sync
CREATE OR REPLACE FUNCTION vault_documents_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags, ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.content, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vault_documents_search ON vault_documents;
CREATE TRIGGER trg_vault_documents_search
  BEFORE INSERT OR UPDATE ON vault_documents
  FOR EACH ROW EXECUTE FUNCTION vault_documents_search_update();

-- GIN index for full-text search
CREATE INDEX IF NOT EXISTS idx_vault_documents_search ON vault_documents USING gin(search_vector);

-- Trigram extension + index for fuzzy title matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_vault_documents_title_trgm ON vault_documents USING gin(title gin_trgm_ops);
