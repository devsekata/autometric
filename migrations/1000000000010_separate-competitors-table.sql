-- Up Migration

-- Drop current brand_competitors (competitor was referencing brands.id)
DROP TABLE IF EXISTS brand_competitors;

-- Separate competitors table (external entity, no organization_id)
CREATE TABLE competitors (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Junction: brand tracks which competitors
CREATE TABLE brand_competitors (
  brand_id      UUID        NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  competitor_id UUID        NOT NULL REFERENCES competitors (id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (brand_id, competitor_id)
);

-- Competitor's social accounts
CREATE TABLE competitor_social_accounts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id     UUID        NOT NULL REFERENCES competitors (id) ON DELETE CASCADE,
  social_account_id UUID        NOT NULL REFERENCES social_accounts (id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_competitor_social_accounts UNIQUE (competitor_id, social_account_id)
);

-- Indexes
CREATE INDEX idx_brand_competitors_brand               ON brand_competitors (brand_id);
CREATE INDEX idx_brand_competitors_competitor          ON brand_competitors (competitor_id);
CREATE INDEX idx_competitor_social_accounts_competitor ON competitor_social_accounts (competitor_id);
CREATE INDEX idx_competitor_social_accounts_social     ON competitor_social_accounts (social_account_id);

-- Down Migration
DROP TABLE competitor_social_accounts;
DROP TABLE brand_competitors;
DROP TABLE competitors;

CREATE TABLE brand_competitors (
  brand_id      UUID        NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  competitor_id UUID        NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (brand_id, competitor_id),
  CONSTRAINT chk_no_self_compete CHECK (brand_id <> competitor_id)
);
