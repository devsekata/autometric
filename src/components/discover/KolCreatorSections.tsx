'use client'

/**
 * The tab bodies of the Creator Intelligence Workspace.
 *
 * Split from the shell (`KolCreatorWorkspace`) purely for file size — the shell
 * owns the header, the KPI bar, the tab state and Overview; everything a tab
 * needs arrives through `SectionProps`.
 *
 * Provenance is the rule that shapes every section here. The roster backs
 * username, platform, followers, engagement rate, category, tier and verified.
 * For the creators the warehouse has harvested, `l1_silver.unified_post` also
 * backs likes, comments, views, the format mix and the content grid, and
 * `l1_silver.unified_rate_card` backs the price. Everything else is sampled
 * (see `@/lib/discover/kolSample`) and is stamped with `<SampleTag />` at the
 * figure, not just in a footnote.
 *
 * Which of the two a given figure is depends on the creator, not on the tile, so
 * sections read the per-field flags in `intel.real` rather than hardcoding
 * `sample` — `@/lib/discover/kolIntel` is what sets them. Where a section can mix
 * the two — Platform Comparison, whose follower counts and rates are real for the
 * 277 creators holding accounts on both platforms — the real columns are left
 * unstamped so the difference is visible in the same table.
 */

import { useCallback, useMemo, useState } from 'react'
import { PJ, TOKENS as T, PLATFORM_ICON, fmtNum, Btn } from './ui'
import { exportCsv, exportExcel, type ExportColumn } from './exportData'
import {
  Bars, Donut, EmptyBlock, Meter, Overlay, Row, SampleTag, ScoreBlock, Split, TrendChart,
  VIZ, VizCard, StatTile,
} from './kolViz'
import {
  CAMPAIGN_STAGES, type SampleContentItem,
} from '@/lib/discover/kolSample'
import { measuredBasis, type CreatorIntel } from '@/lib/discover/kolIntel'
import type {
  KolCreatorIdentity, KolCreatorPlatformRow, KolCreatorRank, KolDirectoryRow, KolSimilarRow,
} from '@/lib/discover/kolDirectory'
import type { GoldFormatDay, GoldPost, KolGold } from '@/lib/discover/kolGold'

export interface SectionProps {
  creator: KolDirectoryRow
  identity: KolCreatorIdentity
  rank: KolCreatorRank
  platforms: KolCreatorPlatformRow[]
  similar: KolSimilarRow[]
  /**
   * Measured where the warehouse has a source, sampled elsewhere. Sections read
   * `intel.real` to decide which figures carry the estimate marker rather than
   * hardcoding `sample` — the same tile is real for a harvested creator and an
   * estimate for the other 7,695.
   */
  intel: CreatorIntel
  /**
   * The L2 Gold rollups, when the pipeline has any for this creator. A third
   * provenance alongside roster and L1: figures the warehouse aggregated ahead
   * of time rather than ones this page derives.
   *
   * Null, and each field inside independently empty, so a section renders its
   * real block only where L2 actually has rows and otherwise falls back to the
   * sampled block it showed before. Never coalesce a null to zero — `null` here
   * means "the pipeline could not measure it", which is what the missing
   * Insights columns are.
   */
  gold: KolGold | null
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', youtube: 'YouTube',
}
export const platformLabel = (k: string | null) => (k ? PLATFORM_LABEL[k] ?? k : '—')

const pctLabel = (n: number) => `${n.toFixed(2)}%`
const usd = (n: number) => `$${n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n}`

/* ── Performance ──────────────────────────────────────────────────────────── */

type MetricKey = 'erPct' | 'reach' | 'views' | 'followers'

const METRICS: { key: MetricKey; label: string; format: (n: number) => string }[] = [
  { key: 'erPct', label: 'Engagement rate', format: n => `${n.toFixed(2)}%` },
  { key: 'reach', label: 'Reach', format: fmtNum },
  { key: 'views', label: 'Views', format: fmtNum },
  { key: 'followers', label: 'Followers', format: fmtNum },
]

const PERIODS = ['30 hari terakhir', '90 hari terakhir', '6 bulan terakhir'] as const

/** Metrics the L2 rollups actually carry. `reach` is absent on purpose: every
 *  `reach_sum` in `kol_metric_daily`/`_monthly` is NULL — it needs the Insights
 *  API. Offering it as a choice would draw an empty chart. */
const GOLD_METRICS: {
  key: 'engagement' | 'likes' | 'comments' | 'views' | 'postCount' | 'erFollowers'
  label: string
  format: (n: number) => string
}[] = [
  { key: 'engagement', label: 'Engagement', format: fmtNum },
  { key: 'likes', label: 'Likes', format: fmtNum },
  { key: 'comments', label: 'Comments', format: fmtNum },
  { key: 'views', label: 'Views', format: fmtNum },
  { key: 'postCount', label: 'Jumlah post', format: n => String(n) },
  // Stored as a fraction 0..1 by the pipeline, shown as a percentage here.
  { key: 'erFollowers', label: 'ER followers', format: n => `${(n * 100).toFixed(2)}%` },
]

type GoldMetricKey = (typeof GOLD_METRICS)[number]['key']
type GoldGrain = 'daily' | 'monthly'

export function PerformanceSection({ creator, platforms, intel, gold }: SectionProps) {
  const [metric, setMetric] = useState<MetricKey>('erPct')
  const [platform, setPlatform] = useState('all')
  const [period, setPeriod] = useState<string>(PERIODS[2])
  const m = METRICS.find(x => x.key === metric) ?? METRICS[0]
  const basis = measuredBasis(intel)

  const [goldGrain, setGoldGrain] = useState<GoldGrain>('daily')
  const [goldMetric, setGoldMetric] = useState<GoldMetricKey>('engagement')
  const gm = GOLD_METRICS.find(x => x.key === goldMetric) ?? GOLD_METRICS[0]

  /**
   * The rollups are per account, so a creator on both platforms has two rows
   * per period. They are summed into one series — except ER, which is a ratio
   * and cannot be added; there the largest of the day is taken, and the label
   * says the chart is per account.
   */
  const goldPoints = useMemo(() => {
    if (!gold) return []
    const rows: { key: string; value: number | null }[] =
      goldGrain === 'daily'
        ? gold.daily.map(d => ({ key: d.date, value: d[goldMetric] }))
        : gold.monthly.map(d => ({
            key: d.month,
            value: goldMetric === 'erFollowers' ? d.erFollowers : d[goldMetric],
          }))

    const byKey = new Map<string, number>()
    for (const r of rows) {
      // null means "never measured" and must not become a zero on the chart.
      if (r.value === null || !r.key) continue
      const prev = byKey.get(r.key)
      byKey.set(
        r.key,
        prev === undefined
          ? r.value
          : goldMetric === 'erFollowers' ? Math.max(prev, r.value) : prev + r.value,
      )
    }
    return [...byKey.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([x, y]) => ({ x, y }))
  }, [gold, goldGrain, goldMetric])

  /** Totals across the whole rollup, so the tiles say what the pipeline measured. */
  const goldTotals = useMemo(() => {
    const sum = (k: 'postCount' | 'likes' | 'comments' | 'views' | 'engagement') => {
      const vals = (gold?.daily ?? [])
        .map(d => d[k])
        .filter((v): v is number => v !== null && v !== undefined)
      return vals.length ? vals.reduce((a, b) => a + b, 0) : null
    }
    return {
      days: new Set((gold?.daily ?? []).map(d => d.date)).size,
      months: new Set((gold?.monthly ?? []).map(d => d.month)).size,
      posts: sum('postCount'), likes: sum('likes'),
      comments: sum('comments'), views: sum('views'), engagement: sum('engagement'),
    }
  }, [gold])

  const hasGold = goldPoints.length > 0 || (gold?.daily.length ?? 0) > 0

  /**
   * The period control trims the series rather than refetching: there is only
   * one sampled series behind it, and a filter that visibly does nothing is
   * worse than one that does the honest, small thing.
   */
  const months = period === PERIODS[0] ? 1 : period === PERIODS[1] ? 3 : 6
  const points = intel.trend.slice(-Math.max(2, months)).map(p => ({ x: p.month, y: p[metric] }))

  return (
    <div className="flex flex-col gap-4">
      {/* Sub-filters sit in one row above the cards, never inside them. */}
      <div className="flex items-end gap-2.5 flex-wrap">
        <Field label="Platform">
          <Select value={platform} onChange={setPlatform}
            options={([['all', 'Semua platform']] as [string, string][])
              .concat(platforms.map(p => [p.platform ?? 'other', platformLabel(p.platform)] as [string, string]))} />
        </Field>
        <Field label="Period">
          <Select value={period} onChange={setPeriod}
            options={PERIODS.map(p => [p, p] as [string, string])} />
        </Field>
        <Field label="Metric">
          <Select value={metric} onChange={v => setMetric(v as MetricKey)}
            options={METRICS.map(x => [x.key, x.label] as [string, string])} />
        </Field>
      </div>

      {hasGold && (
        <VizCard
          title="Performance (terukur, L2 Gold)"
          subtitle={
            `${goldTotals.days} hari · ${goldTotals.months} bulan tercatat` +
            ' · tanggal = tanggal tayang, bukan tanggal scraping'
          }
          action={
            <div className="flex items-end gap-2.5 flex-wrap">
              <Field label="Grain">
                <Select value={goldGrain} onChange={v => setGoldGrain(v as GoldGrain)}
                  options={[['daily', 'Harian'], ['monthly', 'Bulanan']] as [string, string][]} />
              </Field>
              <Field label="Metric">
                <Select value={goldMetric} onChange={v => setGoldMetric(v as GoldMetricKey)}
                  options={GOLD_METRICS.map(x => [x.key, x.label] as [string, string])} />
              </Field>
            </div>
          }>
          <div className="grid gap-2.5 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
            {/* No tile is rendered for a metric the pipeline left NULL — an
                empty tile claims a measurement that was never taken. */}
            {goldTotals.posts !== null && <StatTile label="Post" value={fmtNum(goldTotals.posts)} />}
            {goldTotals.engagement !== null && <StatTile label="Engagement" value={fmtNum(goldTotals.engagement)} />}
            {goldTotals.likes !== null && <StatTile label="Likes" value={fmtNum(goldTotals.likes)} />}
            {goldTotals.comments !== null && <StatTile label="Comments" value={fmtNum(goldTotals.comments)} />}
            {goldTotals.views !== null && <StatTile label="Views" value={fmtNum(goldTotals.views)} />}
          </div>
          {goldPoints.length >= 2
            ? <TrendChart points={goldPoints} format={gm.format} label={gm.label} />
            : <p className="text-[11px]" style={{ color: T.t4 }}>
                {gm.label} baru tercatat di {goldPoints.length} periode — grafik butuh minimal dua.
              </p>}
        </VizCard>
      )}

      <VizCard title="Performance Overview" subtitle="Rata-rata per konten">
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
          {/* Each tile decides for itself: a harvested creator has real likes,
              comments and views here, while reach and impressions are modelled
              for everyone because no post carries them. */}
          <StatTile label="Engagement Rate"
            value={creator.erPct === null ? 'belum diukur' : pctLabel(creator.erPct)}
            hint={creator.erPct === null ? undefined : 'dari roster KOL'} />
          <StatTile label="Reach" value={fmtNum(intel.kpi.avgReach)} sample={!intel.real.reach} />
          <StatTile label="Impressions" value={fmtNum(intel.performance.impressions)} sample />
          <StatTile label="Views" value={fmtNum(intel.kpi.avgViews)}
            sample={!intel.real.views} hint={intel.real.views ? basis : undefined} />
          <StatTile label="Likes" value={fmtNum(intel.performance.likes)}
            sample={!intel.real.likes} hint={intel.real.likes ? basis : undefined} />
          <StatTile label="Comments" value={fmtNum(intel.performance.comments)}
            sample={!intel.real.comments} hint={intel.real.comments ? basis : undefined} />
          <StatTile label="Shares" value={fmtNum(intel.performance.shares)} sample={!intel.real.shares} />
          <StatTile label="Saves" value={fmtNum(intel.performance.saves)} sample={!intel.real.saves} />
        </div>
      </VizCard>

      <Split
        main={
          <VizCard title="Performance Trend" subtitle={`${m.label} · ${period.toLowerCase()}`} sample>
            {/* One metric at a time: two units on one chart would need a second
                y-axis, which is never the answer. */}
            <TrendChart points={points} format={m.format} label={m.label} />
            <p className="text-[9.5px] mt-1.5" style={{ color: T.t4 }}>
              Titik terakhir menempel pada engagement rate asli creator ini; lima bulan
              sebelumnya adalah estimasi.
            </p>
          </VizCard>
        }
        aside={
          <VizCard title="Performance Highlights" sample>
            <div className="flex flex-col gap-3">
              {intel.highlights.map(h => (
                <div key={h.headline} className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-[16px] mt-px"
                    style={{ color: h.tone === 'good' ? VIZ.good : h.tone === 'warning' ? VIZ.warning : T.t4 }}>
                    {h.icon}
                  </span>
                  <div>
                    <div style={{ ...PJ, color: T.t1 }} className="text-[11.5px] font-extrabold">{h.headline}</div>
                    <div className="text-[10.5px] mt-0.5 leading-[1.45]" style={{ color: T.t3 }}>{h.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </VizCard>
        }
      />

      <VizCard title="Platform Comparison"
        subtitle={platforms.length > 1
          ? 'Followers dan engagement rate di bawah adalah data asli roster'
          : 'Creator ini hanya punya satu akun di roster'}>
        {platforms.length > 1 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[11.5px]" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.outline}` }}>
                  <th className="text-left py-2 font-bold" style={{ color: T.t3 }}>Metric</th>
                  {platforms.map(p => (
                    <th key={p.id} className="text-right py-2 font-bold" style={{ color: T.t2 }}>
                      <span className="inline-flex items-center gap-1 justify-end">
                        <span className="material-symbols-outlined text-[14px]" style={{ color: T.primary }}>
                          {PLATFORM_ICON[p.platform ?? ''] ?? 'public'}
                        </span>
                        {platformLabel(p.platform)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <MetricRow label="Followers" cells={platforms.map(p => (p.followers === null ? '—' : fmtNum(p.followers)))} />
                <MetricRow label="Engagement rate"
                  cells={platforms.map(p => (p.erPct === null ? 'belum diukur' : pctLabel(p.erPct)))} />
                <MetricRow label="Avg. reach" sample
                  cells={platforms.map(p => fmtNum(Math.round((p.followers ?? 0) * 0.32)))} />
                <MetricRow label="Avg. views" sample
                  cells={platforms.map(p => fmtNum(Math.round((p.followers ?? 0) * 0.41)))} />
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[11.5px]" style={{ color: T.t3 }}>
            Hanya ada satu akun ({platformLabel(creator.platform)}) untuk username ini di
            roster, jadi tidak ada yang bisa dibandingkan. 277 creator di roster punya
            akun di dua platform sekaligus.
          </p>
        )}
      </VizCard>

      <Split
        main={
          <VizCard title="Growth" subtitle="Follower growth — 6 bulan" sample>
            <TrendChart points={intel.trend.map(p => ({ x: p.month, y: p.followers }))}
              format={fmtNum} label="Followers" />
            <div className="grid gap-2.5 mt-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
              <StatTile label="Current followers"
                value={creator.followers === null ? '—' : fmtNum(creator.followers)}
                hint="data asli roster" />
              <StatTile label="Monthly" value={`${intel.growth.monthly}%`} sample />
              <StatTile label="3 bulan" value={`${intel.growth.threeMonth}%`} sample />
              <StatTile label="6 bulan" value={`${intel.growth.sixMonth}%`} sample />
            </div>
          </VizCard>
        }
        aside={<EngagementBreakdown intel={intel} />}
      />
    </div>
  )
}

/**
 * Where the engagement actually comes from — likes, comments, shares and saves
 * as a share of total interactions. Nominal categories, so every bar wears the
 * same hue: the bar length is the value, and colouring them differently would
 * claim an identity the four do not have.
 */
function EngagementBreakdown({ intel }: { intel: CreatorIntel }) {
  const p = intel.performance
  const total = p.likes + p.comments + p.shares + p.saves || 1
  const parts = [
    { label: 'Likes', n: p.likes },
    { label: 'Comments', n: p.comments },
    { label: 'Shares', n: p.shares },
    { label: 'Saves', n: p.saves },
  ].map(x => ({ label: x.label, pct: Math.round((x.n / total) * 1000) / 10 }))

  return (
    <VizCard title="Engagement Breakdown" subtitle="Bagian dari total interaksi" sample>
      <Bars parts={parts} />
      <div className="mt-3">
        <Row label="Total interaksi" value={fmtNum(total)} sample />
      </div>
    </VizCard>
  )
}

function MetricRow({ label, cells, sample }: { label: string; cells: string[]; sample?: boolean }) {
  return (
    <tr style={{ borderBottom: `1px solid ${T.outlineSoft}` }}>
      <td className="py-2" style={{ color: T.t3 }}>
        <span className="inline-flex items-center gap-1.5">{label}{sample && <SampleTag compact />}</span>
      </td>
      {cells.map((c, i) => (
        <td key={i} className="py-2 text-right tabular-nums" style={{ ...PJ, color: T.t1, fontWeight: 700 }}>{c}</td>
      ))}
    </tr>
  )
}


/* ── Content ──────────────────────────────────────────────────────────────── */

const CONTENT_SORTS = [
  ['top', 'Top performing'], ['recent', 'Terbaru'], ['views', 'Views terbanyak'],
] as const

/**
 * Sorts for the L2 post table. The same three ideas as the sampled grid above,
 * declared separately on purpose: `top` there means the sampled ER, here it
 * means the pipeline's `er_followers`. Sharing one constant would suggest the
 * two tables are ordered by the same number.
 */
const GOLD_POST_SORTS = [
  ['top', 'ER tertinggi'], ['recent', 'Terbaru'], ['views', 'Views terbanyak'],
] as const

/** `media_type` as an icon, so a cover that never loads still says what it was. */
const POST_ICON: Record<string, string> = {
  Reels: 'play_circle', Video: 'play_circle', 'Feed Video': 'play_circle',
  Carousel: 'collections', Foto: 'image', Feed: 'image', Story: 'auto_stories',
}

const POSTED_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/**
 * A sampled item's `postedAt` is already a label ("Jan 2026"); a harvested one
 * carries the post's ISO timestamp, which was reaching the overlay raw. Only the
 * timestamp is reformatted — `new Date('Jan 2026')` parses, so handing the label
 * to the same path would silently rewrite it as "1 Jan 2026".
 */
function postedLabel(v: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return v
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return `${d.getDate()} ${POSTED_MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/**
 * A post's cover, and what stands in when even the recovery fails.
 *
 * `src` is not the platform's own CDN link any more. Those are signed and every
 * one harvested so far has passed its expiry, which is why this grid used to
 * render as rows of blank tiles; the API now points each cover at
 * `…/kol-directory/[kolId]/cover/[postId]`, which re-mints the picture from the
 * post's permalink (see `@/lib/discover/kolPostCover`). That recovers 209 of the
 * 221 harvested posts — every Instagram one, and most TikTok ones.
 *
 * The rest need a fallback that still reads as a post, so it names the format
 * rather than showing a bare gradient. The caption and the numbers under it were
 * real all along. The failure is reported up rather than swallowed, so the
 * section can explain a wholly coverless grid once instead of per tile.
 */
function PostCover({
  src, format, height, background, iconSize = 22, onFail,
}: {
  src?: string | null
  format: string
  height: number
  background: string
  iconSize?: number
  onFail?: (src: string) => void
}) {
  const [broken, setBroken] = useState<string | null>(null)
  const icon = POST_ICON[format] ?? 'image'
  const showImage = !!src && broken !== src

  return (
    <div className="flex flex-col items-center justify-center gap-0.5 relative overflow-hidden"
      style={{ height, background }}>
      {showImage ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- post covers come from CDNs not in next.config */}
          <img src={src as string} alt="" referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => { setBroken(src as string); onFail?.(src as string) }} />
          {icon === 'play_circle' && (
            <span className="material-symbols-outlined text-white absolute bottom-1 left-1.5 text-[16px]"
              style={{ textShadow: '0 1px 3px rgba(0,0,0,.55)' }}>play_circle</span>
          )}
        </>
      ) : (
        <>
          <span className="material-symbols-outlined text-white opacity-90"
            style={{ fontSize: iconSize }}>{icon}</span>
          <span style={PJ}
            className="text-white text-[8.5px] font-extrabold uppercase tracking-widest opacity-75">
            {format}
          </span>
        </>
      )}
    </div>
  )
}

/** Sums that keep null meaning "never measured" instead of collapsing it to 0. */
const addNullable = (a: number | null, b: number | null): number | null =>
  a === null && b === null ? null : (a ?? 0) + (b ?? 0)

/** The pipeline stores ER as a fraction 0..1; every screen shows a percentage. */
const erLabel = (v: number | null) => (v === null ? '\u2014' : `${(v * 100).toFixed(2)}%`)

/**
 * One row per published post, carrying the pipeline's own rank and ER rather
 * than figures this page derives.
 *
 * Sits ABOVE the sampled grid instead of replacing it. The grid holds covers and
 * captions, which `post_metric` does not store; this table holds numbers the
 * grid can only estimate. They are two different things about the same posts, so
 * dropping either would lose something real.
 *
 * A column is omitted entirely when no row carries it, rather than rendered as a
 * stack of dashes. `shares` and `saves` are the live case: TikTok reports them
 * and Instagram does not, so a TikTok creator gets both columns and an Instagram
 * creator gets neither. `reach`, `reposts`, `avg_watch_time_seconds` and
 * `completion_rate` are NULL for every row in the table and are not even
 * selected -- see `kolGold`.
 */
function GoldPostsCard({ posts }: { posts: GoldPost[] }) {
  const [sort, setSort] = useState<string>('top')
  const [format, setFormat] = useState('all')

  const formats = useMemo(
    () => [...new Set(posts.map(p => p.mediaType ?? 'unknown'))].sort(),
    [posts])

  /**
   * Columns are decided over ALL posts, not the filtered view, so changing the
   * format filter never makes a column appear and vanish under the reader.
   */
  const hasShares = posts.some(p => p.shares !== null)
  const hasSaves = posts.some(p => p.saves !== null)
  const hasViews = posts.some(p => p.views !== null)

  const rows = useMemo(() => {
    const out = posts.filter(p => format === 'all' || (p.mediaType ?? 'unknown') === format)
    /**
     * Nulls sink to the bottom: "never measured" is not "worst", but it must not
     * head a table sorted by the very thing it lacks.
     */
    const desc = (f: (p: GoldPost) => number | null) => (a: GoldPost, b: GoldPost) => {
      const av = f(a)
      const bv = f(b)
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      return bv - av
    }
    if (sort === 'views') return [...out].sort(desc(p => p.views))
    if (sort === 'top') return [...out].sort(desc(p => p.erFollowers))
    return [...out].sort((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''))
  }, [posts, format, sort])

  const withEr = posts.filter(p => p.erFollowers !== null).length
  const flagged = posts.filter(p => p.likesHidden || p.isCollaboration).length

  const headers = ['#', 'Post', 'Format', 'Tayang', 'Likes', 'Comments']
    .concat(hasShares ? ['Shares'] : [])
    .concat(hasSaves ? ['Saves'] : [])
    .concat(hasViews ? ['Views'] : [])
    .concat(['ER'])

  return (
    <VizCard
      title="Top Posts (terukur, L2 Gold)"
      subtitle={
        `${posts.length} post dari pipeline \u00b7 peringkat & ER dihitung pipeline` +
        ' \u00b7 tanggal = tanggal tayang'
      }
      action={
        <div className="flex gap-1.5 flex-wrap">
          <Select value={format} onChange={setFormat}
            options={([['all', 'Semua format']] as [string, string][])
              .concat(formats.map(f => [f, f] as [string, string]))} />
          <Select value={sort} onChange={setSort}
            options={GOLD_POST_SORTS.map(([v, l]) => [v, l] as [string, string])} />
        </div>
      }>
      {rows.length === 0 ? (
        <EmptyBlock icon="filter_alt_off" title="Tidak ada post pada format ini"
          body="Format yang dipilih tidak dipakai creator ini."
          action={<Btn onClick={() => setFormat('all')}>Reset filter</Btn>} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11.5px]" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.outline}` }}>
                {headers.map(h => (
                  <th key={h} className="text-left py-2 font-bold whitespace-nowrap"
                    style={{ color: T.t3 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={`${p.platform}-${p.contentId}`}
                  style={{ borderBottom: `1px solid ${T.outlineSoft}` }}>
                  <td className="py-2.5 tabular-nums" style={{ ...PJ, color: T.t3 }}>
                    {p.rankInAccount ?? '\u2014'}
                  </td>
                  <td className="py-2.5 max-w-[260px]">
                    {p.permalink ? (
                      <a href={p.permalink} target="_blank" rel="noreferrer"
                        style={{ ...PJ, color: T.primaryDeep }}
                        className="text-[11.5px] font-bold hover:underline inline-flex items-center gap-1">
                        Buka post
                        <span className="material-symbols-outlined text-[13px]">open_in_new</span>
                      </a>
                    ) : (
                      <span style={{ ...PJ, color: T.t2 }} className="font-bold">{p.contentId}</span>
                    )}
                    {p.isSponsored && (
                      <span style={{ ...PJ, background: '#fdf3e7', color: '#b5761f' }}
                        className="ml-1.5 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full">
                        PAID
                      </span>
                    )}
                    {(p.likesHidden || p.isCollaboration) && (
                      <span style={{ ...PJ, background: T.surfaceVariant, color: T.t3 }}
                        className="ml-1.5 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full"
                        title={p.likesHidden
                          ? 'Like disembunyikan platform \u2014 ER tidak dihitung'
                          : 'Post kolaborasi \u2014 sebagian audiens milik akun lain, ER tidak dihitung'}>
                        {p.likesHidden ? 'LIKE DISEMBUNYIKAN' : 'KOLABORASI'}
                      </span>
                    )}
                    {p.hashtags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {p.hashtags.slice(0, 3).map(h => (
                          <span key={h}
                            style={{ ...PJ, background: T.surfaceVariant, color: T.primaryDeep }}
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded-md">#{h}</span>
                        ))}
                        {p.hashtags.length > 3 && (
                          <span className="text-[9px]" style={{ color: T.t4 }}>
                            +{p.hashtags.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 whitespace-nowrap" style={{ color: T.t3 }}>
                    {p.mediaType ?? 'unknown'}
                  </td>
                  <td className="py-2.5 whitespace-nowrap" style={{ color: T.t3 }}>
                    {p.postDate ? postedLabel(p.postDate) : '\u2014'}
                  </td>
                  <td className="py-2.5 tabular-nums" style={{ color: T.t2 }}>
                    {p.likes === null ? '\u2014' : fmtNum(p.likes)}
                  </td>
                  <td className="py-2.5 tabular-nums" style={{ color: T.t2 }}>
                    {p.comments === null ? '\u2014' : fmtNum(p.comments)}
                  </td>
                  {hasShares && (
                    <td className="py-2.5 tabular-nums" style={{ color: T.t2 }}>
                      {p.shares === null ? '\u2014' : fmtNum(p.shares)}
                    </td>
                  )}
                  {hasSaves && (
                    <td className="py-2.5 tabular-nums" style={{ color: T.t2 }}>
                      {p.saves === null ? '\u2014' : fmtNum(p.saves)}
                    </td>
                  )}
                  {hasViews && (
                    <td className="py-2.5 tabular-nums" style={{ color: T.t2 }}>
                      {p.views === null ? '\u2014' : fmtNum(p.views)}
                    </td>
                  )}
                  <td className="py-2.5 tabular-nums"
                    style={{ ...PJ, color: p.erFollowers === null ? T.t4 : T.primaryDeep, fontWeight: 800 }}>
                    {erLabel(p.erFollowers)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] leading-[1.55] mt-3" style={{ color: T.t3 }}>
        ER dihitung terhadap jumlah follower saat post tayang, dan hanya ada untuk{' '}
        <b>{withEr} dari {posts.length}</b> post \u2014 sisanya belum punya snapshot
        follower sebelum tanggal tayangnya.
        {flagged > 0 && (
          <> {flagged} post ditandai like-disembunyikan atau kolaborasi: angkanya tetap
          ditampilkan, tapi ER-nya sengaja dikosongkan karena penyebutnya bukan audiens
          akun ini saja.</>
        )}
      </p>
    </VizCard>
  )
}

/**
 * The format mix and the ER behind it, from `l2_gold.content_format_daily`.
 *
 * Replaces the sampled "Content Format" card only for creators the pipeline
 * actually covers; everyone else keeps the estimated one, so no creator loses a
 * card and no card silently changes provenance.
 *
 * ER per format is `sum(engagement) / sum(followersDenom)`, never the mean of
 * the daily `erFollowers`. A ratio is not additive: averaging the daily column
 * weights a day carrying one post the same as a day carrying twenty. The
 * pipeline makes the same choice for its monthly ER, and keeping the denominator
 * on the row is the only reason this page can repeat it.
 */
function GoldFormatsCard({ formats }: { formats: GoldFormatDay[] }) {
  const rows = useMemo(() => {
    const by = new Map<string, {
      posts: number; inSample: number
      engagement: number | null; denom: number | null; views: number | null
    }>()
    for (const f of formats) {
      const cur = by.get(f.mediaType)
        ?? { posts: 0, inSample: 0, engagement: null, denom: null, views: null }
      cur.posts += f.postCount
      cur.inSample += f.postsInSample
      cur.engagement = addNullable(cur.engagement, f.engagement)
      cur.denom = addNullable(cur.denom, f.followersDenom)
      cur.views = addNullable(cur.views, f.views)
      by.set(f.mediaType, cur)
    }
    return [...by.entries()]
      .map(([mediaType, v]) => ({
        mediaType,
        ...v,
        er: v.engagement !== null && v.denom !== null && v.denom > 0
          ? v.engagement / v.denom
          : null,
      }))
      .sort((a, b) => b.posts - a.posts)
  }, [formats])

  const totalPosts = rows.reduce((a, r) => a + r.posts, 0)
  const days = new Set(formats.map(f => f.date)).size
  const parts = totalPosts
    ? rows.map(r => ({
        label: r.mediaType,
        pct: Math.round((r.posts / totalPosts) * 1000) / 10,
      }))
    : []
  const withEr = rows.filter(r => r.er !== null)

  return (
    <VizCard title="Content Format (terukur, L2 Gold)"
      subtitle={`${totalPosts} post \u00b7 ${days} hari tercatat`}>
      <Bars parts={parts} />

      {withEr.length > 0 && (
        <div className="mt-3">
          <div style={{ ...PJ, color: T.t3 }}
            className="text-[10.5px] font-extrabold uppercase tracking-wide mb-1">
            ER per format
          </div>
          {/* Only formats whose ER could be computed. A format listed with a dash
              would read as "this format does not engage", not as "no follower
              snapshot covered the days it was posted". */}
          {withEr.map(r => (
            <Row key={r.mediaType} label={r.mediaType} value={erLabel(r.er)} />
          ))}
        </div>
      )}

      <p className="text-[10px] leading-[1.55] mt-2.5" style={{ color: T.t3 }}>
        Format ditulis apa adanya seperti yang dilaporkan platform.
        {rows.some(r => r.mediaType === 'unknown') && (
          <> <b>unknown</b> berarti format post-nya tidak ikut ter-scrape, bukan sebuah
          format tersendiri.</>
        )}
      </p>
    </VizCard>
  )
}

/**
 * Content gets its own tab rather than living under Performance: "konten apa
 * yang berhasil" is the question a brief is written from, and it is asked on
 * its own, not as a footnote to the rate.
 */
export function ContentSection({ creator, intel, gold }: SectionProps) {
  const [format, setFormat] = useState('all')
  const [sort, setSort] = useState<string>('top')
  const [openItem, setOpenItem] = useState<SampleContentItem | null>(null)
  const [failedCovers, setFailedCovers] = useState<string[]>([])
  const noteCoverFail = useCallback(
    (src: string) => setFailedCovers(f => (f.includes(src) ? f : [...f, src])), [])

  const formats = useMemo(
    () => [...new Set(intel.content.recent.map(c => c.format))], [intel.content.recent])

  const items = useMemo(() => {
    const out = intel.content.recent.filter(c => format === 'all' || c.format === format)
    if (sort === 'views') return [...out].sort((a, b) => b.views - a.views)
    if (sort === 'top') return [...out].sort((a, b) => b.erPct - a.erPct)
    return out
  }, [intel.content.recent, format, sort])

  /**
   * The L2 blocks are independently present: the pipeline covers 30 creators of
   * the roster, and a creator can have posts recorded without the format rollup
   * reaching back far enough, or the reverse. Each card decides for itself, so
   * neither ever renders empty.
   */
  const goldPosts = gold?.posts ?? []
  const goldFormats = gold?.formats ?? []

  /** True once every cover in the current view has 403'd — see `PostCover`. */
  const coversDown = failedCovers.length > 0
    && items.some(c => c.coverImage)
    && items.every(c => !c.coverImage || failedCovers.includes(c.coverImage))

  return (
    <div className="flex flex-col gap-4">
      <Split
        main={
          <>
          {goldPosts.length > 0 && <GoldPostsCard posts={goldPosts} />}

          <VizCard title="Content Performance" sample={!intel.real.content}
            subtitle={intel.real.content
              ? `${intel.measured?.postCount ?? 0} post asli dari warehouse — views, likes dan comments terukur; ER dan sentimen masih estimasi`
              : 'Roster tidak menyimpan satu pun post untuk creator ini — seluruh konten di bawah estimasi'}
            action={
              <div className="flex gap-1.5 flex-wrap">
                <Select value={format} onChange={setFormat}
                  options={([['all', 'Semua format']] as [string, string][])
                    .concat(formats.map(f => [f, f] as [string, string]))} />
                <Select value={sort} onChange={setSort}
                  options={CONTENT_SORTS.map(([v, l]) => [v, l] as [string, string])} />
              </div>
            }>
            {items.length === 0 ? (
              <EmptyBlock icon="grid_off" title="Tidak ada konten pada filter ini"
                body="Coba ganti format atau urutannya."
                action={
                  <Btn onClick={() => { setFormat('all'); setSort('top') }}>Reset filter</Btn>
                } />
            ) : (
              <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))' }}>
                {items.map((c, i) => (
                  <button key={`${c.title}-${i}`} type="button" onClick={() => setOpenItem(c)}
                    className="rounded-[12px] border overflow-hidden text-left hover:brightness-[.99] transition"
                    style={{ borderColor: T.outline }}>
                    <PostCover src={c.coverImage} format={c.format} height={96}
                      background={`linear-gradient(135deg,${VIZ.ordinal[i % VIZ.ordinal.length]},${VIZ.ordinal[(i + 2) % VIZ.ordinal.length]})`}
                      onFail={noteCoverFail} />
                    <div className="p-2">
                      <div style={{ ...PJ, color: T.t1 }} className="text-[11px] font-bold truncate">{c.title}</div>
                      <div style={{ ...PJ, color: T.t1 }} className="text-[13px] font-extrabold mt-0.5">
                        {fmtNum(c.views)}
                      </div>
                      <div className="text-[10px]" style={{ color: T.t4 }}>
                        views · ER {c.erPct}% · {fmtNum(c.likes)} likes
                      </div>
                      <div className="text-[9.5px] mt-0.5" style={{ color: T.t4 }}>
                        {c.format} · {postedLabel(c.postedAt)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {coversDown && (
              <p className="text-[10px] leading-[1.55] mt-3" style={{ color: T.t3 }}>
                Gambar cover-nya sedang tidak bisa diambil dari Instagram/TikTok — biasanya
                karena post-nya sudah dihapus atau akunnya dikunci. Caption dan angka di tiap
                kartu tetap dari post aslinya; klik kartunya lalu <b>Buka post asli</b> untuk
                melihat kontennya di platform.
              </p>
            )}
          </VizCard>
          </>
        }
        aside={
          <>
            {/* One card for one idea: the measured mix replaces the estimated
                one where L2 has rows, rather than sitting beside it with a
                second, different number for the same question. */}
            {goldFormats.length > 0 ? (
              <GoldFormatsCard formats={goldFormats} />
            ) : (
              <VizCard title="Content Format" sample={!intel.real.formats}
                subtitle={intel.real.formats ? measuredBasis(intel) : undefined}>
                <Bars parts={intel.content.formats} />
              </VizCard>
            )}
            {/* The source's "Top hashtags & keywords" panel, which it filled from
                a written-in list. Counted here across every harvested post, so it
                only appears for a creator whose posts carry tags. */}
            {intel.real.hashtags && intel.measured && (
              <VizCard title="Top Hashtags"
                subtitle={`dihitung dari ${intel.measured.postCount} post`}>
                <div className="flex flex-wrap gap-1.5">
                  {intel.measured.hashtags.map(h => (
                    <span key={h.tag} style={{ ...PJ, background: T.surfaceVariant, color: T.primaryDeep }}
                      className="h-6 px-2 rounded-md text-[10.5px] font-bold inline-flex items-center gap-1"
                      title={`dipakai di ${h.n} post`}>
                      #{h.tag}
                      <span style={{ color: T.t4 }} className="font-semibold">{h.n}</span>
                    </span>
                  ))}
                </div>
                {intel.measured.sponsoredCount > 0 && (
                  <p className="text-[10px] mt-2.5 leading-[1.5]" style={{ color: T.t3 }}>
                    <b>{intel.measured.sponsoredCount}</b> dari {intel.measured.postCount} post
                    ditandai paid partnership oleh platform.
                  </p>
                )}
              </VizCard>
            )}
            <VizCard title="Content Topic" sample>
              <Bars parts={intel.content.topics} />
            </VizCard>
            <VizCard title="Sentiment" sample>
              <SentimentBars parts={intel.content.sentiment} />
            </VizCard>
          </>
        }
      />

      <ContentDetail item={openItem} creator={creator} onClose={() => setOpenItem(null)} />
    </div>
  )
}

function ContentDetail({
  item, creator, onClose,
}: { item: SampleContentItem | null; creator: KolDirectoryRow; onClose: () => void }) {
  /** True only for a figure this post actually carries; see `SampleContentItem`. */
  const isReal = (field: string) => item?.measuredFields?.includes(field) ?? false

  return (
    <Overlay open={item !== null} title="Content Detail" onClose={onClose}>
      {item && (
        <div className="flex gap-4 flex-wrap">
          <div className="w-[200px] flex-shrink-0">
            <div className="rounded-[14px] overflow-hidden">
              <PostCover src={item.coverImage} format={item.format} height={200} iconSize={34}
                background={`linear-gradient(135deg,${VIZ.ordinal[1]},${VIZ.ordinal[3]})`} />
            </div>
            <div className="text-[10.5px] mt-2 text-center" style={{ color: T.t4 }}>
              {item.platform} · {item.format} · {postedLabel(item.postedAt)}
            </div>
          </div>

          <div className="flex-1 min-w-[240px]">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span style={{ ...PJ, color: T.t1 }} className="text-[12.5px] font-extrabold">{item.title}</span>
              {!item.measured && <SampleTag compact />}
            </div>
            <p className="text-[11.5px] leading-[1.6] mb-3" style={{ color: T.t2 }}>{item.caption}</p>

            {/* A harvested post is real on the numbers Instagram/TikTok actually
                report and modelled on the rest, so each row asks `measuredFields`
                rather than inheriting one verdict from the card. */}
            <Row label="Views" value={fmtNum(item.views)} sample={!isReal('views')} />
            <Row label="Likes" value={fmtNum(item.likes)} sample={!isReal('likes')} />
            <Row label="Comments" value={fmtNum(item.comments)} sample={!isReal('comments')} />
            <Row label="Shares" value={fmtNum(item.shares)} sample />
            <Row label="Saves" value={fmtNum(item.saves)} sample />
            <Row label="Engagement rate" value={`${item.erPct}%`} sample />
            <Row label="Sentiment" sample value={
              <span className="inline-flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]"
                  style={{ color: item.sentiment === 'Positif' ? VIZ.good : T.t4 }}>
                  {item.sentiment === 'Positif' ? 'sentiment_satisfied' : 'sentiment_neutral'}
                </span>
                {item.sentiment}
              </span>
            } />

            <div className="mt-3">
              <div className="text-[10.5px] mb-1.5" style={{ color: T.t3 }}>Hashtags</div>
              <div className="flex flex-wrap gap-1.5">
                {item.hashtags.map(h => (
                  <span key={h} style={{ ...PJ, background: T.surfaceVariant, color: T.primaryDeep }}
                    className="h-6 px-2 rounded-md text-[10.5px] font-bold inline-flex items-center">
                    {h}
                  </span>
                ))}
              </div>
            </div>

            {/* A harvested post links to itself; a generated one can only offer
                the creator's profile, which is the nearest real thing. */}
            {item.permalink ? (
              <a href={item.permalink} target="_blank" rel="noopener noreferrer"
                style={{ ...PJ, color: T.primary }}
                className="inline-flex items-center gap-1 text-[11px] font-bold mt-3.5 hover:underline">
                Buka post asli
                <span className="material-symbols-outlined text-[14px]">open_in_new</span>
              </a>
            ) : creator.profileUrl ? (
              <a href={creator.profileUrl} target="_blank" rel="noopener noreferrer"
                style={{ ...PJ, color: T.primary }}
                className="inline-flex items-center gap-1 text-[11px] font-bold mt-3.5 hover:underline">
                Buka profil asli
                <span className="material-symbols-outlined text-[14px]">open_in_new</span>
              </a>
            ) : null}
          </div>
        </div>
      )}
    </Overlay>
  )
}

/** Sentiment wears status colours, so each row carries an icon and a label. */
function SentimentBars({ parts }: { parts: { label: string; pct: number }[] }) {
  return (
    <div className="flex flex-col gap-2">
      {parts.map((s, i) => {
        const tone = [
          { c: VIZ.good, icon: 'sentiment_satisfied' },
          { c: T.t4, icon: 'sentiment_neutral' },
          { c: VIZ.critical, icon: 'sentiment_dissatisfied' },
        ][i] ?? { c: T.t4, icon: 'circle' }
        return (
          <div key={s.label} className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]" style={{ color: tone.c }}>{tone.icon}</span>
            <span className="text-[11px] w-[48px]" style={{ color: T.t3 }}>{s.label}</span>
            <div className="flex-1 h-[10px] rounded-[4px]" style={{ background: T.outlineSoft }}>
              <div className="h-full rounded-r-[4px]" style={{ width: `${s.pct}%`, background: tone.c }} />
            </div>
            <span style={{ ...PJ, color: T.t1 }} className="text-[11px] font-extrabold w-[38px] text-right tabular-nums">
              {s.pct}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ── Audience Insights ────────────────────────────────────────────────────── */

/**
 * The pipeline grades its audience inference rather than scoring it, so these
 * are the only three values the column ever holds. Rendered as words because
 * that is what they are — turning `inferred_high` into "83%" would invent a
 * precision the pipeline never claimed.
 */
const CONFIDENCE_LABEL: Record<string, string> = {
  inferred_high: 'keyakinan tinggi',
  inferred_medium: 'keyakinan sedang',
  inferred_low: 'keyakinan rendah',
}

/**
 * Renders one L2 audience breakdown, or nothing when the pipeline has no rows
 * for it. Returning null rather than an empty chart is deliberate: an empty
 * Donut reads as "this creator has no female followers", which is a claim the
 * data does not make.
 */
function GoldBreakdown({
  title, slices, coverage, asDonut,
}: {
  title: string
  slices: { label: string; pct: number; n: number }[]
  /**
   * Share of the audience this dimension could classify, 0..100. The slices are
   * shares of THAT part, not of the whole audience, so a low number here has to
   * be visible or the chart overstates what is known.
   */
  coverage: number | null
  asDonut?: boolean
}) {
  if (!slices.length) return null
  return (
    <div>
      <div style={{ ...PJ, color: T.t3 }} className="text-[10.5px] font-extrabold uppercase tracking-wide mb-2">
        {title}
      </div>
      {asDonut
        ? <Donut parts={slices} centerLabel="terklasifikasi" centerValue={`${slices[0]?.pct ?? 0}%`} />
        : <Bars parts={slices} />}
      {coverage !== null && (
        <p className="text-[9.5px] mt-2 leading-[1.5]" style={{ color: T.t4 }}>
          {coverage < 50
            ? `Hanya ${coverage}% audiens yang bisa diklasifikasi — proporsi di atas dihitung dari bagian itu saja.`
            : `${coverage}% audiens terklasifikasi.`}
        </p>
      )}
    </div>
  )
}

export function AudienceSection({ intel, gold }: SectionProps) {
  const a = intel.audience
  const g = gold?.audience ?? null

  // Each breakdown is independently present: a creator can have geo rows and no
  // interest rows. The sampled card for a dimension is dropped only where L2
  // actually has that dimension, so the page never shows both for the same idea
  // with two different numbers.
  const hasGender = !!g?.gender.length
  const hasAge = !!g?.age.length
  const hasGeo = !!(g?.countries.length || g?.cities.length)
  const hasInterest = !!g?.interests.length

  /**
   * Inference from a follower sample, not a platform report — said once, here.
   * `confidence` is a label (`inferred_high` / `inferred_medium` /
   * `inferred_low`), never a percentage: the column is text and the pipeline
   * grades the inference rather than scoring it.
   */
  const goldNote = g
    ? `Diinferensi dari sampel follower${g.asOf ? `, per ${g.asOf}` : ''}` +
      `${g.confidence ? ` · ${CONFIDENCE_LABEL[g.confidence] ?? g.confidence}` : ''}`
    : undefined

  return (
    <div className="flex flex-col gap-4">
      {(hasGender || hasAge || hasGeo || hasInterest) && g && (
        <VizCard title="Audience Insights (terukur)" subtitle={goldNote}>
          <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))' }}>
            <GoldBreakdown title="Gender" slices={g.gender} coverage={g.coverage.gender} asDonut />
            <GoldBreakdown title="Age" slices={g.age} coverage={g.coverage.age} />
            <GoldBreakdown title="Top Countries" slices={g.countries} coverage={g.coverage.geo} />
            <GoldBreakdown title="Top Cities" slices={g.cities} coverage={null} />
          </div>
          {hasInterest && (
            <div className="mt-5">
              <div style={{ ...PJ, color: T.t3 }} className="text-[10.5px] font-extrabold uppercase tracking-wide mb-2">
                Audience Interests
              </div>
              {g.coverage.interests !== null && g.coverage.interests < 50 && (
                <p className="text-[9.5px] mb-2 leading-[1.5]" style={{ color: T.t4 }}>
                  Hanya {g.coverage.interests}% audiens yang minatnya bisa diklasifikasi.
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {g.interests.map(i => (
                  <span key={i.label} title={`${i.label}: ${i.pct}% (${fmtNum(i.n)} audiens)`}
                    style={{ ...PJ, background: T.surfaceVariant, color: T.primaryDeep }}
                    className="h-7 px-2.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1.5">
                    {i.label}
                    <span style={{ color: T.t3 }} className="font-semibold">{i.pct}%</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </VizCard>
      )}

      <VizCard title="Audience Quality" sample
        subtitle="Kualitas audiens dinilai dari aktivitas, perilaku dan sinyal akun">
        <div className="grid gap-2.5 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
          <StatTile label="Audience authenticity" value={`${a.authenticity}%`} sample />
          <StatTile label="Quality score" value={`${a.qualityScore} / 100`} sample />
          <StatTile label="Potential reach" value={fmtNum(a.potentialReach)} sample />
        </div>
        <Meter label="Authenticity" value={a.authenticity} />
      </VizCard>

      <Split
        main={
          /* A dimension L2 has already measured is NOT estimated again here.
             Two gender donuts on one tab ask the same question twice and answer
             it with two different numbers, and the reader has no way to tell
             which one to believe. The Top Locations and Audience Interests cards
             beside this one already drop out for exactly that reason; these
             blocks follow the same rule so the whole tab is consistent.

             Generation stays whatever happens: it has no L2 counterpart, so it
             is the one estimate here that competes with nothing. */
          <VizCard title="Audience Demographics" sample>
            {(!hasGender || !hasAge) && (
              <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))' }}>
                {!hasGender && (
                  <div>
                    <div style={{ ...PJ, color: T.t3 }} className="text-[10.5px] font-extrabold uppercase tracking-wide mb-2">
                      Gender
                    </div>
                    <Donut parts={a.gender} centerLabel="audiens" centerValue={`${a.gender[0]?.pct ?? 0}%`} />
                  </div>
                )}
                {!hasAge && (
                  <div>
                    <div style={{ ...PJ, color: T.t3 }} className="text-[10.5px] font-extrabold uppercase tracking-wide mb-2">
                      Age
                    </div>
                    {/* Ordinal ramp: the order of the bands is part of the meaning. */}
                    <Bars parts={a.age} ordinal />
                  </div>
                )}
              </div>
            )}
            <div className={(!hasGender || !hasAge) ? 'mt-5' : undefined}>
              <div style={{ ...PJ, color: T.t3 }} className="text-[10.5px] font-extrabold uppercase tracking-wide mb-2">
                Generation
              </div>
              <Bars parts={a.generation} />
            </div>
          </VizCard>
        }
        aside={
          <>
            {!hasGeo && (
              <VizCard title="Top Locations" sample>
                <Bars parts={a.location} />
              </VizCard>
            )}
            {!hasInterest && (
              <VizCard title="Audience Interests" sample>
                <div className="flex flex-wrap gap-1.5">
                  {a.interests.map(i => (
                    <span key={i} style={{ ...PJ, background: T.surfaceVariant, color: T.primaryDeep }}
                      className="h-7 px-2.5 rounded-lg text-[11px] font-bold inline-flex items-center">
                      {i}
                    </span>
                  ))}
                </div>
              </VizCard>
            )}
          </>
        }
      />

      <Split
        main={
          <VizCard title="Audience Authenticity" sample>
            <Bars parts={a.quality} />
            <p className="text-[9.5px] mt-2.5 leading-[1.5]" style={{ color: T.t4 }}>
              Angka authenticity biasanya dihitung dari rasio akun aktif, pola komentar
              dan lonjakan follower. Roster KOL belum menyimpan satu pun sinyal itu.
            </p>
          </VizCard>
        }
        aside={
          <VizCard title="Quality Score" sample>
            <ScoreBlock score={a.qualityScore} verdict={a.qualityScore >= 85 ? 'Strong' : 'Fair'} />
          </VizCard>
        }
      />
    </div>
  )
}

/* ── Campaign History ─────────────────────────────────────────────────────── */

export function CampaignSection({ intel }: SectionProps) {
  const [open, setOpen] = useState<number | null>(0)
  const [status, setStatus] = useState('all')
  const [brand, setBrand] = useState('all')

  const brands = useMemo(
    () => [...new Set(intel.campaigns.map(c => c.brand))], [intel.campaigns])
  const rows = useMemo(
    () => intel.campaigns.filter(c =>
      (status === 'all' || c.status === status) && (brand === 'all' || c.brand === brand)),
    [intel.campaigns, status, brand])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-2.5 flex-wrap">
        <Field label="Status">
          <Select value={status} onChange={setStatus}
            options={[['all', 'Semua status'], ['Completed', 'Completed'], ['Running', 'Running']]} />
        </Field>
        <Field label="Brand">
          <Select value={brand} onChange={setBrand}
            options={([['all', 'Semua brand']] as [string, string][])
              .concat(brands.map(b => [b, b] as [string, string]))} />
        </Field>
      </div>

      <Split
        main={
      <VizCard title="Campaign History" sample
        subtitle="Tabel campaign platform KOL masih kosong — seluruh baris di bawah estimasi">
        <div className="overflow-x-auto">
          <table className="w-full text-[11.5px]" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.outline}` }}>
                {['Campaign', 'Brand', 'Period', 'Deliverables', 'Budget', 'Status', 'Performance'].map(h => (
                  <th key={h} className="text-left py-2 font-bold whitespace-nowrap" style={{ color: T.t3 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={i} onClick={() => setOpen(open === i ? null : i)}
                  className="cursor-pointer hover:bg-[#f9fbfc]"
                  style={{ borderBottom: `1px solid ${T.outlineSoft}` }}>
                  <td className="py-2.5" style={{ ...PJ, color: T.t1, fontWeight: 700 }}>{c.name}</td>
                  <td className="py-2.5" style={{ color: T.t2 }}>{c.brand}</td>
                  <td className="py-2.5 whitespace-nowrap" style={{ color: T.t3 }}>{c.period}</td>
                  <td className="py-2.5 tabular-nums" style={{ color: T.t2 }}>{c.deliverables}</td>
                  <td className="py-2.5 tabular-nums" style={{ color: T.t2 }}>{usd(c.budgetUsd)}</td>
                  <td className="py-2.5">
                    <span style={{
                      ...PJ,
                      background: c.status === 'Completed' ? '#eaf5ef' : '#fdf3e7',
                      color: c.status === 'Completed' ? '#3d8a5f' : '#b5761f',
                    }} className="text-[9.5px] font-extrabold px-2 py-0.5 rounded-full">
                      {c.status}
                    </span>
                  </td>
                  <td className="py-2.5 tabular-nums" style={{ ...PJ, color: T.primaryDeep, fontWeight: 800 }}>
                    {c.erPct}% ER
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </VizCard>
        }
        aside={
          <VizCard title="Collaboration Summary" sample>
            <Row label="Campaigns completed" value={intel.collaboration.completed} />
            <Row label="Avg campaign ER" value={`${intel.collaboration.avgCampaignErPct}%`} />
            <Row label="On-time delivery" value={`${intel.collaboration.onTimePct}%`} />
            <Row label="Repeat collaborations" value={intel.collaboration.repeat} />
            <div className="mt-3">
              <Meter label="Reliability" value={intel.collaboration.reliability} />
            </div>
          </VizCard>
        }
      />

      {open !== null && rows[open] && (
        <VizCard title={`Campaign Overview — ${rows[open].name}`} sample>
          <div className="grid gap-2.5 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
            <StatTile label="Status" value={rows[open].status} sample />
            <StatTile label="Deliverables"
              value={`${rows[open].deliverables} / ${rows[open].deliverables}`} sample />
            <StatTile label="Budget" value={usd(rows[open].budgetUsd)} sample />
            <StatTile label="Payment" value={rows[open].paid ? 'Paid' : 'Pending'} sample />
            <StatTile label="ROAS" value={`${rows[open].roas}x`} sample />
            <StatTile label="Reach" value={fmtNum(rows[open].reach)} sample />
            <StatTile label="Engagement" value={fmtNum(rows[open].engagement)} sample />
          </div>

          <div style={{ ...PJ, color: T.t2 }} className="text-[11.5px] font-extrabold mb-2">Campaign Timeline</div>
          <div className="flex items-center gap-1 flex-wrap">
            {CAMPAIGN_STAGES.map((s, i) => {
              const done = i <= rows[open].stage
              return (
                <span key={s} className="inline-flex items-center gap-1">
                  <span style={{
                    ...PJ,
                    background: done ? T.surfaceVariant : T.surface,
                    borderColor: done ? T.primary : T.outline,
                    color: done ? T.primaryDeep : T.t4,
                  }} className="h-7 px-2.5 rounded-lg border text-[10.5px] font-bold inline-flex items-center gap-1">
                    {done && <span className="material-symbols-outlined text-[13px]">check</span>}
                    {s}
                  </span>
                  {i < CAMPAIGN_STAGES.length - 1 && (
                    <span className="material-symbols-outlined text-[14px]" style={{ color: T.outline }}>
                      chevron_right
                    </span>
                  )}
                </span>
              )
            })}
          </div>
        </VizCard>
      )}
    </div>
  )
}

/* ── Brand Fit ────────────────────────────────────────────────────────────── */

export function BrandFitSection({ intel }: SectionProps) {
  const f = intel.brandFit
  return (
    <div className="flex flex-col gap-4">
      <Split
        main={
          <VizCard title="Brand Fit" sample
            subtitle="Skor ini butuh data audiens dan riwayat campaign — keduanya belum ada">
            <div className="flex items-center gap-7 flex-wrap">
              <div className="w-[128px] flex-shrink-0">
                <ScoreBlock score={f.score} verdict={f.verdict} />
              </div>
              <div className="flex-1 min-w-[240px] flex flex-col gap-2.5">
                {f.bars.map(b => <Meter key={b.label} label={b.label} value={b.pct} />)}
              </div>
            </div>
          </VizCard>
        }
        aside={
          <>
            <VizCard title="Why this creator fits" sample>
              <ul className="flex flex-col gap-2">
                {f.strengths.map(s => (
                  <li key={s} className="flex items-start gap-2 text-[11.5px] leading-[1.5]" style={{ color: T.t2 }}>
                    <span className="material-symbols-outlined text-[15px] mt-px" style={{ color: VIZ.good }}>check_circle</span>
                    {s}
                  </li>
                ))}
              </ul>
            </VizCard>

            <VizCard title="Potential Risk" sample>
              <ul className="flex flex-col gap-2">
                {f.watchouts.map(s => (
                  <li key={s} className="flex items-start gap-2 text-[11.5px] leading-[1.5]" style={{ color: T.t2 }}>
                    <span className="material-symbols-outlined text-[15px] mt-px" style={{ color: VIZ.warning }}>warning</span>
                    {s}
                  </li>
                ))}
              </ul>
            </VizCard>
          </>
        }
      />
    </div>
  )
}

/* ── AI Insights ──────────────────────────────────────────────────────────── */

export function AiSection({ creator, rank, intel }: SectionProps) {
  const ai = intel.ai
  return (
    <div className="flex flex-col gap-4">
      <VizCard title="AI Summary" sample>
        <p className="text-[12.5px] leading-[1.65]" style={{ color: T.t2 }}>{ai.summary}</p>
        {/* The one paragraph on this tab that is not sampled. */}
        <div className="mt-3 rounded-xl px-3 py-2.5" style={{ background: T.surfaceVariant }}>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="material-symbols-outlined text-[15px]" style={{ color: T.primary }}>verified</span>
            <span style={{ ...PJ, color: T.primaryDeep }} className="text-[10.5px] font-extrabold uppercase tracking-wide">
              Dari data asli
            </span>
          </div>
          <p className="text-[11.5px] leading-[1.6]" style={{ color: T.t2 }}>
            @{creator.username} berada di peringkat <b>#{rank.followersRank.toLocaleString('id-ID')}</b> dari{' '}
            {rank.rosterTotal.toLocaleString('id-ID')} creator berdasarkan followers
            {rank.categoryName && rank.categoryFollowersRank !== null && (
              <> — dan <b>#{rank.categoryFollowersRank}</b> di kategori {rank.categoryName}{' '}
              ({rank.categoryTotal.toLocaleString('id-ID')} creator)</>
            )}
            {rank.erRank !== null && (
              <>. Engagement rate-nya peringkat <b>#{rank.erRank.toLocaleString('id-ID')}</b> dari{' '}
              {rank.erMeasuredTotal.toLocaleString('id-ID')} creator yang pernah diukur</>
            )}.
          </p>
        </div>
      </VizCard>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        <VizCard title="Strengths" sample>
          <ul className="flex flex-col gap-2">
            {ai.strengths.map(s => (
              <li key={s} className="flex items-start gap-2 text-[11.5px]" style={{ color: T.t2 }}>
                <span className="material-symbols-outlined text-[15px] mt-px" style={{ color: VIZ.good }}>check</span>
                {s}
              </li>
            ))}
          </ul>
        </VizCard>

        <VizCard title="Watch-outs" sample>
          <ul className="flex flex-col gap-2">
            {ai.watchouts.map(s => (
              <li key={s} className="flex items-start gap-2 text-[11.5px]" style={{ color: T.t2 }}>
                <span className="material-symbols-outlined text-[15px] mt-px" style={{ color: VIZ.warning }}>warning</span>
                {s}
              </li>
            ))}
          </ul>
        </VizCard>
      </div>

      <Split
        main={
          <VizCard title="Predicted Growth" sample>
            <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))' }}>
              <StatTile label="Current" value={creator.followers === null ? '—' : fmtNum(creator.followers)}
                hint="data asli" />
              <StatTile label="30 hari" value={fmtNum(ai.predicted.d30)} sample />
              <StatTile label="90 hari" value={fmtNum(ai.predicted.d90)} sample />
              <StatTile label="6 bulan" value={fmtNum(ai.predicted.m6)} sample />
            </div>
          </VizCard>
        }
        aside={
          <>
            <VizCard title="Recommended Campaign" sample>
              <Row label="Campaign type" value={ai.suggestion.campaignType} />
              <Row label="Best content" value={ai.suggestion.content} />
              <Row label="Objective" value={ai.suggestion.objective} />
              <Row label="Posting time" value={ai.suggestion.postingTime} />
            </VizCard>

            <VizCard title="Suggested Brands" sample>
              <div className="flex flex-wrap gap-1.5">
                {intel.suggestedBrands.map(b => (
                  <span key={b} style={{ ...PJ, background: T.surfaceVariant, color: T.primaryDeep }}
                    className="h-7 px-2.5 rounded-lg text-[11px] font-bold inline-flex items-center">
                    {b}
                  </span>
                ))}
              </div>
            </VizCard>
          </>
        }
      />
    </div>
  )
}

/* ── shared form bits ─────────────────────────────────────────────────────── */

/** Used by the sub-filter rows above Performance, Content and Campaign. */
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
