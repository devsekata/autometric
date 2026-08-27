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
import type { SimilarCandidate, SimilarResult } from '@/lib/discover/creatorSimilar'

export interface SmartDiscoveryProps {
  orgId: string
  /** Pre-selected reference, handed over from a creator card or profile. */
  referenceId?: string | null
  /** The shell already draws this segment's title and subtitle. */
  embedded?: boolean
  onOpenCreator: (creatorId: string) => void
  onGoToRoster: () => void
}

const RATE_STEPS: { label: string; value: number }[] = [
  { label: 'Any rate card', value: 0 },
  { label: 'Under 5 juta', value: 5_000_000 },
  { label: 'Under 10 juta', value: 10_000_000 },
  { label: 'Under 25 juta', value: 25_000_000 },
  { label: 'Under 50 juta', value: 50_000_000 },
]

export default function SmartDiscovery({
  orgId, referenceId, embedded, onOpenCreator, onGoToRoster,
}: SmartDiscoveryProps) {
  const [pool, setPool] = useState<CreatorSummary[] | null>(null)
  const [refId, setRefId] = useState<string | null>(referenceId ?? null)
  const [platform, setPlatform] = useState('')
  const [tier, setTier] = useState('')
  const [city, setCity] = useState('')
  const [maxRate, setMaxRate] = useState(0)
  const [cheaper, setCheaper] = useState(false)
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

  useEffect(() => { if (referenceId) setRefId(referenceId) }, [referenceId])

  const search = useCallback(async () => {
    if (!refId) return
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams({ ref: refId, source: 'creator' })
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
  }, [orgId, refId, platform, tier, city, maxRate, cheaper])

  const reference = pool?.find(c => c.id === refId) ?? null

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
        subtitle="Only profiled creators can be used — a reference needs measured numbers to compare against.">
        {pool === null ? (
          <p className="text-[12px] text-[#9ca3af]">Loading your creators…</p>
        ) : pool.length === 0 ? (
          <EmptyState
            icon="person_search"
            title="No profiled creators yet"
            body="Add a creator and let profiling finish — then this screen can use them as a reference."
            action={
              <button type="button" onClick={onGoToRoster} style={PJ}
                className="inline-flex items-center gap-1.5 rounded-lg text-[12px] font-bold px-4 h-9 border bg-[#327488] border-[#327488] text-white hover:bg-[#285D6E] cursor-pointer">
                <span className="material-symbols-outlined text-[16px]">person_add</span>
                Go to My Creators
              </button>
            }
          />
        ) : (
          <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
            {pool.map(c => {
              const on = c.id === refId
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { setRefId(c.id); setResult(null) }}
                  className={`flex items-center gap-2.5 rounded-xl border-2 p-2.5 text-left transition-colors cursor-pointer ${
                    on ? 'border-[#327488] bg-[#f0f7fa]' : 'border-[#e5e7eb] bg-white hover:border-[#A7C8D4]'
                  }`}
                >
                  <span className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0"
                    style={{ background: T.gradient }}>
                    <RosterAvatar src={c.avatarUrl} username={c.username} textClass="text-[11px]" />
                  </span>
                  <span className="min-w-0">
                    <span style={PJ} className="block text-[12.5px] font-extrabold text-[#111827] truncate">
                      {c.displayName || `@${c.username}`}
                    </span>
                    <span className="block text-[10.5px] text-[#9ca3af] truncate">
                      {platformLabel(c.platform)}
                      {c.category ? ` · ${c.category}` : ''}
                      {c.followers !== null ? ` · ${fmtNum(c.followers)}` : ''}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </Section>

      {/* ── 2. constraints ─────────────────────────────────────────────── */}
      {!!pool?.length && (
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
              onClick={() => (refId
                ? search()
                : setError('Pilih satu creator sebagai referensi di langkah 1 dulu.'))}
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
            {reference && (
              <span className="text-[11.5px] text-[#9ca3af]">
                Reference: <span className="font-bold text-[#374151]">
                  {reference.displayName || `@${reference.username}`}
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
                  onOpen={c.source === 'creator' ? () => onOpenCreator(c.id) : null}
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

function RecommendationRow({
  rank, candidate, onOpen,
}: { rank: number; candidate: SimilarCandidate; onOpen: (() => void) | null }) {
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
