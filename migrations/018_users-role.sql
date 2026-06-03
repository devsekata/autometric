-- Up Migration
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role VARCHAR(10) NOT NULL DEFAULT 'USER'
    CONSTRAINT chk_users_role CHECK (role IN ('ADMIN', 'USER'));

-- Down Migration
-- ALTER TABLE users DROP COLUMN role;
