-- Up Migration
ALTER TABLE report_exports ADD COLUMN name VARCHAR(255);

-- Down Migration
-- ALTER TABLE report_exports DROP COLUMN name;
