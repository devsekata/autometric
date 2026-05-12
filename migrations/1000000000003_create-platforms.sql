-- Up Migration
CREATE TABLE platforms (
  id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key    VARCHAR(50) UNIQUE NOT NULL,
  label  VARCHAR(100) NOT NULL,
  icon   VARCHAR(100) NOT NULL
);

-- Seed master data
INSERT INTO platforms (key, label, icon) VALUES
  ('instagram', 'Instagram', 'photo_camera'),
  ('tiktok',    'TikTok',    'music_note'),
  ('facebook',  'Facebook',  'public'),
  ('twitter',   'Twitter / X', 'tag');

-- Down Migration
-- DROP TABLE platforms;
