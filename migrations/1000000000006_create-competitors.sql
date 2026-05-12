-- Up Migration
CREATE TABLE competitors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    UUID NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE competitor_social_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id     UUID NOT NULL REFERENCES competitors (id) ON DELETE CASCADE,
  social_account_id UUID NOT NULL REFERENCES social_accounts (id) ON DELETE RESTRICT,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_competitor_social_accounts UNIQUE (competitor_id, social_account_id)
);

CREATE INDEX idx_competitors_brand                    ON competitors (brand_id);
CREATE INDEX idx_competitor_social_accounts_competitor ON competitor_social_accounts (competitor_id);
CREATE INDEX idx_competitor_social_accounts_social     ON competitor_social_accounts (social_account_id);

-- Down Migration
-- DROP TABLE competitor_social_accounts;
-- DROP TABLE competitors;
