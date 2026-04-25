-- Full-text search setup for vault_files (run after Prisma migrations)

ALTER TABLE vault_files ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION vault_files_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.filename, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags, ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.extracted_text, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vault_files_search ON vault_files;
CREATE TRIGGER trg_vault_files_search
  BEFORE INSERT OR UPDATE ON vault_files
  FOR EACH ROW EXECUTE FUNCTION vault_files_search_update();

CREATE INDEX IF NOT EXISTS idx_vault_files_search ON vault_files USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_vault_files_filename_trgm ON vault_files USING gin(filename gin_trgm_ops);
