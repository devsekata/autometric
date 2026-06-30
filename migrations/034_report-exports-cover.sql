-- Up Migration
ALTER TABLE report_exports ADD COLUMN cover_image_url TEXT;
ALTER TABLE report_exports ADD COLUMN cover_public_id VARCHAR(500);

-- Down Migration
-- ALTER TABLE report_exports DROP COLUMN cover_public_id;
-- ALTER TABLE report_exports DROP COLUMN cover_image_url;
