'use client'

/**
 * The quick insight panel — one creator, read without leaving the list.
 *
 * The directory's job is to narrow a roster to a shortlist, and that means
 * looking at a lot of creators briefly. Opening the full profile for each is the
 * wrong shape for that: it costs a navigation, loses the search you built, and
 * shows ten times more than the question "is this one worth keeping?" needs.
 *
 * So this is a side panel over the results. It answers the five questions in the
 * order they are actually asked — how big, who follows them, what do they post,
 * do they fit us, have they done this before — and ends in the four things you
 * might do next. The list stays behind it, so dismissing this puts you back
 * exactly where you were.
 *
 * Every modelled figure carries its badge, and the sections that are entirely
 * modelled say so once at the top rather than badging every line. That split
 * follows `SIGNAL_BASIS`: followers, engagement, verification and the rate card
 * are real; reach, growth, audience and brand fit are derived from them.
 */

import { useEffect, useMemo } from 'react'
import { PJ, fmtNum, gradientFor } from './ui'
import { ConfidenceBadge } from './credibility'
import { creatorBadges, creatorSignals, cpmOf } from '@/lib/discover/creatorMatch'
import { sampleIntel } from '@/lib/discover/kolSample'
import type { KolDirectoryRow } from '@/lib/discover/kolDirectory'
import type { MatchResult } from '@/lib/discover/creatorMatch'

const T = {
  t1: '#111827', t2: '#374151', t3: '#6b7280', t4: '#9ca3af',
  line: '#e5e7eb', soft: '#f3f4f6', wash: '#f0f7fa',
  primary: '#327488', deep: '#285D6E',
} as const

const idrShort = (n: number) =>
  n >= 1_000_000_000 ? `Rp${(n / 1_000_000_000).toFixed(1)} mlr`
    : n >= 1_000_000 ? `Rp${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)} jt`
    : n >= 1_000 ? `Rp${Math.round(n / 1_000)}rb`
    : `Rp${Math.round(n)}`

export default function CreatorQuickInsight({
  creator, match, inShortlist, inCompare,
  onClose, onShortlist, onCompare, onOpenProfile, onCollaborate,
}: {
  creator: KolDirectoryRow
  /** The score from the active criteria, when there are any. */
  match: MatchResult | null
  inShortlist: boolean
  inCompare: boolean
  onClose: () => void
  onShortlist: () => void
  onCompare: () => void
  onOpenProfile: () => void
  /** Absent when this role may not start a collaboration from here. */
  onCollaborate?: () => void
}) {
  const s = useMemo(() => creatorSignals(creator), [creator])
  const intel = useMemo(() => sampleIntel(creator), [creator])
  const badges = useMemo(() => creatorBadges(s), [s])

  // Escape closes, like every other overlay in the module.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const cpm = cpmOf(s)

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: 'rgba(17,24,39,.35)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Insight ${creator.username}`}
    >
      <aside
        onClick={e => e.stopPropagation()}
        className="w-full max-w-[420px] h-full bg-white flex flex-col shadow-[0_26px_56px_rgba(30,74,88,.18)]"
      >
        {/* ── identity ── */}
        <div className="px-4 pt-4 pb-3 border-b" style={{ borderColor: T.line }}>
          <div className="flex items-start gap-3">
            <span className="w-12 h-12 rounded-full flex-shrink-0"
              style={{ background: gradientFor(creator.id) }} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span style={{ ...PJ, color: T.t1 }} className="text-[15px] font-extrabold truncate">
                  @{creator.username}
                </span>
                {creator.verified && (
                  <span className="material-symbols-outlined text-[15px]" style={{ color: T.primary }}>
                    verified
                  </span>
                )}
              </div>
              <span className="block text-[11px]" style={{ color: T.t4 }}>
                {[creator.platform, creator.tier, creator.city].filter(Boolean).join(' · ') || '—'}
              </span>
            </div>
            <button type="button" onClick={onClose} aria-label="Tutup"
              className="w-7 h-7 rounded-lg inline-flex items-center justify-center hover:bg-[#f3f4f6]"
              style={{ color: T.t4 }}>
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          {badges.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {badges.map(b => (
                <span key={b.id} style={{
                  ...PJ,
                  background: b.weight === 'strong' ? T.wash : T.soft,
                  color: b.weight === 'strong' ? T.deep : T.t3,
                }} className="inline-flex items-center gap-1 rounded-full px-2 h-[22px] text-[10px] font-bold">
                  <span className="material-symbols-outlined text-[12px]">{b.icon}</span>
                  {b.label}
                </span>
              ))}
            </div>
          )}

          {/* Why this creator scored what it did against the active criteria. */}
          {match && (
            <div className="mt-3 rounded-xl border px-3 py-2.5" style={{ borderColor: T.line }}>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span style={{ ...PJ, color: T.t2 }} className="text-[11px] font-bold">
                  Match dengan kriteriamu
                </span>
                <span style={{ ...PJ, color: T.deep }} className="text-[17px] font-extrabold tabular-nums">
                  {match.overall}%
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {match.parts.map(p => (
                  <div key={p.label} className="flex items-center gap-2">
                    <span className="text-[10.5px] flex-1 min-w-0 truncate" style={{ color: T.t3 }}>
                      {p.label}
                      {p.basis === 'modelled' && <span style={{ color: T.t4 }}> · estimasi</span>}
                    </span>
                    <span className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: T.soft }}>
                      <span className="block h-full rounded-full"
                        style={{ width: `${p.pct}%`, background: T.primary }} />
                    </span>
                    <b style={{ ...PJ, color: T.t2 }} className="text-[10.5px] tabular-nums w-8 text-right">
                      {p.pct}%
                    </b>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3.5 flex flex-col gap-4">
          {/* ── overview ── */}
          <Section title="Creator overview">
            <div className="grid grid-cols-2 gap-2">
              <Fig label="Followers" value={fmtNum(s.followers)} real />
              <Fig label="Engagement rate" value={`${s.erPct.toFixed(2)}%`} real />
              <Fig label="Avg. views" value={fmtNum(s.avgViews)} />
              <Fig label="Avg. reach" value={fmtNum(s.avgReach)} />
              <Fig label="Growth / bln" value={`${s.growthMonthly > 0 ? '+' : ''}${s.growthMonthly.toFixed(1)}%`} />
              <Fig label="Tier" value={creator.tier ?? '—'} real />
            </div>
            {s.rateFrom != null && (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg px-2.5 py-2"
                style={{ background: T.soft }}>
                <span className="text-[10.5px]" style={{ color: T.t3 }}>
                  Rate mulai · {s.rateCount} deliverable
                </span>
                <span style={{ ...PJ, color: T.t1 }} className="text-[11.5px] font-extrabold tabular-nums">
                  {idrShort(s.rateFrom)}
                  {cpm !== null && (
                    <span className="font-semibold" style={{ color: T.t4 }}>
                      {' '}· {idrShort(cpm)}/1rb foll
                    </span>
                  )}
                </span>
              </div>
            )}
          </Section>

          {/* ── audience ── */}
          <Section title="Audience" modelled>
            <Bars rows={intel.audience.gender} />
            <div className="h-2" />
            <Bars rows={intel.audience.age.slice(0, 3)} />
            <div className="grid grid-cols-2 gap-2 mt-2.5">
              <Fig label="Audience quality" value={`${s.audienceQuality}`} />
              <Fig label="Authenticity" value={`${s.authenticity}%`} />
            </div>
            {intel.audience.location[0] && (
              <Line label="Lokasi teratas" value={
                intel.audience.location.slice(0, 2).map(l => `${l.label} ${l.pct}%`).join(' · ')
              } />
            )}
            {intel.audience.interests.length > 0 && (
              <Line label="Minat" value={intel.audience.interests.slice(0, 3).join(' · ')} />
            )}
          </Section>

          {/* ── content ── */}
          <Section title="Content" modelled>
            <Line label="Format terkuat" value={intel.content.formats[0]?.label ?? '—'} />
            <Line label="Topik utama"
              value={intel.content.topics.slice(0, 3).map(t => t.label).join(' · ') || '—'} />
            {intel.content.top[0] && (
              <div className="mt-2 rounded-lg border px-2.5 py-2" style={{ borderColor: T.line }}>
                <span style={{ ...PJ, color: T.t4 }}
                  className="block text-[10px] font-bold uppercase tracking-widest">
                  Konten terbaik
                </span>
                <p className="text-[11.5px] mt-0.5 line-clamp-2" style={{ color: T.t2 }}>
                  {intel.content.top[0].title}
                </p>
                <span className="text-[10px]" style={{ color: T.t4 }}>
                  {fmtNum(intel.content.top[0].views)} views · ER {intel.content.top[0].erPct.toFixed(1)}%
                </span>
              </div>
            )}
          </Section>

          {/* ── brand fit ── */}
          <Section title="Brand fit" modelled>
            <div className="flex items-baseline gap-2 mb-1.5">
              <span style={{ ...PJ, color: T.deep }} className="text-[22px] font-extrabold tabular-nums">
                {s.brandFit}
              </span>
              <span className="text-[11px]" style={{ color: T.t3 }}>{intel.brandFit.verdict}</span>
            </div>
            <Bars rows={intel.brandFit.bars} />
            {intel.brandFit.strengths[0] && (
              <Line label="Kekuatan" value={intel.brandFit.strengths.slice(0, 2).join(' · ')} />
            )}
            {intel.brandFit.watchouts[0] && (
              <Line label="Perlu dicek" value={intel.brandFit.watchouts[0]} />
            )}
          </Section>

          {/* ── campaign history ── */}
          <Section title="Campaign" modelled>
            <div className="grid grid-cols-2 gap-2">
              <Fig label="Campaign selesai" value={String(intel.collaboration.completed)} />
              <Fig label="Repeat brand" value={String(intel.collaboration.repeat)} />
              <Fig label="Tepat waktu" value={`${intel.collaboration.onTimePct}%`} />
              <Fig label="Avg. ER campaign" value={`${intel.collaboration.avgCampaignErPct.toFixed(1)}%`} />
            </div>
            {intel.suggestedBrands.length > 0 && (
              <Line label="Cocok untuk brand seperti"
                value={intel.suggestedBrands.slice(0, 3).join(' · ')} />
            )}
          </Section>
        </div>

        {/* ── the four next steps ── */}
        <div className="px-4 py-3 border-t flex flex-col gap-2" style={{ borderColor: T.line }}>
          <div className="grid grid-cols-2 gap-2">
            <Action icon={inShortlist ? 'bookmark_added' : 'bookmark_add'}
              label={inShortlist ? 'Di shortlist' : 'Add to Shortlist'}
              on={inShortlist} onClick={onShortlist} />
            <Action icon="compare" label={inCompare ? 'Di Compare' : 'Compare'}
              on={inCompare} onClick={onCompare} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Action icon="open_in_new" label="View Full Profile" onClick={onOpenProfile} />
            {onCollaborate
              ? <Action icon="handshake" label="Start Collaboration" primary onClick={onCollaborate} />
              : <span />}
          </div>
        </div>
      </aside>
    </div>
  )
}

/* ── bits ─────────────────────────────────────────────────────────────────── */

function Section({
  title, modelled, children,
}: { title: string; modelled?: boolean; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span style={{ ...PJ, color: T.t4 }} className="text-[10px] font-bold uppercase tracking-widest">
          {title}
        </span>
        {/* Badged once per section rather than per line: every figure below a
            modelled heading is modelled, and six badges would be noise. */}
        {modelled && (
          <ConfidenceBadge confidence="estimated" compact
            basis="Roster komersial tidak menyimpan kolom ini. Angka diturunkan dari follower dan engagement rate yang nyata, deterministik per creator." />
        )}
        <span className="flex-1 h-px" style={{ background: T.soft }} />
      </div>
      {children}
    </section>
  )
}

function Fig({ label, value, real }: { label: string; value: string; real?: boolean }) {
  return (
    <div className="rounded-lg border px-2.5 py-1.5" style={{ borderColor: T.line }}>
      <span className="block text-[9.5px] uppercase tracking-wider" style={{ color: T.t4 }}>
        {label}
      </span>
      <span style={{ ...PJ, color: real ? T.t1 : T.t2 }}
        className="block text-[13px] font-extrabold tabular-nums mt-0.5">
        {value}
      </span>
    </div>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mt-1.5">
      <span className="text-[10.5px] flex-shrink-0" style={{ color: T.t4 }}>{label}</span>
      <span className="text-[11px] text-right" style={{ color: T.t2 }}>{value}</span>
    </div>
  )
}

function Bars({ rows }: { rows: { label: string; pct: number }[] }) {
  return (
    <div className="flex flex-col gap-1">
      {rows.map(r => (
        <div key={r.label} className="flex items-center gap-2">
          <span className="text-[10.5px] w-24 flex-shrink-0 truncate" style={{ color: T.t3 }}>
            {r.label}
          </span>
          <span className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: T.soft }}>
            <span className="block h-full rounded-full"
              style={{ width: `${r.pct}%`, background: T.primary }} />
          </span>
          <b style={{ ...PJ, color: T.t2 }} className="text-[10.5px] tabular-nums w-9 text-right">
            {r.pct}%
          </b>
        </div>
      ))}
    </div>
  )
}

function Action({
  icon, label, onClick, primary, on,
}: { icon: string; label: string; onClick: () => void; primary?: boolean; on?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...PJ,
        background: primary ? T.primary : on ? T.wash : '#fff',
        color: primary ? '#fff' : on ? T.deep : T.t2,
        borderColor: primary ? T.primary : on ? '#A7C8D4' : T.line,
      }}
      className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border text-[11.5px] font-bold transition-colors hover:opacity-90"
    >
      <span className="material-symbols-outlined text-[15px]">{icon}</span>
      {label}
    </button>
  )
}
