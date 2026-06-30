-- Up Migration
CREATE TABLE otp_verifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL,
  otp_hash      TEXT NOT NULL,
  name          VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,
  purpose       VARCHAR(50)  NOT NULL DEFAULT 'register',
  expires_at    TIMESTAMPTZ  NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_otp_email_purpose ON otp_verifications (email, purpose);

-- Down Migration
-- DROP TABLE otp_verifications;
