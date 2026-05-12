-- Up Migration
CREATE TYPE member_role   AS ENUM ('OWNER', 'ADMIN', 'VIEWER');
CREATE TYPE member_status AS ENUM ('ACTIVE', 'PENDING', 'CANCELLED');

CREATE TABLE workspace_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users (id) ON DELETE SET NULL,
  email         VARCHAR(255) NOT NULL,
  role          member_role   NOT NULL DEFAULT 'VIEWER',
  status        member_status NOT NULL DEFAULT 'PENDING',
  invited_by    UUID REFERENCES users (id) ON DELETE SET NULL,
  joined_at     TIMESTAMPTZ,
  invited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_workspace_members_email UNIQUE (workspace_id, email)
);

CREATE INDEX idx_workspace_members_workspace ON workspace_members (workspace_id);
CREATE INDEX idx_workspace_members_user      ON workspace_members (user_id);
CREATE INDEX idx_workspace_members_status    ON workspace_members (status);

-- Down Migration
-- DROP TABLE workspace_members;
-- DROP TYPE member_status;
-- DROP TYPE member_role;
