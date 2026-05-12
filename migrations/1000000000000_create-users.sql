-- Up Migration
CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email            VARCHAR(255) UNIQUE NOT NULL,
  name             VARCHAR(255) NOT NULL,
  avatar_url       TEXT,
  email_verified   BOOLEAN NOT NULL DEFAULT false,
  password_hash    TEXT,
  google_id        VARCHAR(255) UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_users_has_auth CHECK (
    password_hash IS NOT NULL OR google_id IS NOT NULL
  )
);

CREATE INDEX idx_users_email    ON users (email);
CREATE INDEX idx_users_google_id ON users (google_id);

-- Down Migration
-- DROP TABLE users;
