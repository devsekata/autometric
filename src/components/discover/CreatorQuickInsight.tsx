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
 * ── Every figure here is measured, or says it is not ───────────────────────
 * This panel used to draw most of itself from `@/lib/discover/kolSample`: a
 * generated audience split, nine generated posts, four generated campaign-
 * history figures and a generated brand-fit verdict, each badged "modelled".
 *
 * The badge was not enough. A reader comparing two creators side by side reads
 * the numbers, not the badges, and "modelled" did not tell them that the
 * on-time rate they were about to act on had been computed from the creator's
 * follower count.
 *
 * So every slot now shows a real reading or says `Belum terukur`, and a section
 * the database cannot answer at all says which data is missing and how much of
 * the roster it covers. Brand fit left entirely: it is the Brand Match Engine's
 * verdict against a saved Brand Profile now, not a property a creator carries
 * alone.
 */

import { useEffect, useMemo } from 'react'
import { PJ, fmtNum, gradientFor } from './ui'
import { ConfidenceBadge } from './credibility'
import { creatorBadges, creatorSignals, cpmOf } from '@/lib/discover/creatorMatch'
import type { KolDirectoryRow } from '@/lib/discover/kolDirectory'
import { MatchBadge, MatchExplanationPanel } from './MatchBadge'
import type { MatchExplanation } from '@/lib/discover/brandMatch/explain'
import type { MeasuredSignals } from '@/lib/discover/brandMatch/measured'
import type { TrackingStatus } from '@/lib/discover/types'

const T = {
  t1: '#111827', t2: '#374151', t3: '#6b7280', t4: '#9ca3af',
  line: '#e5e7eb', soft: '#f3f4f6', wash: '#f0f7fa',
  primary: '#327488', deep: '#285D6E',
} as const

/**
 * What a slot says when the database has no reading for it.
 *
 * One string, used everywhere, so "not measured" is visibly a state rather than
 * looking like a formatting accident. Never "0", never "—" on its own: a dash
 * reads as "nothing to report", and the point is that nobody has looked.
 */
const NOT_MEASURED = 'Belum terukur'

/**
 * A whole section the database cannot answer.
 *
 * Says which data is missing and roughly how much of the roster it covers,
 * rather than "no data" — a reader who knows 24 of 7.000 creators carry an
 * audience analysis understands they are looking at a coverage gap, not at a
 * broken panel or at a creator with a bad audience.
 */
function Unavailable({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg px-2.5 py-2" style={{ background: T.soft }}>
      <span className="material-symbols-outlined text-[15px] mt-px" style={{ color: T.t4 }}>{icon}</span>
      <p className="text-[10.5px] leading-relaxed" style={{ color: T.t3 }}>{text}</p>
    </div>
  )
}

const idrShort = (n: number) =>
  n >= 1_000_000_000 ? `Rp${(n / 1_000_000_000).toFixed(1)} mlr`
    : n >= 1_000_000 ? `Rp${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)} jt`
    : n >= 1_000 ? `Rp${Math.round(n / 1_000)}rb`
    : `Rp${Math.round(n)}`

export default function CreatorQuickInsight({
  creator, match, measured, inShortlist, inCompare, inRoster, tracking, linkBusy,
  onClose, onShortlist, onCompare, onOpenProfile, onCollaborate, onRoster, onTracking,
}: {
  creator: KolDirectoryRow
  /**
   * The Brand Match Engine's verdict on this creator against the workspace's
   * saved Brand Profile, or null when no profile has been saved.
   */
  match: MatchExplanation | null
  /**
   * What the medallion tables actually measured for this creator, from the same
   * server read the match score was computed from. Null while loading, or when
   * the directory was fetched without `?match=1`.
   */
  measured: MeasuredSignals | null
  inShortlist: boolean
  inCompare: boolean
  /** In this organization's My Creators. */
  inRoster: boolean
  /** Whether this organization is monitoring the creator, and how. */
  tracking: TrackingStatus
  /** A roster or tracking write is in flight; both buttons wait it out. */
  linkBusy: boolean
  onClose: () => void
  onShortlist: () => void
  onCompare: () => void
  onOpenProfile: () => void
  /** Absent when this role may not start a collaboration from here. */
  onCollaborate?: () => void
  /**
   * The two organization-wide decisions, added beside the personal ones.
   *
   * Shortlist above is one person's bookmark; these two are the workspace's:
   * adopting a creator into My Creators, and putting them under monitoring. They
   * sit in the same panel because this is the screen where the decision is
   * actually made — the panel exists to answer "is this creator worth keeping",
   * and until now it could only answer it for one reader.
   */
  onRoster: (next: boolean) => void
  /**
   * Advance the monitoring state. The next value is not a parameter because the
   * cycle is one rule and it lives with the writer, not in every button that
   * starts it.
   */
  onTracking: () => void
}) {
  const s = useMemo(() => creatorSignals(creator, measured), [creator, measured])
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
                {/* Connected, not a blue tick — hence a link glyph. */}
                {creator.connected && (
                  <span title="Connected" aria-label="Connected"
                    className="material-symbols-outlined text-[15px]" style={{ color: T.primary }}>
                    link
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

          {/* The verdict, at the top, where the reader looks first.
              The dimensions behind it live in the Brand match section below —
              this used to repeat them here, from the old criteria scorer, so the
              panel showed two different "match" numbers a few hundred pixels
              apart. One number, stated once, explained once. */}
          {match && (
            <div className="mt-3">
              <MatchBadge match={match} />
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3.5 flex flex-col gap-4">
          {/* ── overview ── */}
          <Section title="Creator overview">
            <div className="grid grid-cols-2 gap-2">
              <Fig label="Followers" value={fmtNum(s.followers)} real />
              <Fig label="Engagement rate" value={`${s.erPct.toFixed(2)}%`} real />
              {/* Every one of these is now a real reading or the string "Belum
                  terukur". `Avg. reach` is gone entirely: no reach column exists
                  anywhere on this server, and the figure that stood here was the
                  creator's follower count multiplied by a constant. Views per
                  follower replaces it — the same question, from a real ratio. */}
              <Fig label="Avg. views" value={s.avgViews === null ? NOT_MEASURED : fmtNum(s.avgViews)} real={s.avgViews !== null} />
              <Fig label="Views / follower" value={s.viewsPerFollower === null ? NOT_MEASURED : `${s.viewsPerFollower.toFixed(2)}x`} real={s.viewsPerFollower !== null} />
              <Fig
                label="Growth"
                value={s.growthPct === null ? NOT_MEASURED
                  : `${s.growthPct > 0 ? '+' : ''}${s.growthPct.toFixed(1)}%`}
                real={s.growthPct !== null}
              />
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

          {/* ── audience ──
              Was three generated bar charts: a gender split, an age split and a
              location list, all derived from the creator's id and follower
              count. The age split in particular could never be real —
              `age_gender_breakdown` is NULL in every audience-analysis row and
              the demographics table carries only gender — so it is gone rather
              than rebuilt. What is left is what the pipeline actually measured,
              for the creators it has measured. */}
          <Section title="Audience">
            {measured && (measured.femalePct !== null || measured.cities.length
              || measured.interests.length || measured.audienceQuality !== null) ? (
              <>
                {measured.femalePct !== null && (
                  <Bars rows={[
                    { label: 'Perempuan', pct: Math.round(measured.femalePct) },
                    {
                      label: 'Laki-laki',
                      pct: Math.round(measured.malePct ?? (100 - measured.femalePct)),
                    },
                  ]} />
                )}
                <div className="grid grid-cols-2 gap-2 mt-2.5">
                  <Fig
                    label="Audience quality"
                    value={s.audienceQuality === null ? NOT_MEASURED : String(Math.round(s.audienceQuality))}
                    real={s.audienceQuality !== null}
                  />
                  <Fig
                    label="Authenticity"
                    value={s.authenticity === null ? NOT_MEASURED : `${Math.round(s.authenticity)}%`}
                    real={s.authenticity !== null}
                  />
                </div>
                {measured.cities.length > 0 && (
                  <Line label="Kota teratas" value={
                    measured.cities.slice(0, 2).map(c => `${c.key} ${c.pct}%`).join(' · ')
                  } />
                )}
                {measured.interests.length > 0 && (
                  <Line label="Minat" value={
                    measured.interests.slice(0, 3).map(i => `${i.key} ${i.pct}%`).join(' · ')
                  } />
                )}
                {measured.interestKnownPct !== null && measured.interestKnownPct < 100 && (
                  <p className="text-[10px] mt-1.5 leading-snug" style={{ color: T.t4 }}>
                    Minat terklasifikasi untuk {measured.interestKnownPct}% audiens yang disampel;
                    sisanya tidak terbaca pipeline.
                  </p>
                )}
              </>
            ) : (
              <Unavailable
                icon="group_off"
                text="Belum ada analisis audiens untuk creator ini. Demografi, lokasi dan minat baru terukur untuk 24 dari ~7.000 creator di database."
              />
            )}
          </Section>

          {/* ── content ──
              Nine generated posts, with generated titles, view counts and
              engagement rates, plus a "best content" card. The roster has
              harvested posts for about 50 creators; for everyone else there was
              nothing behind any of it. Posting cadence is the one thing here the
              database can answer, so it is the one thing left. */}
          <Section title="Content">
            {s.postsPerMonth !== null ? (
              <div className="grid grid-cols-2 gap-2">
                <Fig label="Post / bulan" value={s.postsPerMonth.toFixed(1)} real />
                <Fig label="Kategori" value={s.topCategory} real />
              </div>
            ) : (
              <Unavailable
                icon="dynamic_feed"
                text="Belum ada konten creator ini yang dipanen, jadi format, topik dan performa per post belum bisa dihitung."
              />
            )}
          </Section>

          {/* ── campaign history ──
              Was four generated figures — campaigns completed, repeat brands,
              on-time rate, average campaign ER — plus a list of "brands that
              would suit them". None of it existed: there is no campaign history
              table for roster creators anywhere on either server. A buyer acting
              on an invented on-time rate is the worst outcome this whole pass
              exists to prevent. */}
          <Section title="Campaign history">
            <Unavailable
              icon="campaign"
              text="Riwayat campaign creator dari platform KOL belum tersedia di database. Campaign yang kamu jalankan sendiri lewat Ordering tetap tercatat di modul Campaign."
            />
          </Section>

          {/* ── brand match ──
              Was "Brand fit": a number `kolSample` derived from the creator's own
              followers and ER, with a verdict, three generated strengths and two
              generated watch-outs — none of which had any knowledge of the brand
              reading them. Every creator got the same shaped paragraph.

              It is now the Brand Match Engine's real score against this
              workspace's saved Brand Profile, with the dimensions that produced
              it and an honest "not measured" for the ones the database cannot
              answer. No weights are shown; see `./MatchBadge`. */}
          <Section title="Brand match">
            <MatchExplanationPanel match={match} />
          </Section>

        </div>

        {/* ── the next steps ──
            Two rows of personal actions, then the two the whole workspace sees.
            The split is the point: a shortlist is yours, My Creators and
            monitoring are the organization's, and a panel that drew all six
            identically would not say which is which. */}
        <div className="px-4 py-3 border-t flex flex-col gap-2" style={{ borderColor: T.line }}>
          <div className="grid grid-cols-2 gap-2">
            <Action icon={inShortlist ? 'bookmark_added' : 'bookmark_add'}
              label={inShortlist ? 'Di shortlist' : 'Add to Shortlist'}
              on={inShortlist} onClick={onShortlist} />
            <Action icon="compare" label={inCompare ? 'Di Compare' : 'Compare'}
              on={inCompare} onClick={onCompare} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Action icon={inRoster ? 'folder_shared' : 'create_new_folder'}
              label={inRoster ? 'Di My Creators' : 'Add to My Creators'}
              title={inRoster
                ? 'Creator ini ada di roster kerja organisasi. Klik untuk mengeluarkannya — datanya tetap ada di Creator Database.'
                : 'Simpan creator ini ke roster kerja organisasi.'}
              on={inRoster} disabled={linkBusy} onClick={() => onRoster(!inRoster)} />
            <Action
              icon={tracking === 'active' ? 'pause_circle' : tracking === 'paused' ? 'play_circle' : 'monitor_heart'}
              label={tracking === 'active' ? 'Pause Tracking' : tracking === 'paused' ? 'Resume Tracking' : 'Start Tracking'}
              title={tracking === 'none'
                ? 'Pantau perubahan performa creator ini dari Tracked Accounts.'
                : 'Ubah status pemantauan creator ini.'}
              on={tracking === 'active'} disabled={linkBusy} onClick={onTracking} />
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
  icon, label, onClick, primary, on, title, disabled,
}: {
  icon: string; label: string; onClick: () => void
  primary?: boolean; on?: boolean; title?: string
  /** A write is in flight. The button greys rather than queueing a second one. */
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        ...PJ,
        background: primary ? T.primary : on ? T.wash : '#fff',
        color: primary ? '#fff' : on ? T.deep : T.t2,
        borderColor: primary ? T.primary : on ? '#A7C8D4' : T.line,
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
      className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border text-[11.5px] font-bold transition-colors hover:opacity-90"
    >
      <span className="material-symbols-outlined text-[15px]">{icon}</span>
      {label}
    </button>
  )
}
