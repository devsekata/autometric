-- Up Migration
CREATE TABLE brands (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  slug          VARCHAR(255) NOT NULL,
  color         VARCHAR(7)   NOT NULL DEFAULT '#3d7e96',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_brands_workspace_slug UNIQUE (workspace_id, slug)
);

CREATE TABLE brand_social_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          UUID NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  social_account_id UUID NOT NULL REFERENCES social_accounts (id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_brand_social_accounts UNIQUE (brand_id, social_account_id)
);

CREATE INDEX idx_brands_workspace           ON brands (workspace_id);
CREATE INDEX idx_brand_social_accounts_brand  ON brand_social_accounts (brand_id);
CREATE INDEX idx_brand_social_accounts_social ON brand_social_accounts (social_account_id);

-- Down Migration
-- DROP TABLE brand_social_accounts;
-- DROP TABLE brands;
