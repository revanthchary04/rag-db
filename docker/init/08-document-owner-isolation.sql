-- Per-device document isolation.
--
-- Guest uploads are scoped to the device (browser) that created them via
-- owner_key, and auto-expire via expires_at. NULL owner_key = public/shared
-- (the seeded demo corpus, visible to everyone); NULL expires_at = never expires.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS owner_key TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

-- Filter by owner on every list/retrieve.
CREATE INDEX IF NOT EXISTS documents_owner_key_idx ON documents (owner_key);

-- Sweep expired rows on a timer (partial index keeps it small).
CREATE INDEX IF NOT EXISTS documents_expires_at_idx ON documents (expires_at)
  WHERE expires_at IS NOT NULL;
