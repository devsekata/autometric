-- Up Migration
ALTER TABLE l0_raw.ig_competitor_media
  ADD COLUMN IF NOT EXISTS shortcode           VARCHAR(255),
  ADD COLUMN IF NOT EXISTS slide_count         INTEGER,
  ADD COLUMN IF NOT EXISTS video_duration      FLOAT,
  ADD COLUMN IF NOT EXISTS hashtags_list       TEXT[],
  ADD COLUMN IF NOT EXISTS hashtags_count      INTEGER,
  ADD COLUMN IF NOT EXISTS mentions            TEXT[],
  ADD COLUMN IF NOT EXISTS is_collaborator     BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_sponsored        BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_comment_disabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS music_title         VARCHAR(255),
  ADD COLUMN IF NOT EXISTS music_author        VARCHAR(255),
  ADD COLUMN IF NOT EXISTS is_pinned           BOOLEAN;

-- Down Migration
-- ALTER TABLE l0_raw.ig_competitor_media
--   DROP COLUMN IF EXISTS shortcode,
--   DROP COLUMN IF EXISTS slide_count,
--   DROP COLUMN IF EXISTS video_duration,
--   DROP COLUMN IF EXISTS hashtags_list,
--   DROP COLUMN IF EXISTS hashtags_count,
--   DROP COLUMN IF EXISTS mentions,
--   DROP COLUMN IF EXISTS is_collaborator,
--   DROP COLUMN IF EXISTS is_sponsored,
--   DROP COLUMN IF EXISTS is_comment_disabled,
--   DROP COLUMN IF EXISTS music_title,
--   DROP COLUMN IF EXISTS music_author,
--   DROP COLUMN IF EXISTS is_pinned;
