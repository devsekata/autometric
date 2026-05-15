import { Brand } from './types'

export const DUMMY_BRANDS: Brand[] = [
  // ── Autometric HQ (org_id: '1') — 4 brands ──
  {
    id: 'b1', org_id: '1', name: 'Autometric Brand', color: '#3d7e96',
    created_at: '2025-01-20T00:00:00Z',
    accounts: [
      { id: 'a1', platform: 'instagram', handle: '@autometric.id', followers: 48200, connected_at: '2025-02-01T00:00:00Z' },
      { id: 'a2', platform: 'tiktok',    handle: '@autometric',    followers: 32100, connected_at: '2025-02-05T00:00:00Z' },
      { id: 'a3', platform: 'facebook',  handle: 'Autometric',     followers: 12400, connected_at: '2025-02-10T00:00:00Z' },
    ],
    competitors: [
      { id: 'c1', name: 'BrandMonitor', color: '#7c5cbf', accounts: [{ platform: 'instagram', handle: '@brandmonitor' }] },
      { id: 'c2', name: 'Sprinklr',     color: '#d97706', accounts: [] },
    ],
  },
  {
    id: 'b2', org_id: '1', name: 'Alva Intelligence', color: '#7c5cbf',
    created_at: '2025-02-14T00:00:00Z',
    accounts: [
      { id: 'a4', platform: 'instagram', handle: '@alva.ai', followers: 12300, connected_at: '2025-03-01T00:00:00Z' },
      { id: 'a5', platform: 'twitter',   handle: '@alva_ai', followers: 8100,  connected_at: '2025-03-05T00:00:00Z' },
    ],
    competitors: [
      { id: 'c3', name: 'Brandwatch', color: '#059669', accounts: [{ platform: 'twitter', handle: '@brandwatch' }] },
    ],
  },
  {
    id: 'b3', org_id: '1', name: 'DataMetrics Pro', color: '#059669',
    created_at: '2025-03-08T00:00:00Z',
    accounts: [
      { id: 'a6', platform: 'facebook', handle: 'DataMetricsPro', followers: 5200, connected_at: '2025-04-01T00:00:00Z' },
    ],
    competitors: [],
  },
  {
    id: 'b4', org_id: '1', name: 'Campaign Studio', color: '#d97706',
    created_at: '2025-04-12T00:00:00Z',
    accounts: [
      { id: 'a7', platform: 'instagram', handle: '@campaignstudio', followers: 22100, connected_at: '2025-04-15T00:00:00Z' },
      { id: 'a8', platform: 'tiktok',    handle: '@campstudio',     followers: 15400, connected_at: '2025-04-20T00:00:00Z' },
    ],
    competitors: [
      { id: 'c4', name: 'HubSpot',   color: '#e11d48', accounts: [] },
      { id: 'c5', name: 'Hootsuite', color: '#2563eb', accounts: [] },
    ],
  },
  // ── Brand Studio (org_id: '2') — 2 brands ──
  {
    id: 'b5', org_id: '2', name: 'Studio Visual', color: '#3d7e96',
    created_at: '2025-03-10T00:00:00Z',
    accounts: [
      { id: 'a9',  platform: 'instagram', handle: '@studiovisual', followers: 18700, connected_at: '2025-03-15T00:00:00Z' },
      { id: 'a10', platform: 'facebook',  handle: 'Studio Visual', followers: 7300,  connected_at: '2025-03-20T00:00:00Z' },
    ],
    competitors: [
      { id: 'c6', name: 'Creative Hub', color: '#7c5cbf', accounts: [] },
    ],
  },
  {
    id: 'b6', org_id: '2', name: 'Creative Lab', color: '#7c5cbf',
    created_at: '2025-04-05T00:00:00Z',
    accounts: [
      { id: 'a11', platform: 'instagram', handle: '@creativelab.id', followers: 31200, connected_at: '2025-04-08T00:00:00Z' },
      { id: 'a12', platform: 'tiktok',    handle: '@creativelab',    followers: 24500, connected_at: '2025-04-10T00:00:00Z' },
    ],
    competitors: [],
  },
  // ── Research Team (org_id: '3') — 7 brands ──
  {
    id: 'b7', org_id: '3', name: 'Brand Alpha', color: '#3d7e96',
    created_at: '2025-01-10T00:00:00Z',
    accounts: [{ id: 'a13', platform: 'instagram', handle: '@brandalpha', followers: 9200, connected_at: '2025-01-15T00:00:00Z' }],
    competitors: [{ id: 'c7', name: 'Brand Beta', color: '#e11d48', accounts: [] }],
  },
  {
    id: 'b8', org_id: '3', name: 'Brand Beta', color: '#e11d48',
    created_at: '2025-01-15T00:00:00Z',
    accounts: [
      { id: 'a14', platform: 'instagram', handle: '@brandbeta', followers: 14500, connected_at: '2025-01-20T00:00:00Z' },
      { id: 'a15', platform: 'youtube',   handle: 'BrandBeta',  followers: 8900,  connected_at: '2025-02-01T00:00:00Z' },
    ],
    competitors: [],
  },
  {
    id: 'b9', org_id: '3', name: 'Market Vision', color: '#059669',
    created_at: '2025-02-01T00:00:00Z',
    accounts: [{ id: 'a16', platform: 'twitter', handle: '@marketvision', followers: 5600, connected_at: '2025-02-10T00:00:00Z' }],
    competitors: [],
  },
  {
    id: 'b10', org_id: '3', name: 'Insight Pro', color: '#d97706',
    created_at: '2025-02-20T00:00:00Z',
    accounts: [],
    competitors: [],
  },
  {
    id: 'b11', org_id: '3', name: 'TrendWatch', color: '#2563eb',
    created_at: '2025-03-05T00:00:00Z',
    accounts: [
      { id: 'a17', platform: 'tiktok',   handle: '@trendwatch', followers: 41200, connected_at: '2025-03-10T00:00:00Z' },
      { id: 'a18', platform: 'facebook', handle: 'TrendWatch',  followers: 6700,  connected_at: '2025-03-12T00:00:00Z' },
    ],
    competitors: [{ id: 'c8', name: 'TrendScope', color: '#7c5cbf', accounts: [] }],
  },
  {
    id: 'b12', org_id: '3', name: 'Data Pulse', color: '#7c5cbf',
    created_at: '2025-03-18T00:00:00Z',
    accounts: [{ id: 'a19', platform: 'instagram', handle: '@datapulse', followers: 7800, connected_at: '2025-03-22T00:00:00Z' }],
    competitors: [],
  },
  {
    id: 'b13', org_id: '3', name: 'Signal Labs', color: '#e11d48',
    created_at: '2025-04-01T00:00:00Z',
    accounts: [{ id: 'a20', platform: 'twitter', handle: '@signallabs', followers: 3200, connected_at: '2025-04-05T00:00:00Z' }],
    competitors: [],
  },
]

const SLUG_TO_ORG_ID: Record<string, string> = {
  'autometric-hq': '1',
  'brand-studio':  '2',
  'research-team': '3',
}

export function getBrandsByOrgSlug(orgSlug: string): Brand[] {
  const orgId = SLUG_TO_ORG_ID[orgSlug]
  return orgId ? DUMMY_BRANDS.filter(b => b.org_id === orgId) : []
}

export function getBrandById(brandId: string): Brand | undefined {
  return DUMMY_BRANDS.find(b => b.id === brandId)
}
