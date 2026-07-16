-- Speeds up find_existing_document (source + title) lookups; idempotent.
CREATE INDEX IF NOT EXISTS documents_source_title_idx ON documents (source, title);
