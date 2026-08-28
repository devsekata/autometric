'use client'

/**
 * The Discovery landing strip — four shelves of real creators, above the
 * Creator Database's own search and filters.
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
 */

import { useEffect, useState } from 'react'
import { PJ, TOKENS as T, fmtNum, RosterAvatar, Spinner } from './ui'
import { platformLabel } from '@/lib/discover/creatorInput'
import type { KolDirectoryRow } from '@/lib/discover/kolDirectory'
import type { SimilarResult } from '@/lib/discover/creatorSimilar'

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
}

const SHELF_SIZE = 6

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
}: DiscoverHubProps) {
  const [recommended, setRecommended] = useState<HubCard[] | null>(null)
  /** The creator `Recommended for you` was built from, named on the shelf. */
  const [refName, setRefName] = useState<string | null>(null)
  const [added, setAdded] = useState<HubCard[] | null>(null)
  const [updated, setUpdated] = useState<HubCard[] | null>(null)
  const [popular, setPopular] = useState<HubCard[] | null>(null)

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

  return (
    <div className="mb-6">
      <Shelf
        title="Recommended for you"
        icon="auto_awesome"
        subtitle={refName
          ? `Creators across the database that resemble ${refName}, the most recently added creator.`
          : 'Creators that resemble the most recently added creator in the database.'}
        cards={recommended}
        empty="Nothing scored high enough against the most recently added creator."
        action={{ label: 'Open Smart Discovery', onClick: onGoToSmart }}
        onOpen={open}
        onFindSimilar={onFindSimilar}
      />
      <Shelf
        title="Recently added"
        icon="person_add"
        subtitle="The creators most recently added to the Creator Database."
        cards={added}
        empty="No creators have been added to the database yet."
        onOpen={open}
        onFindSimilar={onFindSimilar}
      />
      <Shelf
        title="Recently updated"
        icon="update"
        subtitle="Creators in the database whose numbers were refreshed most recently."
        cards={updated}
        empty="No refreshed creators to show."
        onOpen={open}
        onFindSimilar={onFindSimilar}
      />
      <Shelf
        title="Popular creators"
        icon="trending_up"
        subtitle="The largest audiences in the Creator Database."
        cards={popular}
        empty="The Creator Database could not be reached."
        onOpen={open}
        onFindSimilar={onFindSimilar}
      />
    </div>
  )
}

/* ── one shelf ────────────────────────────────────────────────────────────── */

function Shelf({
  title, icon, subtitle, cards, empty, action, onOpen, onFindSimilar,
}: {
  title: string
  icon: string
  subtitle: string
  /** Null while loading — an empty array is a loaded shelf with nothing in it. */
  cards: HubCard[] | null
  empty: string
  action?: { label: string; onClick: () => void }
  onOpen: (c: HubCard) => void
  onFindSimilar: (id: string, source: CardSource) => void
}) {
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
            <HubCardView key={`${c.source}-${c.id}`} card={c}
              onOpen={() => onOpen(c)} onFindSimilar={() => onFindSimilar(c.id, c.source)} />
          ))}
        </div>
      )}
    </section>
  )
}

/* ── one card ─────────────────────────────────────────────────────────────── */

function HubCardView({
  card: c, onOpen, onFindSimilar,
}: { card: HubCard; onOpen: () => void; onFindSimilar: () => void }) {
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
      {/* Find Similar rides every card, so "more like this one" is one press
          from anywhere a creator is shown — not only from inside their profile. */}
      <span
        onClick={e => { e.stopPropagation(); onFindSimilar() }}
        title="Find similar creators"
        className="material-symbols-outlined absolute top-2 right-2 text-[16px] text-[#c4cbd4] hover:text-[#6b5bb5] opacity-0 group-hover:opacity-100 transition-opacity"
      >
        auto_awesome
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
