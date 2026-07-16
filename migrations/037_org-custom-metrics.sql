-- Up Migration
-- Per-organization custom metrics: a free expression (chain of l1/l2 fields joined by
-- + - * / operators, evaluated left-to-right) that becomes a selectable report table
-- column. `definition` holds { terms: [{op, field}], multiply100 }.
CREATE TABLE org_custom_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  created_by      UUID REFERENCES users (id) ON DELETE SET NULL,
  name            VARCHAR(120) NOT NULL,
  format          VARCHAR(16) NOT NULL DEFAULT 'number',
  definition      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_org_custom_metrics_org ON org_custom_metrics (organization_id, created_at);

-- Down Migration
-- DROP TABLE org_custom_metrics;
