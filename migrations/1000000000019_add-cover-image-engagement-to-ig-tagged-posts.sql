-- Up Migration
ALTER TABLE l0_raw.ig_tagged_posts
  ADD COLUMN cover_image TEXT,
  ADD COLUMN engagement  INTEGER;

-- Down Migration
-- ALTER TABLE l0_raw.ig_tagged_posts DROP COLUMN cover_image, DROP COLUMN engagement;
