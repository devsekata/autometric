-- Up Migration

-- Step 1: Drop old tables (order matters for FK)
DROP TABLE IF EXISTS competitor_social_accounts;
DROP TABLE IF EXISTS competitors;
DROP TABLE IF EXISTS brand_social_accounts;

-- Step 2: Restructure brands — remove organization_id, add avatar_url
ALTER TABLE brands
  DROP COLUMN organization_id,
  ADD COLUMN avatar_url TEXT;

-- Step 3: Junction table — organization owns brand
CREATE TABLE organization_brands (
  organization_id UUID        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  brand_id        UUID        NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, brand_id)
);

-- Step 4: Recreate brand_social_accounts (was dropped in step 1)
CREATE TABLE brand_social_accounts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          UUID        NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  social_account_id UUID        NOT NULL REFERENCES social_accounts (id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_brand_social_accounts UNIQUE (brand_id, social_account_id)
);

-- Step 5: Competitor tracking — competitor is also a brand entity
CREATE TABLE brand_competitors (
  brand_id      UUID        NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  competitor_id UUID        NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (brand_id, competitor_id),
  CONSTRAINT chk_no_self_compete CHECK (brand_id <> competitor_id)
);

-- Indexes
CREATE INDEX idx_organization_brands_org      ON organization_brands (organization_id);
CREATE INDEX idx_organization_brands_brand    ON organization_brands (brand_id);
CREATE INDEX idx_brand_social_accounts_brand  ON brand_social_accounts (brand_id);
CREATE INDEX idx_brand_social_accounts_social ON brand_social_accounts (social_account_id);
CREATE INDEX idx_brand_competitors_brand      ON brand_competitors (brand_id);
CREATE INDEX idx_brand_competitors_competitor ON brand_competitors (competitor_id);

-- Down Migration
DROP TABLE brand_competitors;
DROP TABLE brand_social_accounts;
DROP TABLE organization_brands;
ALTER TABLE brands
  DROP COLUMN avatar_url,
  ADD COLUMN organization_id UUID REFERENCES organizations (id) ON DELETE CASCADE;

CREATE TABLE brand_social_accounts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          UUID        NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  social_account_id UUID        NOT NULL REFERENCES social_accounts (id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_brand_social_accounts UNIQUE (brand_id, social_account_id)
);

CREATE TABLE competitors (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id   UUID        NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE competitor_social_accounts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id     UUID        NOT NULL REFERENCES competitors (id) ON DELETE CASCADE,
  social_account_id UUID        NOT NULL REFERENCES social_accounts (id) ON DELETE RESTRICT,
  enabled           BOOLEAN     NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_competitor_social_accounts UNIQUE (competitor_id, social_account_id)
);
