-- Up Migration
CREATE TABLE brands (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  profile_url      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE brand_social_accounts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          UUID        NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  social_account_id UUID        NOT NULL REFERENCES social_accounts (id) ON DELETE RESTRICT,
  platform_id       UUID        NOT NULL REFERENCES platforms (id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_brand_social_accounts UNIQUE (brand_id, social_account_id),
  CONSTRAINT uq_brand_platform        UNIQUE (brand_id, platform_id)
);

CREATE TABLE brand_competitors (
  brand_id          UUID        NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  social_account_id UUID        NOT NULL REFERENCES social_accounts (id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (brand_id, social_account_id)
);

CREATE INDEX idx_brands_organization          ON brands (organization_id);
CREATE INDEX idx_brand_social_accounts_brand  ON brand_social_accounts (brand_id);
CREATE INDEX idx_brand_social_accounts_social ON brand_social_accounts (social_account_id);
CREATE INDEX idx_brand_competitors_brand      ON brand_competitors (brand_id);
CREATE INDEX idx_brand_competitors_social     ON brand_competitors (social_account_id);

-- Down Migration
-- DROP TABLE brand_competitors;
-- DROP TABLE brand_social_accounts;
-- DROP TABLE brands;
