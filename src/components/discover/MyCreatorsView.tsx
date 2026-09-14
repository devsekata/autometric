'use client'

/**
 * My Creators — the organization's working roster, which is filled two ways.
 *
 * Both halves are creators this workspace has chosen, and both are the answer to
 * "who do we work with"; they differ only in where the creator's record lives,
 * and therefore in what can be done to it:
 *
 *   * **Added by us** — `public.discover_creators`, the creators somebody here
 *     put through intake. This app owns those rows, so they carry a profiling
 *     status, a run log and a monitoring toggle, and `CreatorRoster` is the
 *     screen that manages them. Unchanged.
 *   * **Saved from the database** — creators adopted out of the commercial KOL
 *     database with Add to My Creators. Their record stays on the KOL server
 *     where it is kept fresh; what this org holds is a link
 *     (`discover_creator_links`), so removing one takes it out of the roster and
 *     changes nothing about the creator.
 *
 * The two are segments rather than one merged list because merging them would
 * have to drop, per row, whichever columns the other half does not have — the
 * profiling status on one side, the rate card and multi-category on the other —
 * and a roster whose columns mean different things per row is worse than two
 * honest lists. The counts sit in the segment labels so the total is readable
 * without switching.
 *
 * This wrapper owns nothing else: both segments are components that already
 * existed or already serve another screen, and the choice of segment is a
 * per-person view preference, so it is remembered in `localStorage` exactly as
 * Tracked Accounts' is.
 */

import { useEffect, useState } from 'react'
import { TabStrip } from './ui'
import CreatorRoster from './CreatorRoster'
import LinkedCreatorList from './LinkedCreatorList'
import { useCreatorLinks } from './useCreatorLinks'

type Segment = 'own' | 'saved'

export interface MyCreatorsViewProps {
  orgId: string
  /** Open the Add KOL flow. */
  onAddCreator: () => void
  /** Open a creator this org profiled itself. */
  onOpenCreator: (creatorId: string) => void
  /** Follow one profiling run. */
  onOpenProfiling: (creatorId: string) => void
  /** Open a creator from the commercial KOL database. */
  onOpenRosterCreator: (kolId: string) => void
  /** The way to the Creator Database, from the saved half's empty state. */
  onGoToDatabase: () => void
  /** Hand a creator to Smart Discovery as its reference. */
  onFindSimilar: (id: string, source: 'creator' | 'roster') => void
}

const storageKey = (orgId: string) => `autometric:discover:mycreators-segment:${orgId}`

export default function MyCreatorsView({
  orgId, onAddCreator, onOpenCreator, onOpenProfiling, onOpenRosterCreator,
  onGoToDatabase, onFindSimilar,
}: MyCreatorsViewProps) {
  // Default first so server and first client render agree; the stored value is
  // adopted in the effect below.
  const [segment, setSegment] = useState<Segment>('own')
  /**
   * The saved count comes from the link endpoint's own totals rather than from
   * the list below, so the segment label carries a number before anyone has
   * opened that segment — which is the one thing the label is for.
   */
  const links = useCreatorLinks(orgId)

  useEffect(() => {
    try {
      const value = window.localStorage.getItem(storageKey(orgId))
      if (value === 'own' || value === 'saved') setSegment(value)
    } catch { /* private mode */ }
  }, [orgId])

  const choose = (next: Segment) => {
    setSegment(next)
    try { window.localStorage.setItem(storageKey(orgId), next) } catch { /* quota */ }
  }

  const tabs = [
    { id: 'own' as const, label: 'Added by us', icon: 'person_add' },
    {
      id: 'saved' as const,
      label: links.ready
        ? `Saved from the database (${links.counts.roster})`
        : 'Saved from the database',
      icon: 'folder_shared',
    },
  ]

  return (
    <div>
      <div className="mb-4">
        <TabStrip tabs={tabs} value={segment} onChange={choose} />
        <p className="text-[11px] mt-1.5 leading-snug text-[#9ca3af] max-w-[92ch]">
          {segment === 'own'
            ? 'Creators your organization added and profiled itself. This app owns these records, so they carry a profiling status and can be refreshed from here.'
            : 'Creators you saved out of the Creator Database. Their record stays there and stays fresh — removing one from My Creators does not remove the creator.'}
        </p>
      </div>

      {segment === 'own' ? (
        <CreatorRoster
          orgId={orgId}
          embedded
          onAddCreator={onAddCreator}
          onOpenCreator={onOpenCreator}
          onOpenProfiling={onOpenProfiling}
          onFindSimilar={id => onFindSimilar(id, 'creator')}
        />
      ) : (
        <LinkedCreatorList
          orgId={orgId}
          facet="roster"
          onOpenCreator={onOpenCreator}
          onOpenRosterCreator={onOpenRosterCreator}
          onGoToDatabase={onGoToDatabase}
          onFindSimilar={onFindSimilar}
        />
      )}
    </div>
  )
}
