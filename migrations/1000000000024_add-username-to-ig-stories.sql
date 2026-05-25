-- Up Migration
ALTER TABLE l0_raw.ig_stories ADD COLUMN username TEXT;

-- Down Migration
-- ALTER TABLE l0_raw.ig_stories DROP COLUMN username;
