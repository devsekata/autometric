'use client'

/**
 * Smart Discovery — recommendations from a reference creator.
 *
 * Basic Discovery is the filter form on the My Creators screen. This is the
 * other half: pick a creator who already works, and let the system read their
 * category, audience size, engagement and topics and go looking for that shape.
 *
 * The controls here are only the things a user can genuinely constrain —
 * platform, tier, location, price. "Similar content style" and "similar
 * audience" are deliberately *not* toggles: they are always part of the score
 * (that is what makes it a similarity search), so offering them as switches
 * would be offering control that does not exist. They are shown as a legend
 * instead, and every recommendation carries the reasons it actually earned.
 */

import { useCallback, useEffect, useState } from 'react'
import { Chip, EmptyState, PJ, TOKENS as T, fmtNum, RosterAvatar, SelectPill } from './ui'
import { CREATOR_PLATFORMS, platformLabel } from '@/lib/discover/creatorInput'
import { LOCATIONS, TIERS } from '@/lib/discover/vocab'
import type { CreatorSummary } from '@/lib/discover/creatorFlow'
import type { KolDirectoryRow } from '@/lib/discover/kolDirectory'
import type { SimilarCandidate, SimilarResult } from '@/lib/discover/creatorSimilar'
import { useDiscoverSelection, selectionKey } from './useDiscoverSelection'

export interface SmartDiscoveryProps {
  orgId: string
  /** Pre-selected reference, handed over from a creator card or profile. */
  referenceId?: string | null
  /**
   * Which list the pre-selected reference lives in. `Find Similar` is offered
   * on Creator Database rows as well as on the org's own creators, and the two
   * ids are looked up in different places — so the entry point has to say which
   * it handed over. Defaults to the org's own roster, which is where the
   * feature started and what a link saved before this existed meant.
   */
  referenceSource?: RefSource | null
  /** The shell already draws this segment's title and subtitle. */
  embedded?: boolean
  onOpenCreator: (creatorId: string) => void
  /**
   * Open a Creator Database result. Separate from `onOpenCreator` because the
   * two live on different pages — an org creator has a profile inside this
   * workspace, a database creator has one in the directory.
   *
   * Without this, every recommendation that came from the database was a dead
   * card: the ranking named creators you could not then go and look at, which
   * is most of what the ranking is for.
   */
  onOpenRosterCreator: (kolId: string) => void
  onGoToRoster: () => void
  /** Where the shortlist is actually read — otherwise `Compare` is a dead end. */
  onGoToCompare: () => void
}

export type RefSource = 'creator' | 'roster'

/**
 * A creator that can be used as a reference, from either list.
 *
 * Smart Discovery is deliberately not limited to the creators this org added:
 * the whole point is to find people you do *not* have yet, and the reference
 * only has to be somebody whose shape you want more of. Anyone in the Creator
 * Database qualifies, so both lists are reduced to this one shape and the
 * picker treats them the same — only `source` differs, and it travels with the
 * id because the two ids are resolved by different queries.
 */
interface RefPick {
  id: string
  source: RefSource
  username: string
  displayName: string | null
  avatarUrl: string | null
  platform: string | null
  category: string | null
  followers: number | null
}

/**
 * The one-line summary under a reference's name.
 *
 * Joined rather than concatenated because every piece is optional on the
 * Creator Database side — the roster's platform, category and follower columns
 * are all nullable — and fixed separators around a missing piece read as a
 * typo (` · · 12K`).
 */
const metaLine = (p: RefPick, suffix?: string): string => [
  p.platform ? platformLabel(p.platform) : null,
  p.category,
  p.followers !== null ? `${fmtNum(p.followers)}${suffix ?? ''}` : null,
].filter(Boolean).join(' · ')

const fromSummary = (c: CreatorSummary): RefPick => ({
  id: c.id,
  source: 'creator',
  username: c.username,
  displayName: c.displayName,
  avatarUrl: c.avatarUrl,
  platform: c.platform,
  category: c.category,
  followers: c.followers,
})

const fromDirectoryRow = (r: KolDirectoryRow): RefPick => ({
  id: r.id,
  source: 'roster',
  // The roster has no display-name column; the handle is the only identity.
  displayName: null,
  username: r.username,
  avatarUrl: r.avatarUrl,
  platform: r.platform,
  category: r.categories[0] ?? null,
  followers: r.followers,
})

const RATE_STEPS: { label: string; value: number }[] = [
  { label: 'Any rate card', value: 0 },
  { label: 'Under 5 juta', value: 5_000_000 },
  { label: 'Under 10 juta', value: 10_000_000 },
  { label: 'Under 25 juta', value: 25_000_000 },
  { label: 'Under 50 juta', value: 50_000_000 },
]

export default function SmartDiscovery({
  orgId, referenceId, referenceSource, embedded, onOpenCreator, onOpenRosterCreator, onGoToRoster,
  onGoToCompare,
}: SmartDiscoveryProps) {
  const [pool, setPool] = useState<CreatorSummary[] | null>(null)
  /**
   * The chosen reference, whichever list it came from.
   *
   * Held as the whole pick rather than as an id because a Creator Database
   * reference is not in any list this screen keeps: it arrives from a search
   * that is later cleared, or straight from a `Find Similar` on another screen.
   * Keeping the row means the summary line can name it without re-fetching.
   */
  const [ref, setRef] = useState<RefPick | null>(null)
  /** Creator Database search, for picking a reference from the full database. */
  const [dbQuery, setDbQuery] = useState('')
  const [dbRows, setDbRows] = useState<RefPick[] | null>(null)
  const [dbBusy, setDbBusy] = useState(false)
  const [platform, setPlatform] = useState('')
  const [tier, setTier] = useState('')
  const [city, setCity] = useState('')
  const [maxRate, setMaxRate] = useState(0)
  const [cheaper, setCheaper] = useState(false)
  /**
   * The Compare shortlist, the same one the Creator Database and Compare share
   * through localStorage.
   *
   * A ranking that names five creators and gives you no way to put two of them
   * side by side stops one step short of the decision it exists to support, so
   * every database-side recommendation can be shortlisted from here. Only those:
   * the shortlist holds tracked accounts and Creator Database creators, and an
   * org's own creator is neither — adding one would write a key Compare cannot
   * resolve.
   */
  const compare = useDiscoverSelection(orgId, 'compare')
  const [result, setResult] = useState<SimilarResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Only profiled creators can be a reference: an unprofiled row has a handle
  // and nothing else, and "creators like this handle" is not a question.
  useEffect(() => {
    let alive = true
    fetch(`/api/organizations/${orgId}/discover/creators?status=ready`)
      .then(r => r.json())
      .then(d => { if (alive) setPool((d.creators ?? []) as CreatorSummary[]) })
      .catch(() => { if (alive) setPool([]) })
    return () => { alive = false }
  }, [orgId])

  /**
   * Resolve a reference handed over by another screen.
   *
   * `Find Similar` on a Creator Database row sends an id this screen has never
   * seen — it is not in `pool`, and the roster is 7.7k rows that are not worth
   * loading to name one of them. So the id is looked up directly, by the same
   * `ids=` the directory API already supports.
   */
  useEffect(() => {
    if (!referenceId) return
    let alive = true
    const source: RefSource = referenceSource === 'roster' ? 'roster' : 'creator'

    if (source === 'creator') {
      // The org's own creators are already being fetched; pick it out of that
      // list once it lands rather than asking for the same row twice.
      const hit = pool?.find(c => c.id === referenceId)
      if (hit) setRef(fromSummary(hit))
      return
    }

    fetch(`/api/organizations/${orgId}/discover/kol-directory?ids=${referenceId}`)
      .then(r => r.json())
      .then(d => {
        const row = (d.rows ?? [])[0] as KolDirectoryRow | undefined
        if (alive && row) setRef(fromDirectoryRow(row))
      })
      .catch(() => { /* The picker still works; the hand-over just did not land. */ })
    return () => { alive = false }
  }, [orgId, referenceId, referenceSource, pool])

  /**
   * Search the complete Creator Database for a reference.
   *
   * Debounced because it runs against 7.7k rows on a private host, and a
   * keystroke is not a question. Below two characters it clears instead of
   * asking, which keeps `q=a` from returning a page of unrelated creators.
   */
  useEffect(() => {
    const q = dbQuery.trim()
    if (q.length < 2) { setDbRows(null); setDbBusy(false); return }
    let alive = true
    setDbBusy(true)
    const t = setTimeout(() => {
      fetch(`/api/organizations/${orgId}/discover/kol-directory?q=${encodeURIComponent(q)}&pageSize=12`)
        .then(r => r.json())
        .then(d => {
          if (!alive) return
          setDbRows(((d.rows ?? []) as KolDirectoryRow[]).map(fromDirectoryRow))
        })
        .catch(() => { if (alive) setDbRows([]) })
        .finally(() => { if (alive) setDbBusy(false) })
    }, 350)
    return () => { alive = false; clearTimeout(t) }
  }, [orgId, dbQuery])

  const search = useCallback(async () => {
    if (!ref) return
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams({ ref: ref.id, source: ref.source })
      if (platform) qs.set('platform', platform)
      if (tier) qs.set('tier', tier)
      if (city) qs.set('city', city)
      if (maxRate) qs.set('maxRate', String(maxRate))
      if (cheaper) qs.set('cheaper', '1')

      const res = await fetch(`/api/organizations/${orgId}/discover/creators/similar?${qs}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'The search could not be completed.')
      setResult(data as SimilarResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }, [orgId, ref, platform, tier, city, maxRate, cheaper])

  const choose = useCallback((pick: RefPick) => {
    setRef(pick)
    // The old recommendations were about a different creator; leaving them on
    // screen under a new reference would read as this reference's answer.
    setResult(null)
    setError('')
  }, [])

  return (
    <div className="max-w-[1100px]">
      {!embedded && (
        <div className="mb-4">
          <h2 style={PJ} className="text-[19px] font-extrabold text-[#111827] tracking-[-0.02em]">
            Smart Discovery
          </h2>
          <p className="text-[12px] text-[#6b7280] mt-1 max-w-[74ch]">
            Pick a creator who already works for you. We read their category, audience size, engagement and recurring
            topics, then rank creators that resemble them — from your own database and from the commercial KOL roster.
          </p>
        </div>
      )}

      {/* ── 1. reference ───────────────────────────────────────────────── */}
      <Section step={1} title="Reference creator"
        subtitle="Any creator in the Creator Database can be the reference — not only the ones your organization added. Search the database, or start from one of your own.">

        {/* The chosen reference, once there is one. Shown above the pickers
            rather than only as a line on the button, because after a search the
            list below is a page of other people and the answer to "who is this
            about" should not be somewhere further down. */}
        {ref && (
          <div className="flex items-center gap-2.5 rounded-xl border-2 border-[#327488] bg-[#f0f7fa] p-2.5 mb-3">
            <span className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0"
              style={{ background: T.gradient }}>
              <RosterAvatar src={ref.avatarUrl} username={ref.username} textClass="text-[12px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span style={PJ} className="block text-[13px] font-extrabold text-[#111827] truncate">
                {ref.displayName || `@${ref.username}`}
              </span>
              <span className="block text-[10.5px] text-[#6b7280] truncate">
                {[
                  metaLine(ref, ' followers'),
                  ref.source === 'creator' ? 'from your creators' : 'from the Creator Database',
                ].filter(Boolean).join(' · ')}
              </span>
            </span>
            <button type="button" onClick={() => { setRef(null); setResult(null) }} style={PJ}
              title="Choose a different reference"
              className="rounded-lg text-[11.5px] font-bold px-2.5 h-8 border border-[#A7C8D4] bg-white text-[#327488] hover:bg-[#eaf3f6] cursor-pointer flex-shrink-0">
              Change
            </button>
          </div>
        )}

        {/* ── search the complete database ───────────────────────────── */}
        <label className="relative block mb-2">
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[17px] text-[#9ca3af] pointer-events-none">
            {dbBusy ? 'progress_activity' : 'search'}
          </span>
          <input
            value={dbQuery}
            onChange={e => setDbQuery(e.target.value)}
            placeholder="Search the Creator Database by name or username…"
            className="w-full rounded-lg border border-[#e5e7eb] bg-white h-9 pl-8 pr-3 text-[12.5px] text-[#111827] placeholder:text-[#c4cbd4] outline-none focus:border-[#A7C8D4]"
          />
        </label>

        {dbRows !== null && (
          dbRows.length === 0 ? (
            <p className="text-[11.5px] text-[#9ca3af] mb-3">
              No creator in the database matches “{dbQuery.trim()}”.
            </p>
          ) : (
            <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(240px,1fr))] mb-3">
              {dbRows.map(r => (
                <RefButton key={`roster-${r.id}`} pick={r} on={ref?.source === 'roster' && ref.id === r.id}
                  onPick={() => choose(r)} />
              ))}
            </div>
          )
        )}

        {/* ── the org's own creators, as quick picks ─────────────────── */}
        <div style={PJ} className="text-[10px] font-bold uppercase tracking-widest text-[#c4cbd4] mb-2 mt-1">
          Your creators
        </div>
        {pool === null ? (
          <p className="text-[12px] text-[#9ca3af]">Loading your creators…</p>
        ) : pool.length === 0 ? (
          /* Not a dead end any more: with the database search above, an org with
             no creators of its own can still run this screen. So this says what
             is missing from *this list* without implying the feature is shut. */
          <div className="rounded-lg border border-dashed border-[#e5e7eb] px-3 py-2.5 flex items-center gap-2 flex-wrap">
            <span className="text-[11.5px] text-[#9ca3af]">
              Your organization has no profiled creators yet — search the database above, or add one.
            </span>
            <button type="button" onClick={onGoToRoster} style={PJ}
              className="inline-flex items-center gap-1.5 rounded-lg text-[11.5px] font-bold px-3 h-8 border border-[#A7C8D4] bg-white text-[#327488] hover:bg-[#eaf3f6] cursor-pointer">
              <span className="material-symbols-outlined text-[15px]">person_add</span>
              My Creators
            </button>
          </div>
        ) : (
          <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
            {pool.map(c => {
              const pick = fromSummary(c)
              return (
                <RefButton key={`creator-${c.id}`} pick={pick}
                  on={ref?.source === 'creator' && ref.id === c.id} onPick={() => choose(pick)} />
              )
            })}
          </div>
        )}
      </Section>

      {/* ── 2. constraints ─────────────────────────────────────────────── */}
      {/* Not gated on the org's own roster any more. Gating it there meant an
          org with no creators of its own could pick a Creator Database
          reference in step 1 and then have nowhere to press — the constraints
          and the search button simply were not rendered. */}
      {(
        <Section step={2} title="What you need"
          subtitle="Similarity in category, audience size, engagement and topics is always part of the ranking. These narrow the field on top of it.">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <div className="w-[170px]">
              <SelectPill icon="payments" label="Rate card" value={maxRate} options={RATE_STEPS}
                onChange={v => setMaxRate(v)} />
            </div>
            <div className="w-[160px]">
              <SelectPill icon="workspace_premium" label="Any tier" value={tier}
                options={[{ label: 'Any tier', value: '' }, ...TIERS.map(t => ({ label: t, value: t as string }))]}
                onChange={v => setTier(v)} />
            </div>
            <div className="w-[170px]">
              <SelectPill icon="location_on" label="Any location" value={city}
                options={[{ label: 'Any location', value: '' }, ...LOCATIONS.map(l => ({ label: l, value: l as string }))]}
                onChange={v => setCity(v)} />
            </div>
            <Chip label="Lower price than the reference" icon="trending_down" on={cheaper}
              onClick={() => setCheaper(v => !v)} />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span style={PJ} className="text-[10px] font-bold uppercase tracking-widest text-[#c4cbd4] mr-1">
              Platform
            </span>
            <Chip label="Same as reference" on={!platform} onClick={() => setPlatform('')} />
            {CREATOR_PLATFORMS.map(p => (
              <Chip key={p.id} icon={p.icon} label={p.label} on={platform === p.id}
                onClick={() => setPlatform(platform === p.id ? '' : p.id)} />
            ))}
          </div>

          <div className="flex items-center gap-2 mt-4">
            {/* Pressable even with nothing selected: a button that does nothing
                when clicked teaches less than one that says what is missing. */}
            <button
              type="button"
              onClick={() => (ref
                ? search()
                : setError('Pilih satu creator sebagai referensi di langkah 1 dulu — dari Creator Database atau dari creator milikmu.'))}
              disabled={loading}
              style={PJ}
              className={`inline-flex items-center gap-1.5 rounded-lg text-[12px] font-bold px-4 h-9 border transition-colors ${
                loading
                  ? 'bg-[#f3f4f6] border-[#f3f4f6] text-[#9ca3af] cursor-wait'
                  : 'bg-[#327488] border-[#327488] text-white hover:bg-[#285D6E] cursor-pointer'
              }`}
            >
              <span className={`material-symbols-outlined text-[16px] ${loading ? 'animate-spin' : ''}`}>
                {loading ? 'progress_activity' : 'hub'}
              </span>
              {loading ? 'Analysing…' : 'Find similar creators'}
            </button>
            {ref && (
              <span className="text-[11.5px] text-[#9ca3af]">
                Reference: <span className="font-bold text-[#374151]">
                  {ref.displayName || `@${ref.username}`}
                </span>
              </span>
            )}
          </div>
        </Section>
      )}

      {error && (
        <div className="rounded-lg bg-[#fdf2f2] border border-[#f3d9d9] px-3 py-2 text-[11.5px] text-[#a04545] mb-4">
          {error}
        </div>
      )}

      {/* ── 3. recommendations ─────────────────────────────────────────── */}
      {result && (
        <Section step={3} title="Recommended creators"
          subtitle={`Ranked by how much of the reference's shape they match. ${
            result.candidates.length
              ? `${result.candidates.length} creator${result.candidates.length === 1 ? '' : 's'} above the cut-off.`
              : ''
          }`}>
          {/* The shortlist is invisible from here otherwise: creators go into it
              one press at a time and it is read on another screen entirely. */}
          {compare.ids.size > 0 && (
            <div className="flex items-center gap-2 flex-wrap rounded-lg bg-[#f0f7fa] border border-[#dbe9ee] px-3 py-2 mb-3">
              <span className="material-symbols-outlined text-[16px] text-[#285D6E]">compare_arrows</span>
              <span className="text-[11.5px] text-[#285D6E]">
                {compare.ids.size} creator{compare.ids.size === 1 ? '' : 's'} in your Compare shortlist.
              </span>
              <button type="button" onClick={onGoToCompare} style={PJ}
                className="ml-auto inline-flex items-center gap-1 rounded-lg text-[11.5px] font-bold px-3 h-7 border border-[#A7C8D4] bg-white text-[#327488] hover:bg-[#eaf3f6] cursor-pointer">
                Open Compare
                <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
              </button>
            </div>
          )}
          {result.candidates.length === 0 ? (
            <EmptyState
              icon="search_off"
              title="No close match"
              body={result.notes[0] ?? 'Nothing scored high enough against this reference. Loosen a constraint, or add more creators to compare against.'}
            />
          ) : (
            <ol className="flex flex-col gap-2.5">
              {result.candidates.map((c, i) => (
                <RecommendationRow
                  key={`${c.source}-${c.id}`}
                  rank={i + 1}
                  candidate={c}
                  onOpen={c.source === 'creator'
                    ? () => onOpenCreator(c.id)
                    : () => onOpenRosterCreator(c.id)}
                  inCompare={c.source === 'roster' && compare.ids.has(selectionKey('roster', c.id))}
                  onCompare={c.source === 'roster'
                    ? () => compare.toggle(selectionKey('roster', c.id))
                    : null}
                />
              ))}
            </ol>
          )}

          {!!result.notes.length && (
            <ul className="mt-4 pt-3 border-t border-[#f3f4f6] flex flex-col gap-1.5">
              {result.notes.map(n => (
                <li key={n} className="flex items-start gap-1.5 text-[11px] text-[#9ca3af]">
                  <span className="material-symbols-outlined text-[13px] mt-px">info</span>
                  {n}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </div>
  )
}

/* ── pieces ───────────────────────────────────────────────────────────────── */

function Section({
  step, title, subtitle, children,
}: { step: number; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#e5e7eb] bg-white p-5 mb-4" style={{ boxShadow: T.shadow }}>
      <div className="flex items-start gap-2.5 mb-3.5">
        <span style={PJ}
          className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#EDF4F7] text-[#285D6E] text-[10px] font-extrabold flex-shrink-0 mt-0.5">
          {step}
        </span>
        <div>
          <h3 style={PJ} className="text-[13px] font-extrabold text-[#111827]">{title}</h3>
          <p className="text-[11.5px] text-[#9ca3af] mt-0.5 max-w-[80ch] leading-snug">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

/**
 * One selectable reference, drawn the same whichever list it came from.
 *
 * The two lists used to be one list, so this was inline. It is a component now
 * because a Creator Database hit and one of the org's own creators have to be
 * indistinguishable to press — the only thing that legitimately differs between
 * them is where they were found, and that is said once on the chosen reference
 * rather than on every card.
 */
function RefButton({
  pick, on, onPick,
}: { pick: RefPick; on: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`flex items-center gap-2.5 rounded-xl border-2 p-2.5 text-left transition-colors cursor-pointer ${
        on ? 'border-[#327488] bg-[#f0f7fa]' : 'border-[#e5e7eb] bg-white hover:border-[#A7C8D4]'
      }`}
    >
      <span className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0"
        style={{ background: T.gradient }}>
        <RosterAvatar src={pick.avatarUrl} username={pick.username} textClass="text-[11px]" />
      </span>
      <span className="min-w-0">
        <span style={PJ} className="block text-[12.5px] font-extrabold text-[#111827] truncate">
          {pick.displayName || `@${pick.username}`}
        </span>
        <span className="block text-[10.5px] text-[#9ca3af] truncate">
          {metaLine(pick)}
        </span>
      </span>
    </button>
  )
}

function RecommendationRow({
  rank, candidate, onOpen, inCompare, onCompare,
}: {
  rank: number
  candidate: SimilarCandidate
  onOpen: (() => void) | null
  inCompare: boolean
  /** Null for an org's own creator, which the shortlist has no population for. */
  onCompare: (() => void) | null
}) {
  const c = candidate
  return (
    <li className="rounded-xl border border-[#e5e7eb] p-3 flex items-start gap-3">
      <span style={PJ}
        className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-[#f9fafb] text-[#9ca3af] text-[11px] font-extrabold flex-shrink-0">
        {rank}
      </span>

      <span className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0"
        style={{ background: T.gradient }}>
        <RosterAvatar src={c.avatarUrl} username={c.username} textClass="text-[12px]" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span style={PJ} className="text-[13px] font-extrabold text-[#111827] truncate">
            {c.displayName || `@${c.username}`}
          </span>
          <span style={PJ} className={`rounded-md text-[9px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 ${
            c.source === 'creator' ? 'bg-[#eaf5ef] text-[#3d8a5f]' : 'bg-[#f3f0fb] text-[#6b5bb5]'
          }`}>
            {c.source === 'creator' ? 'your database' : 'KOL roster'}
          </span>
        </div>

        <p className="text-[11px] text-[#9ca3af] mt-0.5">
          {c.platform ? platformLabel(c.platform) : 'unknown platform'} · @{c.username}
          {c.followers !== null ? ` · ${fmtNum(c.followers)} followers` : ''}
          {c.erPct !== null ? ` · ER ${c.erPct.toFixed(2)}%` : ''}
          {c.city ? ` · ${c.city}` : ''}
        </p>

        <ul className="flex flex-wrap gap-1.5 mt-2">
          {c.reasons.map(r => (
            <li key={r} className="inline-flex items-center gap-1 rounded-full bg-[#f0f7fa] text-[#285D6E] text-[10.5px] font-semibold px-2 py-0.5">
              <span className="material-symbols-outlined text-[12px]">check</span>
              {r}
            </li>
          ))}
          {!c.reasons.length && (
            <li className="text-[10.5px] text-[#c4cbd4]">
              Matched on shape alone — no single rule scored high enough to name.
            </li>
          )}
        </ul>
      </div>

      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
        <span style={PJ} className="text-[15px] font-extrabold text-[#285D6E] tabular-nums">{c.match}%</span>
        {/* What the percentage rests on. Without it, a creator matching on the
            three things we could read looks identical to one matching on six. */}
        <span className="text-[9px] uppercase tracking-wider text-[#9ca3af] font-bold text-right leading-tight"
          title={`${c.signals.judged} of ${c.signals.total} similarity signals could be compared for this creator`}>
          match<br />
          <span className="text-[#c4cbd4]">{c.signals.judged}/{c.signals.total} signals</span>
        </span>
        {onCompare && (
          <button type="button" onClick={onCompare} style={PJ}
            title={inCompare ? 'Remove from the Compare shortlist' : 'Add to the Compare shortlist'}
            className={`inline-flex items-center gap-1 rounded-lg text-[10.5px] font-bold px-2 h-7 border transition-colors cursor-pointer ${
              inCompare
                ? 'bg-[#f0f7fa] border-[#A7C8D4] text-[#285D6E]'
                : 'bg-white border-[#e5e7eb] text-[#6b7280] hover:border-[#A7C8D4]'
            }`}>
            <span className="material-symbols-outlined text-[13px]">{inCompare ? 'check' : 'compare_arrows'}</span>
            {inCompare ? 'In compare' : 'Compare'}
          </button>
        )}
        {onOpen ? (
          <button type="button" onClick={onOpen} style={PJ}
            className="text-[10.5px] font-bold text-[#285D6E] hover:underline cursor-pointer">
            Open profile
          </button>
        ) : c.profileUrl ? (
          <a href={c.profileUrl} target="_blank" rel="noreferrer" style={PJ}
            className="text-[10.5px] font-bold text-[#285D6E] hover:underline">
            Open on platform
          </a>
        ) : null}
      </div>
    </li>
  )
}
