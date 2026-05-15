-- Up Migration
CREATE TYPE member_role   AS ENUM ('OWNER', 'ADMIN', 'VIEWER');
CREATE TYPE member_status AS ENUM ('ACTIVE', 'PENDING', 'CANCELLED');

CREATE TABLE organization_members (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id          UUID REFERENCES users (id) ON DELETE SET NULL,
  email            VARCHAR(255) NOT NULL,
  role             member_role   NOT NULL DEFAULT 'VIEWER',
  status           member_status NOT NULL DEFAULT 'PENDING',
  invited_by       UUID REFERENCES users (id) ON DELETE SET NULL,
  joined_at        TIMESTAMPTZ,
  invited_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_organization_members_email UNIQUE (organization_id, email)
);

CREATE INDEX idx_organization_members_org    ON organization_members (organization_id);
CREATE INDEX idx_organization_members_user   ON organization_members (user_id);
CREATE INDEX idx_organization_members_status ON organization_members (status);

-- Down Migration
-- DROP TABLE organization_members;
-- DROP TYPE member_status;
-- DROP TYPE member_role;
