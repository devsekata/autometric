'use client'

/**
 * Generate Creator Report — a modal, not a tab.
 *
 * Reporting is something you do to a creator once you have decided about them;
 * it is not information you read on every visit. As a seventh tab it took a
 * permanent slot in the navigation for an action used at the end of the flow,
 * so it lives behind a button in the header instead.
 */

import { useMemo, useState } from 'react'
import { PJ, TOKENS as T, Btn } from './ui'
import { exportCsv, exportExcel, type ExportColumn } from './exportData'
import { Overlay, Row, SampleTag } from './kolViz'
import { platformLabel } from './KolCreatorSections'
import type { CreatorIntel } from '@/lib/discover/kolIntel'
import type {
  KolCreatorPlatformRow, KolCreatorRank, KolDirectoryRow,
} from '@/lib/discover/kolDirectory'

const REPORT_SECTIONS = [
  'Profile', 'Performance', 'Audience', 'Content', 'Campaign History',
  'Brand Fit', 'AI Insights',
] as const

/**
 * Profile is always real — it is the roster row itself. Performance and Content
 * join it for creators the warehouse has harvested, which is why the set is
 * computed per creator rather than fixed here.
 */
const PROFILE_SECTION = REPORT_SECTIONS[0]

const DATE_RANGES = [
  '30 hari terakhir', '90 hari terakhir', '6 bulan terakhir', 'Sepanjang waktu',
] as const

export default function KolCreatorReport({
  open, onClose, creator, rank, platforms, intel,
}: {
  open: boolean
  onClose: () => void
  creator: KolDirectoryRow
  rank: KolCreatorRank
  platforms: KolCreatorPlatformRow[]
  intel: CreatorIntel
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set(REPORT_SECTIONS))
  const [format, setFormat] = useState<'PDF' | 'Excel' | 'CSV'>('CSV')
  const [range, setRange] = useState<string>(DATE_RANGES[0])
  const [platform, setPlatform] = useState('all')
  const [note, setNote] = useState<string | null>(null)

  /**
   * The export carries the roster fields plus the standings — the parts that
   * survive leaving the screen. Sampled figures are deliberately left out: a
   * spreadsheet strips the markers that qualify them here, and a number in a
   * downloaded file outlives every caveat around it.
   */
  const m = intel.measured

  const rows = useMemo(() => [{
    username: creator.username,
    platform: platformLabel(creator.platform),
    tier: creator.tier ?? '—',
    categories: creator.categories.join(' · ') || '—',
    followers: creator.followers ?? 0,
    erPct: creator.erPct === null ? '' : creator.erPct.toFixed(2),
    verified: creator.verified ? 'Ya' : 'Tidak',
    status: creator.status,
    followersRank: `#${rank.followersRank} dari ${rank.rosterTotal}`,
    categoryRank: rank.categoryFollowersRank === null
      ? '—' : `#${rank.categoryFollowersRank} dari ${rank.categoryTotal} (${rank.categoryName})`,
    erRank: rank.erRank === null ? '—' : `#${rank.erRank} dari ${rank.erMeasuredTotal}`,
    profileUrl: creator.profileUrl ?? '',
    lastRefreshed: creator.lastRefreshedAt?.slice(0, 10) ?? '',
    // Measured content, blank for the creators the warehouse has not harvested.
    // Blank rather than 0: a spreadsheet cell holding 0 is a claim, an empty one
    // is the absence of one.
    postCount: m ? m.postCount : '',
    postLikes: m?.totals.likes ?? '',
    postComments: m?.totals.comments ?? '',
    postViews: m?.totals.views ?? '',
    topFormat: m?.formats[0] ? `${m.formats[0].label} (${m.formats[0].pct}%)` : '',
    postWindow: m?.firstPostAt && m?.lastPostAt
      ? `${m.firstPostAt.slice(0, 10)} — ${m.lastPostAt.slice(0, 10)}`
      : '',
    rateCard: m?.rates.length
      ? m.rates.map(r => `${r.label}: Rp${r.fee.toLocaleString('id-ID')}`).join(' · ')
      : '',
  }], [creator, rank, m])

  const cols: ExportColumn<(typeof rows)[number]>[] = [
    { key: 'username', header: 'Username', value: r => r.username },
    { key: 'platform', header: 'Platform', value: r => r.platform },
    { key: 'tier', header: 'Tier', value: r => r.tier },
    { key: 'categories', header: 'Kategori', value: r => r.categories },
    { key: 'followers', header: 'Followers', value: r => r.followers },
    { key: 'erPct', header: 'Engagement rate %', value: r => r.erPct },
    { key: 'verified', header: 'Verified', value: r => r.verified },
    { key: 'status', header: 'Data status', value: r => r.status },
    { key: 'followersRank', header: 'Peringkat followers', value: r => r.followersRank },
    { key: 'categoryRank', header: 'Peringkat kategori', value: r => r.categoryRank },
    { key: 'erRank', header: 'Peringkat ER', value: r => r.erRank },
    { key: 'profileUrl', header: 'Profile URL', value: r => r.profileUrl },
    { key: 'lastRefreshed', header: 'Terakhir refresh', value: r => r.lastRefreshed },
  ]

  /**
   * The measured columns only join the file when they hold something. A column
   * of blanks in every row reads as "we tried and found nothing", which is a
   * different claim from "this creator was never harvested".
   */
  if (intel.real.content) {
    cols.push(
      { key: 'postCount', header: 'Jumlah post terukur', value: r => r.postCount },
      { key: 'postViews', header: 'Total views', value: r => r.postViews },
      { key: 'postLikes', header: 'Total likes', value: r => r.postLikes },
      { key: 'postComments', header: 'Total comments', value: r => r.postComments },
      { key: 'topFormat', header: 'Format dominan', value: r => r.topFormat },
      { key: 'postWindow', header: 'Rentang post', value: r => r.postWindow },
    )
  }
  if (intel.real.rates) {
    cols.push({ key: 'rateCard', header: 'Rate card', value: r => r.rateCard })
  }

  const toggle = (s: string) => setPicked(p => {
    const next = new Set(p)
    if (next.has(s)) next.delete(s); else next.add(s)
    return next
  })

  /**
   * Which of the chosen sections the file can actually carry. A section only
   * counts as real when the figures behind it were measured for *this* creator:
   * Content and Performance are real for the harvested ones and modelled for
   * everyone else, so the note below has to be computed, not written once.
   */
  const realSections = [
    PROFILE_SECTION,
    ...(intel.real.content ? ['Content' as const] : []),
    ...(intel.real.likes || intel.real.views ? ['Performance' as const] : []),
  ] as string[]
  const included = [...picked].filter(s => realSections.includes(s))
  const sampled = [...picked].filter(s => !realSections.includes(s))
  const includedLabel = included.length ? included.join(', ') : PROFILE_SECTION

  const generate = () => {
    const file = `kol-${creator.username}`
    if (format === 'PDF') {
      setNote('Export PDF belum tersedia — pilih CSV atau Excel dulu.')
      return
    }
    if (format === 'CSV') exportCsv(rows, cols, file)
    else exportExcel(rows, cols, file)
    setNote(sampled.length
      ? `File berisi ${includedLabel} (data asli). ${sampled.length} section lain tidak ikut karena isinya angka estimasi.`
      : `File berisi ${includedLabel} (data asli).`)
  }

  return (
    <Overlay open={open} title="Generate Creator Report" onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={generate}>
            <span className="material-symbols-outlined text-[15px]">download</span>
            Generate Report
          </Btn>
        </>
      }>
      <div style={{ ...PJ, color: T.t2 }} className="text-[11.5px] font-extrabold mb-2">Select sections</div>
      <div className="flex flex-col gap-1.5 mb-4">
        {REPORT_SECTIONS.map(s => (
          <button key={s} type="button" onClick={() => toggle(s)}
            style={{ ...PJ, borderColor: picked.has(s) ? T.primary : T.outline }}
            className="flex items-center gap-2 h-9 px-2.5 rounded-lg border text-[11.5px] font-bold transition-colors">
            <span className="material-symbols-outlined text-[16px]"
              style={{ color: picked.has(s) ? T.primary : T.t4 }}>
              {picked.has(s) ? 'check_box' : 'check_box_outline_blank'}
            </span>
            <span style={{ color: picked.has(s) ? T.t1 : T.t3 }}>{s}</span>
            {!realSections.includes(s) && <SampleTag compact />}
          </button>
        ))}
      </div>

      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
        <Field label="Date range">
          <Select value={range} onChange={setRange} options={DATE_RANGES.map(r => [r, r])} />
        </Field>
        <Field label="Platform">
          <Select value={platform} onChange={setPlatform}
            options={([['all', 'Semua platform']] as [string, string][])
              .concat(platforms.map(p => [p.platform ?? 'other', platformLabel(p.platform)] as [string, string]))} />
        </Field>
        <Field label="Format">
          <Select value={format} onChange={v => setFormat(v as 'PDF' | 'Excel' | 'CSV')}
            options={[['CSV', 'CSV'], ['Excel', 'Excel'], ['PDF', 'PDF']]} />
        </Field>
      </div>

      <div className="rounded-xl px-3 py-2.5" style={{ background: T.surfaceVariant }}>
        <div style={{ ...PJ, color: T.primaryDeep }} className="text-[10px] font-extrabold uppercase tracking-wide mb-1">
          Yang benar-benar ikut ke file
        </div>
        <p className="text-[11px] leading-[1.55]" style={{ color: T.t2 }}>
          {PROFILE_SECTION}: followers, engagement rate, tier, kategori, verified dan
          peringkat di roster — {rank.rosterTotal.toLocaleString('id-ID')} creator sebagai
          pembanding.
          {intel.real.content && intel.measured && (
            <> Content: {intel.measured.postCount} post asli beserta views, likes
            dan comments-nya.</>
          )}
          {sampled.length > 0 && (
            <> {sampled.length} section lain tidak diekspor: isinya angka estimasi, dan file
            spreadsheet melepas penanda yang ada di layar.</>
          )}
        </p>
      </div>

      <div className="mt-3">
        <Row label="Creator" value={`@${creator.username}`} />
        <Row label="Campaign tersedia" value={intel.campaigns.length} sample />
      </div>

      {note && <p className="text-[10.5px] mt-2.5" style={{ color: T.t3 }}>{note}</p>}
    </Overlay>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] mb-1" style={{ color: T.t3 }}>{label}</div>
      {children}
    </div>
  )
}

function Select({
  value, onChange, options,
}: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full h-8 rounded-lg border px-2 text-[11.5px]"
      style={{ borderColor: T.outline, color: T.t1, background: T.surface }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}
