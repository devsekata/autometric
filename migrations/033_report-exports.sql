-- Up Migration
CREATE TABLE report_exports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  created_by      UUID REFERENCES users (id) ON DELETE SET NULL,
  title           VARCHAR(255) NOT NULL,
  brand_name      VARCHAR(255),
  period          VARCHAR(64),
  slide_count     INT NOT NULL DEFAULT 0,
  gcs_object_name VARCHAR(500) NOT NULL,
  size_bytes      BIGINT,
  -- render + display details (subtitle, brandId, templateId, mode, colors, month, year)
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  exported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_report_exports_org ON report_exports (organization_id, exported_at DESC);

-- Down Migration
-- DROP TABLE report_exports;
