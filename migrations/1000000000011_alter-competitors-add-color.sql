-- Up Migration
ALTER TABLE competitors
  ADD COLUMN color VARCHAR(7) NOT NULL DEFAULT '#7c5cbf';

-- Down Migration
-- ALTER TABLE competitors DROP COLUMN color;
