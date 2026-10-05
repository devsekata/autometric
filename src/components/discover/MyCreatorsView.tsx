'use client'

/**
 * My Creators — the organization's working roster.
 *
 * Every creator here is a KOL-database creator this workspace chose: added by
 * Add KOL or saved out of the Creator Database with Add to My Creators. Their
 * record stays on the KOL server where it is kept fresh; what this org holds is
 * a link (`agency_kol_accounts`, read through `/discover/links`), so removing
 * one takes it out of the roster and changes nothing about the creator.
 *
 * The list is `LinkedCreatorList` on its `roster` facet
 * (`/discover/links/creators?facet=roster`), and a card opens the creator's
 * directory profile (`/discover/kol-directory/[kolId]`).
 *
 * This screen used to carry a second "Added by us" segment over the warehouse
 * `discover_creators` copy. That copy is switched off — every endpoint behind it
 * answers "unavailable" — so the segment is gone and this is the one list.
 */

import LinkedCreatorList from './LinkedCreatorList'
import { useCreatorLinks } from './useCreatorLinks'

export interface MyCreatorsViewProps {
  orgId: string
  /**
   * Required by `LinkedCreatorList` for links whose source is not `roster`.
   * `/discover/links` only returns `roster` links today, so it is not reached.
   */
  onOpenCreator: (creatorId: string) => void
  /** Open a creator's directory profile. */
  onOpenRosterCreator: (kolId: string) => void
  /** The way to the Creator Database, from the empty state. */
  onGoToDatabase: () => void
  /** Hand a creator to Smart Discovery as its reference. */
  onFindSimilar: (id: string, source: 'creator' | 'roster') => void
}

export default function MyCreatorsView({
  orgId, onOpenCreator, onOpenRosterCreator, onGoToDatabase, onFindSimilar,
}: MyCreatorsViewProps) {
  /**
   * The count comes from the link endpoint's own totals rather than from the
   * list below, so it is there before the list has loaded.
   */
  const links = useCreatorLinks(orgId)

  return (
    <div>
      <div className="mb-4">
        <p className="text-[11px] leading-snug text-[#9ca3af] max-w-[92ch]">
          {links.ready ? `${links.counts.roster} creators · ` : ''}
          Creators your organization added or saved from the Creator Database. Their record stays there and stays
          fresh — removing one from My Creators does not remove the creator.
        </p>
      </div>

      <LinkedCreatorList
        orgId={orgId}
        facet="roster"
        onOpenCreator={onOpenCreator}
        onOpenRosterCreator={onOpenRosterCreator}
        onGoToDatabase={onGoToDatabase}
        onFindSimilar={onFindSimilar}
      />
    </div>
  )
}
