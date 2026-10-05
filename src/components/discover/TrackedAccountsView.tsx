'use client'

/**
 * Tracked Accounts — both things that phrase means, on one screen.
 *
 * Discovery ended up with two populations that are genuinely both "accounts this
 * organization monitors", and they are not the same subject:
 *
 *   * **Creators** — creators somebody pressed Start Tracking on, from the
 *     Creator Database or a creator profile. The link lives in
 *     `discover_creator_links` and the creator lives in the KOL database (or in
 *     this org's own roster). This is the segment the product means by tracking:
 *     an explicit decision, with a status you can pause and resume.
 *   * **Brand & competitor accounts** — the social accounts the warehouse
 *     collects posts for, which is what `DiscoverDirectoryView` has always
 *     shown. Those are connected in Brand settings, have post-level history
 *     behind them, and feed every dashboard in the module. Nothing about them
 *     changes here.
 *
 * A switch rather than two sidebar entries: they answer the same question about
 * two populations, and the second one is a screen people already know where to
 * find. Creators lead because that is the one Discovery's other screens send you
 * to — pressing Start Tracking anywhere lands here.
 *
 * The choice is remembered per org in `localStorage`, which is the right storage
 * for it: it is a view preference for one person on one machine, not a decision
 * the workspace shares. Compare and the cart use the same reasoning.
 */

import { useEffect, useState } from 'react'
import { TabStrip } from './ui'
import LinkedCreatorList from './LinkedCreatorList'
import DiscoverDirectoryView from './DiscoverDirectoryView'

type Segment = 'creators' | 'accounts'

const SEGMENTS: { id: Segment; label: string; icon: string }[] = [
  { id: 'creators', label: 'Creators', icon: 'monitor_heart' },
  { id: 'accounts', label: 'Brand & Competitor Accounts', icon: 'hub' },
]

export interface TrackedAccountsViewProps {
  orgId: string
  orgSlug: string
  /* ── creators half ── */
  onOpenCreator: (creatorId: string) => void
  onOpenRosterCreator: (kolId: string) => void
  onGoToDatabase: () => void
  onFindSimilar: (id: string, source: 'creator' | 'roster') => void
  /* ── warehouse accounts half, passed straight through ── */
  onSelectKol: (id: string, relation: 'owned' | 'competitor', username: string) => void
  onOrderKol: (id: string, relation: 'owned' | 'competitor', username: string) => void
  onAddToCampaign: (ids: string[]) => void
}

const storageKey = (orgId: string) => `autometric:discover:tracked-segment:${orgId}`

export default function TrackedAccountsView({
  orgId, orgSlug,
  onOpenCreator, onOpenRosterCreator, onGoToDatabase, onFindSimilar,
  onSelectKol, onOrderKol, onAddToCampaign,
}: TrackedAccountsViewProps) {
  // Starts on the default so server and first client render agree; the stored
  // value is adopted in the effect below, the same shape `useDiscoverSelection`
  // uses to avoid a hydration mismatch.
  const [segment, setSegment] = useState<Segment>('creators')

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey(orgId))
      if (saved === 'creators' || saved === 'accounts') setSegment(saved)
    } catch { /* private mode */ }
  }, [orgId])

  const choose = (next: Segment) => {
    setSegment(next)
    try { window.localStorage.setItem(storageKey(orgId), next) } catch { /* quota */ }
  }

  return (
    <div>
      <div className="mb-4">
        <TabStrip tabs={SEGMENTS} value={segment} onChange={choose} />
        <p className="text-[11px] mt-1.5 leading-snug text-[#9ca3af] max-w-[92ch]">
          {segment === 'creators'
            ? 'Creators your organization chose to monitor. A creator is only here because somebody started tracking them — being in the Creator Database is not the same thing.'
            : 'The brand and competitor social accounts this workspace collects posts for. These are connected in Brand settings and are what the dashboards are built on.'}
        </p>
      </div>

      {segment === 'creators' ? (
        <LinkedCreatorList
          orgId={orgId}
          facet="tracked"
          onOpenCreator={onOpenCreator}
          onOpenRosterCreator={onOpenRosterCreator}
          onGoToDatabase={onGoToDatabase}
          onFindSimilar={onFindSimilar}
        />
      ) : (
        <DiscoverDirectoryView
          orgId={orgId}
          orgSlug={orgSlug}
          onSelectKol={onSelectKol}
          onOrderKol={onOrderKol}
          onAddToCampaign={onAddToCampaign}
        />
      )}
    </div>
  )
}
