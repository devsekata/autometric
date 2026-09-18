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
 * `l1_silver.unified_rate_card` backs the price; `l2_gold` and `feature` back
 * growth, audience, per-post ER and the format ER.
 *
 * Nothing is sampled. A figure with no source for this creator renders as
 * "Belum terukur" or an `Unavailable` panel — never as a generated number.
 */

import { useCallback, useMemo, useState } from 'react'
import { PJ, TOKENS as T, PLATFORM_ICON, fmtNum, Btn } from './ui'
import { exportCsv, exportExcel, type ExportColumn } from './exportData'
import {
  Bars, Donut, EmptyBlock, Meter, Overlay, Row, Split, TrendChart,
  VIZ, VizCard, StatTile,
} from './kolViz'
import type { ContentItem } from '@/lib/discover/kolIntel'
import { avgViewsBasis, measuredBasis, type CreatorIntel } from '@/lib/discover/kolIntel'
import type {
  KolCreatorIdentity, KolCreatorPlatformRow, KolCreatorRank, KolDirectoryRow, KolSimilarRow,
} from '@/lib/discover/kolDirectory'
import type { GoldFormatDay, GoldHeatmapCell, GoldPost, KolGold } from '@/lib/discover/kolGold'
import { formatErRows } from '@/lib/discover/kolFormatEr'

export interface SectionProps {
  creator: KolDirectoryRow
  identity: KolCreatorIdentity
  rank: KolCreatorRank
  platforms: KolCreatorPlatformRow[]
  similar: KolSimilarRow[]
  /** Measured figures, each null where the warehouse has no source. */
  intel: CreatorIntel
  /**
   * The L2 Gold rollups, when the pipeline has any for this creator. A third
   * provenance alongside roster and L1: figures the warehouse aggregated ahead
   * of time rather than ones this page derives.
   *
   * Null, and each field inside independently empty, so a section renders its
   * real block only where L2 actually has rows and otherwise an unavailable
   * state. Never coalesce a null to zero — `null` here means "the pipeline could
   * not measure it", which is what the missing Insights columns are.
   */
  gold: KolGold | null
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', youtube: 'YouTube',
}
export const platformLabel = (k: string | null) => (k ? PLATFORM_LABEL[k] ?? k : '—')

const pctLabel = (n: number) => `${n.toFixed(2)}%`

/* ── Performance ──────────────────────────────────────────────────────────── */

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

export function PerformanceSection({ creator, rank, platforms, intel, gold }: SectionProps) {
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

  /**
   * The L2 card for this creator's own platform, falling back to the largest.
   * `kolGold` returns one card per linked account ordered by followers, and the
   * roster row this page was opened from names exactly one platform.
   */
  const goldCard = useMemo(() => {
    const cards = gold?.cards ?? []
    if (!cards.length) return null
    return cards.find(c => c.platform === creator.platform) ?? cards[0]
  }, [gold, creator.platform])

  /**
   * Real follower growth, straight from `l2_gold.kol_profile_card`. It is the
   * change since the account's PREVIOUS snapshot — 10-13 days apart today, not
   * a month — so it is never labelled "monthly". Null for the creators the
   * pipeline has scraped only once, which is most of the roster; those keep the
   * modelled figure with its estimate marker.
   */
  const realGrowth = goldCard?.followersGrowth ?? null

  const hasGold = goldPoints.length > 0 || (gold?.daily.length ?? 0) > 0

  /*
   * The generated six-month series is gone. The real trend is the L2 Gold card
   * below, which reads `kol_metric_daily` / `kol_metric_monthly` and carries its
   * own grain and metric controls.
   *
   * The Platform / Period / Metric row that sat above it drove nothing once
   * that series went — and its Metric list still offered Reach, which has no
   * column. Removed rather than left as controls that change no number.
   */

  return (
    <div className="flex flex-col gap-4">
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
          {/* Every tile is a measurement or says it is not. They used to fall
              back to `kolSample` values behind an estimate marker; nothing here
              falls back now.

              Reach and Impressions have no column on this server at all -
              `unified_post.reach` is 0 in all 503 rows - so they are permanently
              unavailable rather than derived from views. Views are not reach. */}
          <StatTile label="Engagement Rate"
            value={creator.erPct === null ? NOT_MEASURED : pctLabel(creator.erPct)}
            hint={creator.erSource === 'feature' ? 'dari engagement analysis'
              : creator.erSource === 'roster' ? 'dari data roster' : undefined} />
          <StatTile label="Reach" value={NOT_MEASURED} hint="tidak ada kolom reach" />
          <StatTile label="Impressions" value={NOT_MEASURED} hint="tidak ada kolom impressions" />
          <StatTile label="Views (rata-rata)"
            value={intel.kpi.avgViews === null ? NOT_MEASURED : fmtNum(intel.kpi.avgViews)}
            hint={intel.kpi.avgViews === null ? undefined : avgViewsBasis(creator)} />
          <StatTile label="Likes (total)"
            value={intel.performance.likes === null ? NOT_MEASURED : fmtNum(intel.performance.likes)}
            hint={intel.performance.likes === null ? undefined : basis} />
          <StatTile label="Comments (total)"
            value={intel.performance.comments === null ? NOT_MEASURED : fmtNum(intel.performance.comments)}
            hint={intel.performance.comments === null ? undefined : basis} />
          <StatTile label="Shares (total)"
            value={intel.performance.shares === null ? NOT_MEASURED : fmtNum(intel.performance.shares)}
            hint={intel.performance.shares === null ? undefined : basis} />
          <StatTile label="Saves (total)"
            value={intel.performance.saves === null ? NOT_MEASURED : fmtNum(intel.performance.saves)}
            hint={intel.performance.saves === null ? undefined : basis} />
        </div>
      </VizCard>

      <Split
        main={
          <VizCard title="Performance Trend">
            {hasGold
              ? (
                <p className="text-[11px] leading-relaxed" style={{ color: T.t3 }}>
                  Tren terukur creator ini ada di kartu <b>Performance (terukur, L2 Gold)</b> di
                  atas, lengkap dengan pilihan harian/bulanan.
                </p>
              )
              : <Unavailable text="Data trend belum tersedia untuk creator ini — pipeline belum mencatat metrik harian maupun bulanan." />}
          </VizCard>
        }
        /* "Performance Highlights" was three generated sentences — a views
           delta, a reach delta and a category comparison — all computed from
           `between()` rather than from any measurement. There is no real
           period-over-period source for this creator, so the claims are gone
           rather than re-worded. */
        aside={
          <VizCard title="Performance Highlights">
            <Unavailable text="Belum ada pembanding periode sebelumnya untuk creator ini, jadi perubahan views dan reach belum bisa dihitung." />
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
                {/* "Avg. reach" was followers x 0.32 and "Avg. views" was
                    followers x 0.41 — two arbitrary multipliers with no source,
                    printed per platform as if measured per platform. Both rows
                    are removed: reach has no column anywhere on this server, and
                    per-platform views are not broken out. The creator-level view
                    average is on the Performance tab, from real posts. */}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[11.5px]" style={{ color: T.t3 }}>
            Hanya ada satu akun ({platformLabel(creator.platform)}) untuk username ini di
            roster, jadi tidak ada yang bisa dibandingkan.{' '}
            {rank.multiPlatformTotal.toLocaleString('id-ID')} creator di roster punya
            akun di dua platform sekaligus.
          </p>
        )}
      </VizCard>

      <Split
        main={
          <VizCard title="Growth" subtitle="Follower growth">
            {/* The six-month follower curve was generated: the warehouse holds
                at most two profile snapshots per account, so there is no history
                to draw and there never was. The real tiles below stay. */}
            <Unavailable text="Riwayat follower belum tersedia — pipeline baru menyimpan paling banyak dua snapshot profil per akun." />
            <div className="grid gap-2.5 mt-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
              <StatTile label="Current followers"
                value={creator.followers === null ? '—' : fmtNum(creator.followers)}
                hint="data asli roster" />
              {/* Real wherever the pipeline has two snapshots for this account.
                  Deliberately NOT called "Monthly": the window is whatever the
                  scraper produced between the two, which is 10-13 days today. */}
              <StatTile label="Sejak snapshot terakhir"
                value={realGrowth === null
                  ? NOT_MEASURED
                  : `${realGrowth > 0 ? '+' : ''}${realGrowth.toFixed(2)}%`}
                hint={realGrowth === null
                  ? 'butuh dua snapshot; creator ini baru punya satu'
                  : goldCard?.snapshotDate
                    ? `data asli L2 Gold · snapshot ${goldCard.snapshotDate}`
                    : 'data asli L2 Gold'} />
              {/* "3 bulan" and "6 bulan" are gone rather than repointed.
                  `followers_growth` is defined by the pipeline as
                  (now - prev) / prev * 100 between CONSECUTIVE SNAPSHOTS, and
                  the docs are explicit that this is not a fixed window - the gap
                  is whatever the scraper produced. There is no 3-month or
                  6-month figure in the database to show, and deriving one from a
                  single ~10-day reading would be fabricating a trend from one
                  point. The tile above is the only growth this source supports. */}
              <StatTile label="3 bulan" value={NOT_MEASURED}
                hint="database hanya menyimpan perubahan antar snapshot" />
              <StatTile label="6 bulan" value={NOT_MEASURED}
                hint="database hanya menyimpan perubahan antar snapshot" />
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
  /*
   * Only the measured interactions enter the split. A creator with real likes
   * and comments but no shares column gets a two-bar chart over what was
   * counted, not a four-bar chart where two bars are zero - a zero bar claims
   * "this creator gets no shares", which is a different statement from "shares
   * were never harvested".
   */
  const measured = ([
    { label: 'Likes', n: p.likes },
    { label: 'Comments', n: p.comments },
    { label: 'Shares', n: p.shares },
    { label: 'Saves', n: p.saves },
  ] as { label: string; n: number | null }[])
    .filter((x): x is { label: string; n: number } => x.n !== null)

  const total = measured.reduce((sum, x) => sum + x.n, 0)
  const parts = total > 0
    ? measured.map(x => ({ label: x.label, pct: Math.round((x.n / total) * 1000) / 10 }))
    : []

  return (
    <VizCard title="Engagement Breakdown" subtitle="Bagian dari total interaksi">
      {parts.length === 0
        ? <Unavailable text="Belum ada interaksi terukur untuk creator ini." />
        : <Bars parts={parts} />}
      <div className="mt-3">
        {/* Real now: the sum of the measured interactions above. */}
        <Row label="Total interaksi" value={total > 0 ? fmtNum(total) : NOT_MEASURED} />
      </div>
    </VizCard>
  )
}

function MetricRow({ label, cells }: { label: string; cells: string[] }) {
  return (
    <tr style={{ borderBottom: `1px solid ${T.outlineSoft}` }}>
      <td className="py-2" style={{ color: T.t3 }}>
        <span className="inline-flex items-center gap-1.5">{label}</span>
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
 * Sorts for the L2 post table. Declared apart from `CONTENT_SORTS` because the
 * two tables hold different post sets (L1 recent twelve vs. L2 up to 200), even
 * though `top` means the pipeline's `er_followers` in both.
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
 * A post's ISO timestamp (or `YYYY-MM-DD`) as a short Indonesian date. Anything
 * that is not a date is returned untouched.
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

/** The pipeline stores ER as a fraction 0..1; every screen shows a percentage. */
const erLabel = (v: number | null) => (v === null ? '\u2014' : `${(v * 100).toFixed(2)}%`)

/**
 * One row per published post, carrying the pipeline's own rank and ER rather
 * than figures this page derives.
 *
 * Sits ABOVE the content grid instead of replacing it. The grid holds covers and
 * captions, which `post_metric` does not store; this table holds the pipeline's
 * rank and ER. Two different things about the same posts.
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
 * Posting-time heatmap, 7 rows x 24 columns, Asia/Jakarta.
 *
 * `dow` arrives as Postgres EXTRACT(DOW) — 0 is Sunday — and the hour is
 * already local, so neither is shifted here. Cells the creator never posted in
 * are blank rather than zero: "no post at 3am on a Tuesday" and "a post that
 * got no engagement" are different facts and should not share a shade.
 */
const DOW_LABEL = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']

function HeatmapCard({ cells }: { cells: GoldHeatmapCell[] }) {
  const { grid, max, total } = useMemo(() => {
    const g = new Map<string, { posts: number; eng: number | null }>()
    let mx = 0, tot = 0
    for (const c of cells) {
      if (c.dow < 0 || c.dow > 6 || c.hour < 0 || c.hour > 23) continue
      const key = `${c.dow}-${c.hour}`
      const cur = g.get(key) ?? { posts: 0, eng: null }
      cur.posts += c.posts
      cur.eng = c.avgEngagement === null ? cur.eng : (cur.eng ?? 0) + c.avgEngagement
      g.set(key, cur)
      mx = Math.max(mx, cur.posts)
      tot += c.posts
    }
    return { grid: g, max: mx, total: tot }
  }, [cells])

  if (!total) return null

  return (
    <VizCard title="Waktu Posting (terukur, Feature)"
      subtitle={`${total} post · WIB · dari best_posting_time_heatmap`}>
      <div className="overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: 2 }}>
          <tbody>
            {DOW_LABEL.map((label, dow) => (
              <tr key={label}>
                <td className="text-[9px] pr-1.5 whitespace-nowrap" style={{ color: T.t4 }}>
                  {label}
                </td>
                {Array.from({ length: 24 }, (_, hour) => {
                  const cell = grid.get(`${dow}-${hour}`)
                  const ratio = cell && max ? cell.posts / max : 0
                  return (
                    <td key={hour} className="w-[11px] h-[11px] rounded-[2px]"
                      title={cell
                        ? `${label} ${String(hour).padStart(2, '0')}:00 WIB · ${cell.posts} post`
                        : `${label} ${String(hour).padStart(2, '0')}:00 WIB · tidak ada post`}
                      style={{
                        background: cell
                          ? `color-mix(in srgb, ${T.primary} ${Math.round(20 + ratio * 80)}%, transparent)`
                          : T.surfaceVariant,
                      }} />
                  )
                })}
              </tr>
            ))}
            <tr>
              <td />
              {Array.from({ length: 24 }, (_, h) => (
                <td key={h} className="text-[7px] text-center" style={{ color: T.t4 }}>
                  {h % 6 === 0 ? h : ''}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </VizCard>
  )
}

/**
 * The format mix and the ER behind it, from `l2_gold.content_format_daily`.
 *
 * Replaces the L1 "Content Format" card for creators the pipeline covers;
 * everyone else keeps the L1 mix, or an unavailable state.
 *
 * ER per format comes from `formatErRows` — see `@/lib/discover/kolFormatEr`
 * for why engagement and its denominator are summed over the same days only.
 */
function GoldFormatsCard({ formats, dominant }: {
  formats: GoldFormatDay[]
  dominant: KolGold['dominantFormat']
}) {
  const rows = useMemo(() => formatErRows(formats), [formats])

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
      subtitle={[
        dominant ? `Dominan: ${dominant.mediaType} (${dominant.pct}%)` : null,
        `${totalPosts} post`,
        `${days} hari tercatat`,
      ].filter(Boolean).join(' \u00b7 ')}>
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
export function ContentSection({ creator, rank, intel, gold }: SectionProps) {
  const [format, setFormat] = useState('all')
  const [sort, setSort] = useState<string>('top')
  const [openItem, setOpenItem] = useState<ContentItem | null>(null)
  const [failedCovers, setFailedCovers] = useState<string[]>([])
  const noteCoverFail = useCallback(
    (src: string) => setFailedCovers(f => (f.includes(src) ? f : [...f, src])), [])

  const formats = useMemo(
    () => [...new Set(intel.content.recent.map(c => c.format))], [intel.content.recent])

  const items = useMemo(() => {
    const out = intel.content.recent.filter(c => format === 'all' || c.format === format)
    // `?? -1` sorts an unmeasured post below every measured one rather than
    // treating it as a zero, which would read as a post that flopped.
    if (sort === 'views') return [...out].sort((a, b) => (b.views ?? -1) - (a.views ?? -1))
    if (sort === 'top') return [...out].sort((a, b) => (b.erPct ?? -1) - (a.erPct ?? -1))
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

          <VizCard title="Content Performance"
            subtitle={intel.real.content
              ? `${intel.measured?.postCount ?? 0} post asli dari warehouse — setiap angka di bawah terukur atau ditandai belum terukur`
              : 'Roster tidak menyimpan satu pun post untuk creator ini'}
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
                      {/* Each figure is the post's own or absent. A post whose
                          views the harvest missed shows no view count rather
                          than a zero, and keeps the numbers it does carry. */}
                      <div style={{ ...PJ, color: T.t1 }} className="text-[13px] font-extrabold mt-0.5">
                        {c.views === null ? NOT_MEASURED : fmtNum(c.views)}
                      </div>
                      <div className="text-[10px]" style={{ color: T.t4 }}>
                        {[
                          c.views === null ? null : 'views',
                          c.erPct === null ? null : `ER ${c.erPct.toFixed(2)}%`,
                          c.likes === null ? null : `${fmtNum(c.likes)} likes`,
                        ].filter(Boolean).join(' · ') || 'belum ada metrik'}
                      </div>
                      <div className="text-[9.5px] mt-0.5" style={{ color: T.t4 }}>
                        {c.format}
                        {c.postedAt ? ` · ${postedLabel(c.postedAt)}` : ''}
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
            {/* Measured posting-time heatmap. Renders only when the feature
                layer actually has cells for this creator. */}
            <HeatmapCard cells={gold?.heatmap ?? []} />
            {goldFormats.length > 0 ? (
              <GoldFormatsCard formats={goldFormats} dominant={gold?.dominantFormat ?? null} />
            ) : (
              /* `intel.content.formats` is the real mix counted across this
                 creator's harvested posts now — it used to be a generated
                 distribution over a hardcoded format list, which is why the
                 card carried a sample flag it no longer needs. */
              <VizCard title="Content Format" subtitle={measuredBasis(intel)}>
                {intel.content.formats.length > 0
                  ? <Bars parts={intel.content.formats.map(f => ({ label: f.label, pct: f.pct }))} />
                  : <Unavailable text="Belum ada post creator ini yang dipanen, jadi komposisi format belum bisa dihitung." />}
              </VizCard>
            )}
            {/* The source's "Top hashtags & keywords" panel, which it filled from
                a written-in list. Counted here across every harvested post, so it
                only appears for a creator whose posts carry tags. */}
            {!intel.real.hashtags && (
              <VizCard title="Top Hashtags">
                <Unavailable text={`Post creator ini belum memuat hashtag yang terpanen — ${rank.hashtagCreatorTotal.toLocaleString('id-ID')} dari ${rank.rosterTotal.toLocaleString('id-ID')} creator punya data hashtag.`} />
              </VizCard>
            )}
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
            {/* Posting cadence as the API returns it: `post_frequency_monthly`
                from L2, the one agreed unit, over the real first-to-last span.
                Not recomputed here, so this card and the directory agree. */}
            <VizCard title="Frekuensi Posting"
              subtitle={creator.postFrequencyCount
                ? `dari ${creator.postFrequencyCount} post · ${creator.observationDays ?? '—'} hari`
                : undefined}>
              {creator.postFrequencyMonthly === null
                ? <Unavailable text="Frekuensi posting belum dihitung pipeline untuk creator ini." />
                : (
                  <div style={{ ...PJ, color: T.t1 }} className="text-[20px] font-extrabold">
                    {creator.postFrequencyMonthly.toLocaleString('id-ID', { maximumFractionDigits: 1 })}
                    <span className="text-[11px] font-bold ml-1.5" style={{ color: T.t3 }}>
                      post / bulan
                    </span>
                    {creator.postFrequencyReliability && (
                      <span className="text-[10px] font-semibold ml-1.5" style={{ color: T.t4 }}>
                        · reliabilitas {creator.postFrequencyReliability}
                      </span>
                    )}
                  </div>
                )}
            </VizCard>
            {/* Content Topic was generated from the creator's id. It is the
                API's `content_topic` now (L2, migration 039), printed with its
                source: a topic that fell back to the roster category is not
                one read from the posts. Sentiment reads
                `feature.*_comments_analysis`, which holds 0 rows. */}
            <VizCard title="Content Topic"
              subtitle={creator.contentTopic
                ? creator.contentTopicSource === 'creator_category_fallback'
                  ? 'dari kategori roster — belum dari analisis post'
                  : creator.contentTopicSource ?? undefined
                : undefined}>
              {creator.contentTopic
                ? (
                  <span style={{ ...PJ, background: T.surfaceVariant, color: T.primaryDeep }}
                    className="h-7 px-2.5 rounded-lg text-[11.5px] font-bold inline-flex items-center">
                    {creator.contentTopic}
                  </span>
                )
                : <Unavailable text="Topik konten belum diisi pipeline untuk creator ini." />}
            </VizCard>
            <VizCard title="Sentiment">
              <Unavailable text="Analisis sentimen komentar belum tersedia — tabel comments analysis masih kosong." />
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
}: { item: ContentItem | null; creator: KolDirectoryRow; onClose: () => void }) {
  /*
   * `measuredFields` and the `measured` flag are gone with the overlay that
   * needed them: every post here is a real harvested post now, and every figure
   * on it is either the post's own value or null. There is no "real on these
   * three fields, modelled on the rest" state left to encode.
   */
  const num = (v: number | null) => (v === null ? NOT_MEASURED : fmtNum(v))

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
              {item.platform} · {item.format}
              {item.postedAt ? ` · ${postedLabel(item.postedAt)}` : ''}
            </div>
          </div>

          <div className="flex-1 min-w-[240px]">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span style={{ ...PJ, color: T.t1 }} className="text-[12.5px] font-extrabold">{item.title}</span>
              {item.sponsored && (
                <span style={{ ...PJ, background: T.surfaceVariant, color: T.primaryDeep }}
                  className="text-[9.5px] font-extrabold px-1.5 py-0.5 rounded">
                  Paid partnership
                </span>
              )}
            </div>
            {item.caption && (
              <p className="text-[11.5px] leading-[1.6] mb-3" style={{ color: T.t2 }}>{item.caption}</p>
            )}

            {/* Every row is this post's own figure or "Belum terukur".
                Engagement rate is the pipeline's `post_metric.er_followers`,
                null where it left it null. Sentiment is gone — the
                comments-analysis table holds zero rows. */}
            <Row label="Views" value={num(item.views)} />
            <Row label="Likes" value={num(item.likes)} />
            <Row label="Comments" value={num(item.comments)} />
            {/* Projected from `unified_post` since Phase 4D — real for the
                creators whose harvest carried them, unavailable otherwise. */}
            <Row label="Shares" value={num(item.shares)} />
            <Row label="Saves" value={num(item.saves)} />
            <Row label="Engagement rate (followers)"
              value={item.erPct === null ? NOT_MEASURED : `${item.erPct.toFixed(2)}%`} />
            {item.permalink && (
              <Row label="Permalink" value={
                <a href={item.permalink} target="_blank" rel="noreferrer"
                  style={{ color: T.primary }} className="underline">Buka post</a>
              } />
            )}

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

            {/* A post without a permalink falls back to the creator's profile,
                the nearest real thing. */}
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

export function AudienceSection({ creator, gold }: SectionProps) {
  /*
   * `intel.audience` is gone from this section entirely.
   *
   * Every signal below now comes from L2 Gold or `feature.*_audience_analysis`,
   * and a creator without those rows gets an unavailable state rather than the
   * seeded gender split, city list, interest tags and authenticity score
   * `kolSample` used to synthesise. Coverage is 27 of 7,432 creators, so most
   * of this tab is now empty - which is what the database actually knows.
   */
  const g = gold?.audience ?? null
  const q = gold?.audienceQuality ?? null
  // The composite is the API's L2 value, the same one the header KPI shows;
  // authenticity and follower quality have no L2 column and come from feature.
  const aq = creator.audienceQualityScore

  // Each breakdown is independently present: a creator can have geo rows and no
  // interest rows. The unavailable card for a dimension shows only where L2 has
  // nothing for it.
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

      {/* Real scores, derived by the pipeline from a sampled ~100 real
          followers per account - see `GoldAudienceQuality`. The three tiles
          used to be `between(68, 96)` and two numbers computed from it.
          `Potential reach` is dropped rather than migrated: reach has no source
          on this server at all, and stays out of scope. */}
      <VizCard
        title="Audience Quality"
        subtitle={q
          ? 'Dihitung dari sampel follower yang di-scrape — bukan laporan platform'
          : undefined}
      >
        {aq !== null || (q && (q.authenticity !== null || q.followerQuality !== null)) ? (
          <>
            <div className="grid gap-2.5 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
              <StatTile
                label="Audience authenticity"
                value={q?.authenticity == null ? NOT_MEASURED : `${q.authenticity}%`}
              />
              <StatTile
                label="Audience quality"
                value={aq === null ? NOT_MEASURED : `${aq} / 100`}
                hint={creator.audienceQualityTier ?? undefined}
              />
              <StatTile
                label="Follower quality"
                value={q?.followerQuality == null ? NOT_MEASURED : `${q.followerQuality} / 100`}
              />
            </div>
            {q?.authenticity != null && <Meter label="Authenticity" value={q.authenticity} />}
            <p className="text-[9.5px] mt-2.5 leading-[1.5]" style={{ color: T.t4 }}>
              Authenticity = bagian follower yang tidak berpola akun massal.
              Follower quality = bagian yang punya nama, tidak privat, dan punya bio/foto.
              Audience quality = rata-rata keduanya
              {aq !== null && q?.followerQuality != null
                && aq === q.followerQuality
                ? ' — untuk akun ini keduanya sama karena authenticity tidak bisa dihitung.'
                : '.'}
            </p>
          </>
        ) : (
          <Unavailable text="Belum ada analisis kualitas audiens untuk creator ini — pipeline baru menganalisis sampel follower untuk sebagian kecil roster." />
        )}
      </VizCard>

      <Split
        main={
          /* A dimension L2 has already measured is NOT estimated again here.
             Two gender donuts on one tab ask the same question twice and answer
             it with two different numbers, and the reader has no way to tell
             which one to believe. The Top Locations and Audience Interests cards
             beside this one already drop out for exactly that reason; these
             blocks follow the same rule so the whole tab is consistent. */
          <VizCard title="Audience Demographics">
            {/* The generated gender donut is gone. When L2 has gender it is
                drawn by the card above; when it does not, there is nothing to
                draw and saying so is the whole point. */}
            {!hasGender && (
              <div>
                <div style={{ ...PJ, color: T.t3 }} className="text-[10.5px] font-extrabold uppercase tracking-wide mb-2">
                  Gender
                </div>
                <Unavailable text="Demografi gender audiens belum diinferensi untuk creator ini." />
              </div>
            )}
            {/* The generated Age bars and the Generation card are gone.
                Age has a real path - `l2_gold.audience_demographics_daily` with
                `audience_type='age'`, rendered above when `hasAge` - which is
                empty for every creator today; the generated five-band chart that
                stood in for it is not a smaller version of that, it is a
                different thing wearing its clothes. Generation had no real
                counterpart at all and was derived from the generated age split,
                so it goes with it. */}
            {!hasAge && (
              <div className="mt-5">
                <div style={{ ...PJ, color: T.t3 }} className="text-[10.5px] font-extrabold uppercase tracking-wide mb-2">
                  Age
                </div>
                <Unavailable text="Demografi umur audiens belum tersedia untuk creator manapun di database ini — pipeline baru mengisi gender." />
              </div>
            )}
          </VizCard>
        }
        aside={
          <>
            {/* Both fallbacks removed. `Top Locations` drew four cities off a
                hardcoded CITIES list, and `Audience Interests` drew a seeded
                slice of an INTERESTS fixture - neither had any connection to
                this creator's audience. Creator city is a different fact from
                audience location and was never a valid stand-in for it. */}
            {!hasGeo && (
              <VizCard title="Top Locations">
                <Unavailable text="Geografi audiens belum diinferensi untuk creator ini." />
              </VizCard>
            )}
            {!hasInterest && (
              <VizCard title="Audience Interests">
                <Unavailable text="Minat audiens belum diinferensi untuk creator ini." />
              </VizCard>
            )}
          </>
        }
      />

      {/* "Audience Authenticity" and "Quality Score" both stood here as a
          second, generated copy of the Audience Quality card above - a seeded
          Authentic/Suspicious/Inactive split and a seeded 0-100 score with a
          hand-written verdict. The real scores are in that one card now, from
          `feature.*_audience_analysis`, so these two are removed rather than
          duplicated: two cards answering one question with two different
          numbers is the failure the Audience tab already avoids for gender. */}
    </div>
  )
}

/** Shown in a value slot the database cannot fill. Never '0', never a dash. */
const NOT_MEASURED = 'Belum terukur'

/**
 * The honest stand-in for a panel whose data does not exist.
 *
 * Words, never a zero and never a dash: a dash in a chart slot reads as "nothing
 * to report", and the point is that nobody has measured it. Each call names the
 * missing table so a reader can tell a coverage gap from a broken screen.
 */
function Unavailable({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl px-3 py-2.5"
      style={{ background: T.surfaceVariant }}>
      <span className="material-symbols-outlined text-[16px] mt-px" style={{ color: T.t4 }}>
        do_not_disturb_on
      </span>
      <p className="text-[11.5px] leading-relaxed" style={{ color: T.t3 }}>{text}</p>
    </div>
  )
}

/* -- Campaign History ------------------------------------------------------ */

/**
 * There is no campaign history for a roster creator, and there is no table that
 * could hold one: `public.campaigns` and `public.campaign_kols` are both empty
 * on the KOL server.
 *
 * What stood here was a filterable table of two to five generated campaigns per
 * creator - invented brand names off a `['Nike','Adidas',...]` fixture, invented
 * budgets in USD, invented ROAS, invented delivery status - plus a
 * "Collaboration Summary" reporting an on-time delivery rate and a reliability
 * score for collaborations that never happened.
 *
 * That was the most dangerous screen in the workspace. A buyer deciding whether
 * to trust a creator with a brief reads "on-time delivery 94%" as a fact about
 * a person, and acts on it. The whole section is replaced by one honest panel.
 *
 * Campaigns this workspace's own org has run are a different thing and live in
 * the Campaign module, which is untouched.
 */
export function CampaignSection() {
  return (
    <div className="flex flex-col gap-4">
      <VizCard title="Campaign History">
        <Unavailable text="Database KOL belum menyimpan riwayat campaign untuk creator manapun — tabel campaigns dan campaign_kols masih kosong. Campaign yang organisasi kamu jalankan sendiri tetap tercatat di modul Campaign." />
      </VizCard>
    </div>
  )
}

/* ── Brand Fit ────────────────────────────────────────────────────────────── */

/**
 * Brand Fit had a generated score, verdict, component bars, strengths and
 * watch-outs, none of which knew anything about a brand. There is no brand-fit
 * table on the KOL server, so the section says so instead of scoring.
 */
export function BrandFitSection() {
  return (
    <div className="flex flex-col gap-4">
      <VizCard title="Brand Fit">
        <Unavailable text="Skor brand fit belum tersedia — database KOL belum punya analisis kecocokan creator dengan brand, jadi tidak ada skor yang ditampilkan." />
      </VizCard>
    </div>
  )
}

/* -- AI Insights ----------------------------------------------------------- */

/**
 * The generated layer is gone.
 *
 * `ai.summary`, `ai.strengths`, `ai.watchouts`, `ai.suggestion` and the 30/90/180-day
 * growth predictions were template strings interpolated over generated numbers -
 * no model ran, nothing was analysed, and the copy asserted conclusions
 * ("audiensnya didominasi perempuan Millennials") that no table backs.
 *
 * The one paragraph here that was always real stays: the creator's actual
 * standing in the roster, computed from `kol_directory` follower counts and
 * engagement rates by `getKolCreator`. It is labelled as what it is.
 *
 * No replacement template was written. An "AI Insights" panel that generates
 * fluent sentences from a hash is worse than an empty one, because fluency is
 * what makes a reader believe it.
 */
export function AiSection({ creator, rank }: SectionProps) {
  return (
    <div className="flex flex-col gap-4">
      <VizCard title="AI Insights">
        <Unavailable text="Belum ada analisis AI untuk creator ini. Insight otomatis akan muncul setelah data konten dan audiens creator cukup untuk dianalisis." />
      </VizCard>

      <VizCard title="Posisi di roster" subtitle="Dihitung dari data asli kol_directory">
        <p className="text-[12.5px] leading-[1.65]" style={{ color: T.t2 }}>
          @{creator.username} berada di peringkat <b>#{rank.followersRank.toLocaleString('id-ID')}</b> dari{' '}
          {rank.rosterTotal.toLocaleString('id-ID')} creator berdasarkan followers
          {rank.categoryName && rank.categoryFollowersRank !== null && (
            <> — dan <b>#{rank.categoryFollowersRank}</b> di kategori {rank.categoryName}{' '}
            ({rank.categoryTotal.toLocaleString('id-ID')} creator)</>
          )}.
        </p>
      </VizCard>
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
