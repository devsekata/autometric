-- Up Migration

-- Drop previous competitor tables
DROP TABLE IF EXISTS competitor_social_accounts;
DROP TABLE IF EXISTS brand_competitors;
DROP TABLE IF EXISTS competitors;

-- brand_competitors: brand tracks a social account as competitor
CREATE TABLE brand_competitors (
  brand_id          UUID        NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  social_account_id UUID        NOT NULL REFERENCES social_accounts (id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (brand_id, social_account_id)
);

CREATE INDEX idx_brand_competitors_brand   ON brand_competitors (brand_id);
CREATE INDEX idx_brand_competitors_social  ON brand_competitors (social_account_id);

-- Down Migration
DROP TABLE brand_competitors;

CREATE TABLE competitors (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE brand_competitors (
  brand_id      UUID        NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  competitor_id UUID        NOT NULL REFERENCES competitors (id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (brand_id, competitor_id)
);

CREATE TABLE competitor_social_accounts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id     UUID        NOT NULL REFERENCES competitors (id) ON DELETE CASCADE,
  social_account_id UUID        NOT NULL REFERENCES social_accounts (id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_competitor_social_accounts UNIQUE (competitor_id, social_account_id)
);
