-- Up Migration
ALTER TABLE l0_raw.ig_stories ADD COLUMN video_duration NUMERIC(10,3);

-- Down Migration
-- ALTER TABLE l0_raw.ig_stories DROP COLUMN video_duration;
