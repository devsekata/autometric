-- Up Migration
ALTER TABLE l0_raw.ig_comments
  ADD COLUMN hidden    BOOLEAN,
  ADD COLUMN parent_id TEXT;

-- Down Migration
-- ALTER TABLE l0_raw.ig_comments DROP COLUMN hidden, DROP COLUMN parent_id;
