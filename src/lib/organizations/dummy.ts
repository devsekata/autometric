import { Organization } from './types';

// Set to true to preview the no-organization UI state
const USE_EMPTY_STATE = false;

export const DUMMY_ORGS: Organization[] = USE_EMPTY_STATE
  ? []
  : [
      {
        id: '1',
        slug: 'autometric-hq',
        name: 'Autometric HQ',
        created_at: '2025-01-14T00:00:00Z',
        role: 'OWNER',
        member_count: 8,
        brand_count: 4,
        members_preview: [{ name: 'Gerry Sinaga' }, { name: 'Alex Kim' }, { name: 'Sarah Chen' }],
      },
      {
        id: '2',
        slug: 'brand-studio',
        name: 'Brand Studio',
        created_at: '2025-03-02T00:00:00Z',
        role: 'ADMIN',
        member_count: 4,
        brand_count: 2,
        members_preview: [{ name: 'Diana Park' }, { name: 'Tom Lee' }],
      },
      {
        id: '3',
        slug: 'research-team',
        name: 'Research Team',
        created_at: '2025-04-21T00:00:00Z',
        role: 'VIEWER',
        member_count: 12,
        brand_count: 7,
        members_preview: [{ name: 'Mira Jones' }, { name: 'Kevin Wu' }, { name: 'Lisa Ray' }],
      },
    ];

export function getOrgBySlug(slug: string): Organization | undefined {
  return DUMMY_ORGS.find((o) => o.slug === slug);
}
