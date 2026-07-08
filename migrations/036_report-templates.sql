-- Up Migration
CREATE TABLE report_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  created_by        UUID REFERENCES users (id) ON DELETE SET NULL,
  name              VARCHAR(255) NOT NULL,
  source_brand_name VARCHAR(255),
  slide_count       INT NOT NULL DEFAULT 0,
  -- reusable report structure: cover style + slides (no brand/period/data)
  config            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_report_templates_org ON report_templates (organization_id, created_at DESC);

-- Down Migration
-- DROP TABLE report_templates;
