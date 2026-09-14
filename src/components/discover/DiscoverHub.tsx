'use client'

/**
 * The Discovery dashboard — what this workspace has, what is new in the
 * database, and four shelves of real creators, above the Creator Database's own
 * search and filters.
 *
 * Discovery used to open straight onto the database grid, which is a fine place
 * to *search* and a poor place to *arrive*: it answers a question you have not
 * asked yet. These four shelves answer the questions people actually open
 * Discovery with — who is new, who moved, who is big, and who looks like the
 * creators we already work with — and every card is a way into a profile.
 *
 * Nothing here has its own endpoint. Each shelf is one of the existing list
 * APIs asked a different question, which is why this file has no SQL and no
 * route: `Popular` is the directory sorted by followers, `Recently updated` is
 * the same list sorted by refresh time, `Recently added` is it sorted by when
 * the row appeared, and `Recommended` is the similarity search seeded with the
 * newest of those.
 *
 * All four read the KOL database, which is where creators actually live. An
 * earlier cut built the bottom two from `discover_creators` in the warehouse —
 * the org's own roster — which made the landing say "no creators yet" for any
 * org that had not adopted anybody, while 7.7k creators sat in the database it
 * was not asking. The roster is a different concept (My Creators) and has its
 * own screen; the Discovery landing is about the database.
 *
 * ── The summary row ─────────────────────────────────────────────────────────
 * Five figures, and still no endpoint of its own: `Total`, `Recently added` and
 * `Recently updated` are the directory list asked for one row and read for its
 * `total`, using the `createdAfter` / `refreshedAfter` params it already
 * supports; `In My Creators` and `Tracked` come from the link endpoint's own
 * counts. Every number is therefore a count the database performed, not a length
 * of something loaded to be measured — and there is nothing here to keep in step
 * with the screens the figures link to, because they are the same queries.
 */

import { useCallback, useEffect, useState } from 'react'
import { PJ, TOKENS as T, fmtNum, RosterAvatar, Spinner } from './ui'
import { useCreatorLinks } from './useCreatorLinks'
import { platformLabel } from '@/lib/discover/creatorInput'
import type { KolDirectoryRow } from '@/lib/discover/kolDirectory'
import type { SimilarResult } from '@/lib/discover/creatorSimilar'
import type { TrackingStatus } from '@/lib/discover/types'

/** Where a card goes when pressed — the two profiles live on different pages. */
type CardSource = 'creator' | 'roster'

interface HubCard {
  id: string
  source: CardSource
  username: string
  displayName: string | null
  avatarUrl: string | null
  platform: string | null
  category: string | null
  followers: number | null
  erPct: number | null
  /** The one line under the shelf title's own reason for this card, if any. */
  note: string | null
}

export interface DiscoverHubProps {
  orgId: string
  onOpenCreator: (creatorId: string) => void
  onOpenRosterCreator: (kolId: string) => void
  onFindSimilar: (kolId: string, source: CardSource) => void
  onGoToSmart: () => void
  /**
   * Search the Creator Database from here.
   *
   * The route has always read `?q=` and seeded the database screen with it; what
   * was missing was anything that wrote the parameter, so the seed could only
   * ever arrive from a hand-typed URL. This is the writer.
   */
  onSearch: (query: string) => void
  /** The three sibling screens, for the quick-navigation row. */
  onGoToDatabase: () => void
  onGoToMine: () => void
  onGoToTracked: () => void
}

const SHELF_SIZE = 6

/** How far back "recently" reaches, for the two summary figures that use it. */
const RECENT_DAYS = 30

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

const fromRow = (r: KolDirectoryRow, note: string | null = null): HubCard => ({
  id: r.id,
  source: 'roster',
  username: r.username,
  // The roster carries no display name; the handle is the whole identity.
  displayName: null,
  avatarUrl: r.avatarUrl,
  platform: r.platform,
  category: r.categories[0] ?? null,
  followers: r.followers,
  erPct: r.erPct,
  note,
})

export default function DiscoverHub({
  orgId, onOpenCreator, onOpenRosterCreator, onFindSimilar, onGoToSmart,
  onSearch, onGoToDatabase, onGoToMine, onGoToTracked,
}: DiscoverHubProps) {
  const [recommended, setRecommended] = useState<HubCard[] | null>(null)
  /** The creator `Recommended for you` was built from, named on the shelf. */
  const [refName, setRefName] = useState<string | null>(null)
  const [added, setAdded] = useState<HubCard[] | null>(null)
  const [updated, setUpdated] = useState<HubCard[] | null>(null)
  const [popular, setPopular] = useState<HubCard[] | null>(null)
  /** The three database-side figures, null until each count lands. */
  const [totals, setTotals] = useState<{ all: number | null; added: number | null; updated: number | null }>(
    { all: null, added: null, updated: null })
  const [query, setQuery] = useState('')

  /** My Creators and tracking — the org's own two figures, and the card actions. */
  const links = useCreatorLinks(orgId)

  /* ── the summary row ─────────────────────────────────────────────────── */
  useEffect(() => {
    let alive = true
    /**
     * One row asked for, one number read. `pageSize=1` because the count comes
     * from `COUNT(*) OVER()` in the same statement — the rows are the part that
     * is not wanted here, and asking for none of them is not an option the API
     * offers.
     */
    const count = (qs: string, set: (n: number) => void) =>
      fetch(`/api/organizations/${orgId}/discover/kol-directory?${qs}&pageSize=1`)
        .then(r => r.json())
        .then(d => { if (alive && typeof d.total === 'number') set(d.total) })
        // A figure that cannot be read renders as an em dash, rather than as a
        // zero that would read as an answer.
        .catch(() => { /* stays null */ })

    count('', n => setTotals(t => ({ ...t, all: n })))
    count(`createdAfter=${daysAgo(RECENT_DAYS)}`, n => setTotals(t => ({ ...t, added: n })))
    count(`refreshedAfter=${daysAgo(RECENT_DAYS)}`, n => setTotals(t => ({ ...t, updated: n })))
    return () => { alive = false }
  }, [orgId])

  /* ── the two database shelves ───────────────────────────────────────── */
  useEffect(() => {
    let alive = true
    const shelf = (qs: string, set: (v: HubCard[]) => void) =>
      fetch(`/api/organizations/${orgId}/discover/kol-directory?${qs}&pageSize=${SHELF_SIZE}`)
        .then(r => r.json())
        .then(d => { if (alive) set(((d.rows ?? []) as KolDirectoryRow[]).map(r => fromRow(r))) })
        // A shelf that cannot load renders as empty and is skipped, rather than
        // taking the whole landing down with it — the database sits on a
        // private host, and one unreachable shelf is not a broken page.
        .catch(() => { if (alive) set([]) })

    shelf('sort=recent&dir=desc', setUpdated)
    shelf('sort=followers&dir=desc', setPopular)
    return () => { alive = false }
  }, [orgId])

  /* ── recently added, and the recommendation it seeds ────────────────── */
  useEffect(() => {
    let alive = true
    /**
     * One request answers both shelves: the newest rows in the database are
     * `Recently added`, and the newest of them is what `Recommended for you`
     * compares against — the closest thing to a statement of what this
     * workspace is currently looking at that costs no extra input.
     */
    fetch(`/api/organizations/${orgId}/discover/kol-directory?sort=created&dir=desc&pageSize=${SHELF_SIZE}`)
      .then(r => r.json())
      .then(d => {
        if (!alive) return
        const rows = (d.rows ?? []) as KolDirectoryRow[]
        setAdded(rows.map(r => fromRow(r)))

        const seed = rows[0]
        if (!seed) { setRecommended([]); return }
        setRefName(`@${seed.username}`)
        return fetch(`/api/organizations/${orgId}/discover/creators/similar?ref=${seed.id}&source=roster&limit=${SHELF_SIZE}`)
          .then(r => r.json())
          .then((sim: SimilarResult) => {
            if (!alive) return
            setRecommended((sim.candidates ?? []).slice(0, SHELF_SIZE).map(c => ({
              id: c.id,
              source: c.source === 'creator' ? 'creator' as const : 'roster' as const,
              username: c.username,
              displayName: c.displayName,
              avatarUrl: c.avatarUrl,
              platform: c.platform,
              category: c.categories[0] ?? null,
              followers: c.followers,
              erPct: c.erPct,
              // The reason the ranking already computed, shortened to the one
              // line a card has room for. A recommendation with no stated
              // reason is just a creator, which is what the shelves beside it
              // are for.
              note: c.reasons?.[0] ?? null,
            })))
          })
      })
      .catch(() => { if (alive) { setAdded([]); setRecommended([]) } })
    return () => { alive = false }
  }, [orgId])

  const open = (c: HubCard) =>
    c.source === 'creator' ? onOpenCreator(c.id) : onOpenRosterCreator(c.id)

  /**
   * Save and Track, offered on every card that can carry them.
   *
   * Only for creators from the database: a creator this org profiled itself is
   * already in My Creators by construction, and the endpoint rejects the flag
   * for that source rather than storing one fact in two places.
   */
  const saveable = (c: HubCard) => c.source === 'roster'

  const toggleRoster = useCallback((c: HubCard) => {
    void links.setRoster('roster', c.id, !links.inRoster('roster', c.id))
  }, [links])

  const toggleTracking = useCallback((c: HubCard) => {
    const now = links.trackingOf('roster', c.id)
    void links.setTracking('roster', c.id, now === 'active' ? 'paused' : 'active')
  }, [links])

  const rosterState = useCallback(
    (c: HubCard) => (saveable(c) ? links.inRoster('roster', c.id) : null), [links])
  const trackingState = useCallback(
    (c: HubCard) => (saveable(c) ? links.trackingOf('roster', c.id) : null), [links])

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (q) onSearch(q)
  }

  /** The four card callbacks every shelf gets, so the list is written once. */
  const shelfActions = {
    onOpen: open,
    onFindSimilar,
    onRoster: toggleRoster,
    onTracking: toggleTracking,
    rosterState,
    trackingState,
  }

  return (
    <div className="mb-6">
      {/* Search sits above everything: the shelves answer questions nobody has
          asked yet, and this is where somebody who arrived knowing who they are
          looking for goes. It hands the query to the Creator Database rather
          than searching here, because that screen already has the filters, the
          paging and the result count. */}
      <form onSubmit={submitSearch} className="mb-4 flex items-center gap-2">
        <label className="relative flex items-center flex-1 max-w-[520px]">
          <span className="material-symbols-outlined absolute left-3 text-[18px]" style={{ color: T.t4 }}>search</span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search the Creator Database by name, handle or category..."
            aria-label="Search the Creator Database"
            style={{ ...PJ, borderColor: T.outline }}
            className="h-10 w-full rounded-xl border pl-10 pr-3 text-[12.5px] bg-white outline-none focus:border-[#A7C8D4]"
          />
        </label>
        <button type="submit" style={{ ...PJ, background: T.primary }}
          className="h-10 px-4 rounded-xl text-white text-[12px] font-bold hover:opacity-90 cursor-pointer">
          Search
        </button>
      </form>

      <div className="grid gap-2.5 grid-cols-[repeat(auto-fit,minmax(150px,1fr))] mb-5">
        <Stat icon="database" label="In database" value={totals.all}
          hint="Every active creator in the Creator Database." onClick={onGoToDatabase} />
        <Stat icon="person_add" label={`Added - ${RECENT_DAYS}d`} value={totals.added}
          hint={`Creators added to the database in the last ${RECENT_DAYS} days.`} onClick={onGoToDatabase} />
        <Stat icon="update" label={`Updated - ${RECENT_DAYS}d`} value={totals.updated}
          hint={`Creators whose numbers were refreshed in the last ${RECENT_DAYS} days.`} onClick={onGoToDatabase} />
        <Stat icon="folder_shared" label="In My Creators" value={links.ready ? links.counts.roster : null}
          hint="Creators your organization saved from the database into its working roster."
          onClick={onGoToMine} />
        <Stat icon="monitor_heart" label="Currently tracked" value={links.ready ? links.counts.tracked : null}
          hint={links.counts.paused > 0
            ? `Creators under active monitoring. ${links.counts.paused} more are paused.`
            : 'Creators your organization is monitoring.'}
          onClick={onGoToTracked} />
      </div>

      <Shelf
        title="Recommended for you"
        icon="auto_awesome"
        subtitle={refName
          ? `Creators across the database that resemble ${refName}, the most recently added creator.`
          : 'Creators that resemble the most recently added creator in the database.'}
        cards={recommended}
        empty="Nothing scored high enough against the most recently added creator."
        action={{ label: 'Open Smart Discovery', onClick: onGoToSmart }}
        {...shelfActions}
      />
      <Shelf
        title="Recently added"
        icon="person_add"
        subtitle="The creators most recently added to the Creator Database."
        cards={added}
        empty="No creators have been added to the database yet."
        {...shelfActions}
      />
      <Shelf
        title="Recently updated"
        icon="update"
        subtitle="Creators in the database whose numbers were refreshed most recently."
        cards={updated}
        empty="No refreshed creators to show."
        {...shelfActions}
      />
      <Shelf
        title="Popular creators"
        icon="trending_up"
        subtitle="The largest audiences in the Creator Database."
        cards={popular}
        empty="The Creator Database could not be reached."
        {...shelfActions}
      />

      {/* Where to go next sits last rather than first: the shelves above are the
          answer for somebody who came to look around, and this row is for
          somebody who came to do one specific thing and did not find it on the
          way down. */}
      <section className="mt-1">
        <h3 style={PJ} className="text-[13.5px] font-extrabold text-[#111827] flex items-center gap-1.5 mb-2.5">
          <span className="material-symbols-outlined text-[17px]" style={{ color: T.primary }}>explore</span>
          Where to go next
        </h3>
        <div className="grid gap-2.5 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
          <NavCard icon="search" title="Creator Database"
            body="Search and filter every creator in the database, then compare or save the ones worth keeping."
            onClick={onGoToDatabase} />
          <NavCard icon="folder_shared" title="My Creators"
            body="Your organization's working roster - creators you added yourself, and creators you saved from the database."
            onClick={onGoToMine} />
          <NavCard icon="monitor_heart" title="Tracked Accounts"
            body="The creators you are monitoring, and the brand and competitor accounts this workspace collects posts for."
            onClick={onGoToTracked} />
          <NavCard icon="auto_awesome" title="Smart Discovery"
            body="Start from a creator who already works for you and find the ones that resemble them."
            onClick={onGoToSmart} />
        </div>
      </section>
    </div>
  )
}

/* -- one summary figure --------------------------------------------------- */

function Stat({
  icon, label, value, hint, onClick,
}: {
  icon: string; label: string
  /** Null while loading, and when the count could not be read. */
  value: number | null
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className="text-left rounded-xl border bg-white px-3.5 py-3 transition-all hover:-translate-y-[2px] hover:border-[#A7C8D4] cursor-pointer"
      style={{ borderColor: T.outline, boxShadow: T.shadow }}
    >
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
        style={{ ...PJ, color: T.t4 }}>
        <span className="material-symbols-outlined text-[14px]" style={{ color: T.primary }}>{icon}</span>
        {label}
      </span>
      <span style={PJ} className="block text-[22px] font-extrabold text-[#111827] tabular-nums mt-1 leading-none">
        {/* An em dash, never a zero: "we could not count" and "there are none"
            are different answers and only one of them is a fact. */}
        {value === null ? '\u2014' : value.toLocaleString('id-ID')}
      </span>
    </button>
  )
}

/* -- one quick-navigation card -------------------------------------------- */

function NavCard({
  icon, title, body, onClick,
}: { icon: string; title: string; body: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-xl border bg-white p-3.5 transition-all hover:-translate-y-[2px] hover:border-[#A7C8D4] cursor-pointer"
      style={{ borderColor: T.outline, boxShadow: T.shadow }}
    >
      <span style={PJ} className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-[#111827]">
        <span className="material-symbols-outlined text-[16px]" style={{ color: T.primary }}>{icon}</span>
        {title}
        <span className="material-symbols-outlined text-[15px] ml-auto" style={{ color: T.t4 }}>arrow_forward</span>
      </span>
      <span className="block text-[11px] text-[#9ca3af] mt-1 leading-snug">{body}</span>
    </button>
  )
}

/* ── one shelf ────────────────────────────────────────────────────────────── */

interface ShelfActions {
  onOpen: (c: HubCard) => void
  onFindSimilar: (id: string, source: CardSource) => void
  /** Add to, or remove from, My Creators. */
  onRoster: (c: HubCard) => void
  /** Start, pause or resume monitoring. */
  onTracking: (c: HubCard) => void
  /** In My Creators, or null when this card cannot carry the state. */
  rosterState: (c: HubCard) => boolean | null
  /** Monitoring state, or null when this card cannot carry it. */
  trackingState: (c: HubCard) => TrackingStatus | null
}

function Shelf({
  title, icon, subtitle, cards, empty, action, ...actions
}: {
  title: string
  icon: string
  subtitle: string
  /** Null while loading - an empty array is a loaded shelf with nothing in it. */
  cards: HubCard[] | null
  empty: string
  action?: { label: string; onClick: () => void }
} & ShelfActions) {
  return (
    <section className="mb-5">
      <div className="flex items-end justify-between gap-3 flex-wrap mb-2.5">
        <div className="min-w-0">
          <h3 style={PJ} className="text-[13.5px] font-extrabold text-[#111827] flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[17px]" style={{ color: T.primary }}>{icon}</span>
            {title}
          </h3>
          <p className="text-[11.5px] text-[#9ca3af] mt-0.5 max-w-[80ch] leading-snug">{subtitle}</p>
        </div>
        {action && (
          <button type="button" onClick={action.onClick} style={PJ}
            className="inline-flex items-center gap-1.5 rounded-lg text-[11.5px] font-bold px-3 h-8 border border-[#A7C8D4] bg-white text-[#327488] hover:bg-[#eaf3f6] cursor-pointer flex-shrink-0">
            {action.label}
            <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
          </button>
        )}
      </div>

      {cards === null ? (
        <Spinner label="Memuat…" />
      ) : cards.length === 0 ? (
        <p className="text-[11.5px] text-[#9ca3af] rounded-lg border border-dashed border-[#e5e7eb] px-3 py-2.5">
          {empty}
        </p>
      ) : (
        <div className="grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(215px,1fr))]">
          {cards.map(c => (
            <HubCardView
              key={`${c.source}-${c.id}`}
              card={c}
              onOpen={() => actions.onOpen(c)}
              onFindSimilar={() => actions.onFindSimilar(c.id, c.source)}
              inRoster={actions.rosterState(c)}
              tracking={actions.trackingState(c)}
              onRoster={() => actions.onRoster(c)}
              onTracking={() => actions.onTracking(c)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/* ── one card ─────────────────────────────────────────────────────────────── */

function HubCardView({
  card: c, onOpen, onFindSimilar, inRoster, tracking, onRoster, onTracking,
}: {
  card: HubCard
  onOpen: () => void
  onFindSimilar: () => void
  /** Null when this creator is not one My Creators can hold a link to. */
  inRoster: boolean | null
  tracking: TrackingStatus | null
  onRoster: () => void
  onTracking: () => void
}) {
  const meta = [
    c.platform ? platformLabel(c.platform) : null,
    c.category,
  ].filter(Boolean).join(' · ')

  return (
    <article
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      title={`Open ${c.displayName || `@${c.username}`}`}
      className="group relative rounded-xl border border-[#e5e7eb] bg-white p-3 cursor-pointer transition-all hover:-translate-y-[2px] hover:border-[#A7C8D4]"
      style={{ boxShadow: T.shadow }}
    >
      {/* The card's actions, revealed on hover so the shelf reads as creators
          rather than as a wall of icons. Find Similar rides every card, so
          "more like this one" is one press from anywhere a creator is shown and
          not only from inside their profile; Save and Track ride the ones whose
          creator lives in the database, which is every card except an org's own
          creator arriving through the recommendation shelf. */}
      <span className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        {inRoster !== null && (
          <span
            onClick={e => { e.stopPropagation(); onRoster() }}
            title={inRoster ? 'In My Creators - click to remove' : 'Add to My Creators'}
            className="material-symbols-outlined text-[16px] cursor-pointer hover:text-[#285D6E]"
            style={{ color: inRoster ? T.primaryDeep : '#c4cbd4' }}
          >
            {inRoster ? 'folder_shared' : 'create_new_folder'}
          </span>
        )}
        {tracking !== null && (
          <span
            onClick={e => { e.stopPropagation(); onTracking() }}
            title={
              tracking === 'active' ? 'Tracked - click to pause'
                : tracking === 'paused' ? 'Tracking paused - click to resume'
                : 'Start tracking'
            }
            className="material-symbols-outlined text-[16px] cursor-pointer hover:text-[#2f6d4c]"
            style={{
              color: tracking === 'active' ? '#3d8a5f'
                : tracking === 'paused' ? '#b5761f' : '#c4cbd4',
            }}
          >
            {tracking === 'active' ? 'monitor_heart' : tracking === 'paused' ? 'pause_circle' : 'radar'}
          </span>
        )}
        <span
          onClick={e => { e.stopPropagation(); onFindSimilar() }}
          title="Find similar creators"
          className="material-symbols-outlined text-[16px] text-[#c4cbd4] hover:text-[#6b5bb5] cursor-pointer"
        >
          auto_awesome
        </span>
      </span>

      <div className="flex items-center gap-2.5 mb-2">
        <span className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0"
          style={{ background: T.gradient }}>
          <RosterAvatar src={c.avatarUrl} username={c.username} textClass="text-[11px]" />
        </span>
        <span className="min-w-0">
          <span style={PJ} className="block text-[12.5px] font-extrabold text-[#111827] truncate">
            {c.displayName || `@${c.username}`}
          </span>
          <span className="block text-[10.5px] text-[#9ca3af] truncate">{meta || '—'}</span>
        </span>
      </div>

      <div className="flex items-center gap-3 text-[10.5px]">
        <span className="text-[#6b7280]">
          <span style={PJ} className="font-extrabold text-[#111827] tabular-nums">
            {c.followers !== null ? fmtNum(c.followers) : '—'}
          </span>{' '}followers
        </span>
        <span className="text-[#6b7280]">
          <span style={PJ} className="font-extrabold text-[#111827] tabular-nums">
            {c.erPct !== null ? `${c.erPct.toFixed(2)}%` : '—'}
          </span>{' '}ER
        </span>
      </div>

      {c.note && (
        <p className="text-[10.5px] text-[#6b5bb5] mt-1.5 leading-snug line-clamp-2">{c.note}</p>
      )}
    </article>
  )
}
