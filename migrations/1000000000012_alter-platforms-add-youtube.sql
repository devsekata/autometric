-- Up Migration
INSERT INTO platforms (key, label, icon)
VALUES ('youtube', 'YouTube', 'play_circle')
ON CONFLICT (key) DO NOTHING;

-- Down Migration
-- DELETE FROM platforms WHERE key = 'youtube';
