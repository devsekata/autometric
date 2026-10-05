'use client'

/**
 * One post's analytics, rendered wherever a post is shown.
 *
 * Discover's grid and the account's Content Analytics tab used to answer
 * different questions about the same row: the grid said what was posted, the
 * analytics page said how the account performed. Neither said how *this* post
 * did. This panel is that answer, and both surfaces mount the same component so
 * a number cannot drift between them — it is fetched once, from one endpoint,
 * and rendered by one piece of code.
 *
 * Every figure is measured (see `@/lib/discover/postAnalytics`). A metric the
 * platform never reported prints as an em dash and is listed at the bottom as
 * not measured, rather than being shown as a zero.
 *
 * Each number sits next to the median of the same account's posts, because a
 * count on its own cannot be read: "412K views" says nothing until you know the
 * account usually gets 180K.
 */

import { useCallback, useEffect, useState } from 'react'
import { EmptyState, ErrorState, PJ, PLATFORM_ICON, FORMAT_ICON, Spinner, fmtDate, fmtNum, gradientFor } from './ui'
import type { PostAnalytics, PostMetric } from '@/lib/discover/postAnalytics'

/* ── fetching ─────────────────────────────────────────────────────────────── */

/**
 * Loads the analytics for `postKey` (`"brand:123"` — the same key the grid uses).
 * Null `postKey` clears the state, so the caller can drive this straight from
 * "which row is open" without an extra effect of its own.
 */
export function usePostAnalytics(orgId: string, postKey: string | null) {
  const [data, setData] = useState<PostAnalytics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!postKey) { setData(null); setError(null); setLoading(false); return }

    const [source, rowId] = postKey.split(':')
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)

    fetch(`/api/organizations/${orgId}/discover/content/post?source=${source}&rowId=${rowId}`)
      .then(async r => {
        if (r.ok) return r.json()
        const body = await r.json().catch(() => null)
        throw new Error(body?.detail || body?.error || `HTTP ${r.status}`)
      })
      .then((d: PostAnalytics) => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(String(e?.message ?? e)) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [orgId, postKey])

  return { data, error, loading }
}

/* ── formatting ───────────────────────────────────────────────────────────── */

function fmtMetric(value: number | null, kind: PostMetric['kind']): string {
  if (value === null) return '—'
  if (kind === 'percent') return `${value.toFixed(2)}%`
  if (kind === 'seconds') return value >= 60
    ? `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`
    : `${value.toFixed(1)}s`
  return fmtNum(value)
}

const VERDICT: Record<PostAnalytics['performance']['verdict'], { label: string; bg: string; fg: string; icon: string }> = {
  outstanding: { label: 'Jauh di atas rata-rata', bg: '#eaf5ef', fg: '#2f7150', icon: 'trending_up' },
  above: { label: 'Di atas rata-rata', bg: '#eaf5ef', fg: '#3d8a5f', icon: 'trending_up' },
  typical: { label: 'Setara rata-rata', bg: '#f3f4f6', fg: '#6b7280', icon: 'trending_flat' },
  below: { label: 'Di bawah rata-rata', bg: '#fdf3e7', fg: '#b5761f', icon: 'trending_down' },
  unknown: { label: 'Belum bisa dibandingkan', bg: '#f3f4f6', fg: '#9ca3af', icon: 'help' },
}

const SENTIMENT_FG: Record<string, string> = {
  positive: '#3d8a5f', neutral: '#9ca3af', negative: '#c2553f',
}

/* ── the panel ────────────────────────────────────────────────────────────── */

export function PostAnalyticsPanel({
  data, loading, error, onRetry,
}: {
  data: PostAnalytics | null
  loading: boolean
  error: string | null
  onRetry?: () => void
}) {
  if (loading) return <Spinner label="Memuat analytics post…" />
  if (error) return <ErrorState message={error} />
  if (!data) return <EmptyState icon="inbox" title="Post tidak ditemukan" />

  const headline = data.metrics.filter(m => m.headline)
  const detail = data.metrics.filter(m => !m.headline && m.value !== null)
  const unmeasured = data.metrics.filter(m => m.value === null)
  const verdict = VERDICT[data.performance.verdict]

  return (
    <div className="flex flex-col gap-3.5">
      {/* ── preview + identity ── */}
      <div className="flex gap-3.5 flex-wrap">
        <Preview post={data} />

        <div className="flex-1 min-w-[240px]">
          {data.title && (
            <div style={PJ} className="text-[13px] font-extrabold text-[#111827] mb-1">{data.title}</div>
          )}
          <p className="text-[11.5px] text-[#374151] leading-relaxed whitespace-pre-line line-clamp-5">
            {data.caption || '—'}
          </p>

          <div className="flex items-center gap-1.5 mt-2 flex-wrap text-[10.5px] text-[#9ca3af]">
            <span className="material-symbols-outlined text-[14px] text-[#285D6E]">
              {PLATFORM_ICON[data.platform] ?? 'public'}
            </span>
            <span className="font-semibold text-[#6b7280]">@{data.author}</span>
            <span className="text-[#d1d5db]">·</span>
            <span>{data.format}</span>
            <span className="text-[#d1d5db]">·</span>
            <span>{data.postDate ? fmtDate(data.postDate) : 'tanggal tidak tercatat'}</span>
            {data.pillar && (
              <>
                <span className="text-[#d1d5db]">·</span>
                <span className="text-[#285D6E] font-semibold">{data.pillar}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {data.isCampaign && <Tag tone="teal">Campaign</Tag>}
            {data.isBoosted && <Tag tone="amber">Boosted</Tag>}
            {data.source === 'competitor' && <Tag tone="grey">Kompetitor</Tag>}
          </div>

          {data.link && (
            <a href={data.link} target="_blank" rel="noopener noreferrer"
              style={PJ}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-[#327488] hover:underline mt-2.5">
              Buka post asli
              <span className="material-symbols-outlined text-[14px]">open_in_new</span>
            </a>
          )}
        </div>
      </div>

      {/* ── the verdict, stated before the numbers that produce it ── */}
      <div style={{ background: verdict.bg }} className="flex items-center gap-2 rounded-xl px-3 py-2.5">
        <span className="material-symbols-outlined text-[18px]" style={{ color: verdict.fg }}>{verdict.icon}</span>
        <div className="min-w-0">
          <div style={{ ...PJ, color: verdict.fg }} className="text-[12px] font-extrabold">
            {verdict.label}
            {data.performance.ratio !== null && ` · ${data.performance.ratio.toFixed(1)}× median akun`}
          </div>
          <div className="text-[10.5px] text-[#6b7280]">
            {data.performance.erPct !== null && data.performance.medianErPct !== null
              ? `ER ${data.performance.erPct.toFixed(2)}% dibanding median ${data.performance.medianErPct.toFixed(2)}% dari ${data.benchmarkPosts} post akun ini`
              : 'Engagement rate post ini atau median akunnya belum terukur, jadi belum ada pembanding.'}
          </div>
        </div>
      </div>

      {/* ── headline metrics ── */}
      <div className="grid grid-cols-4 gap-2.5">
        {headline.map(m => <MetricTile key={m.key} metric={m} />)}
      </div>

      {data.achievement && <Achievement achievement={data.achievement} />}

      {/* ── the rest of what the platform reported ── */}
      {detail.length > 0 && (
        <Section title="Metrik lain" sub="Semua diukur dari laporan platform, bukan estimasi">
          <div className="grid grid-cols-3 gap-x-4 gap-y-1.5">
            {detail.map(m => (
              <div key={m.key} className="flex items-baseline justify-between gap-2 border-b border-[#f3f4f6] py-1">
                <span className="text-[11px] text-[#6b7280]">{m.label}</span>
                <span style={PJ} className="text-[11.5px] font-bold text-[#374151] tabular-nums">
                  {fmtMetric(m.value, m.kind)}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Sentiment data={data} />

      {data.hashtags.length > 0 && (
        <Section title="Hashtag" sub="Diambil dari caption post ini">
          <div className="flex flex-wrap gap-1.5">
            {data.hashtags.map(h => (
              <span key={h} style={PJ}
                className="inline-flex items-center rounded-full border border-[#e5e7eb] bg-[#f9fafb] px-2.5 h-6 text-[10.5px] font-bold text-[#374151]">
                {h}
              </span>
            ))}
          </div>
        </Section>
      )}

      {unmeasured.length > 0 && (
        <p className="text-[10px] text-[#9ca3af] leading-relaxed">
          Tidak diukur untuk post ini: {unmeasured.map(m => m.label).join(', ')}.{' '}
          {data.source === 'competitor'
            ? 'Post kompetitor diambil dari luar, jadi hanya angka publik yang tersedia.'
            : 'Platform tidak melaporkan angka ini untuk format atau tipe akun tersebut.'}
        </p>
      )}

      {onRetry && (
        <button type="button" onClick={onRetry}
          className="self-start text-[10.5px] font-bold text-[#327488] hover:underline">
          Muat ulang
        </button>
      )}
    </div>
  )
}

/* ── pieces ───────────────────────────────────────────────────────────────── */

function Preview({ post }: { post: PostAnalytics }) {
  const [imgOk, setImgOk] = useState(true)
  const showImg = !!post.coverImage && imgOk

  return (
    <div className="w-[168px] h-[168px] rounded-xl overflow-hidden relative flex-shrink-0"
      style={{ background: gradientFor(post.key) }}>
      {showImg && (
        // eslint-disable-next-line @next/next/no-img-element -- external CDN host is not in next.config remotePatterns
        <img src={post.coverImage!} alt="" referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover"
          onError={() => setImgOk(false)} />
      )}
      {!showImg && (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1">
          <span className="material-symbols-outlined text-[30px] text-white/80">
            {FORMAT_ICON[post.format] ?? 'article'}
          </span>
          <span style={PJ} className="text-[9px] font-extrabold uppercase tracking-widest text-white/75">
            {post.format}
          </span>
        </span>
      )}
    </div>
  )
}

/**
 * A headline number with the account's median under it.
 *
 * The median is the whole point of the tile: without it the reader has a figure
 * and no way to judge it, which is the gap this panel exists to close.
 */
function MetricTile({ metric }: { metric: PostMetric }) {
  const ratio = metric.value !== null && metric.median !== null && metric.median > 0
    ? metric.value / metric.median
    : null

  return (
    <div className="bg-white border border-[#e5e7eb] rounded-xl px-3 py-2.5">
      <div style={PJ} className="text-[16px] font-extrabold text-[#111827] tabular-nums">
        {fmtMetric(metric.value, metric.kind)}
      </div>
      <div className="text-[10px] text-[#9ca3af] mt-0.5">{metric.label}</div>
      {metric.median !== null && (
        <div className="flex items-center gap-1 mt-1">
          {ratio !== null && (
            <span className="material-symbols-outlined text-[12px]"
              style={{ color: ratio >= 1 ? '#3d8a5f' : '#b5761f' }}>
              {ratio >= 1 ? 'arrow_upward' : 'arrow_downward'}
            </span>
          )}
          <span className="text-[9.5px] text-[#9ca3af]">
            median {fmtMetric(metric.median, metric.kind)}
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * Achievement against the deliverable's target.
 *
 * Only rendered for a post that fulfils an order item — the link is the item's
 * `published_url`, so this is a booking that was actually delivered, not a guess
 * from the post's campaign flag.
 */
function Achievement({ achievement: a }: { achievement: NonNullable<PostAnalytics['achievement']> }) {
  return (
    <Section title="Pencapaian target campaign"
      sub={`${a.orderName}${a.deliverable ? ` · ${a.deliverable}` : ''}`}>
      <div className="flex items-center gap-1.5 flex-wrap mb-2.5">
        {a.status && <Tag tone="teal">{a.status}</Tag>}
        {a.campaignStatus && <Tag tone="grey">{a.campaignStatus}</Tag>}
        {a.objective && <span className="text-[10.5px] text-[#6b7280]">Objektif: {a.objective}</span>}
      </div>

      {a.lines.length === 0 ? (
        <p className="text-[11px] text-[#9ca3af]">
          Deliverable ini tidak menetapkan angka target, jadi tidak ada yang bisa diukur.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {a.lines.map(line => {
            const hit = line.pct >= 100
            return (
              <div key={line.label}>
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="text-[11px] text-[#6b7280]">{line.label}</span>
                  <span style={{ ...PJ, color: hit ? '#3d8a5f' : '#b5761f' }}
                    className="text-[11px] font-bold tabular-nums">
                    {fmtNum(line.actual)} / {fmtNum(line.target)} · {Math.round(line.pct)}%
                  </span>
                </div>
                <div className="h-2 rounded bg-[#f3f4f6] overflow-hidden">
                  <div className="h-full rounded"
                    style={{
                      width: `${Math.min(100, Math.max(2, line.pct))}%`,
                      background: hit ? '#3d8a5f' : '#e0a458',
                    }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}

/**
 * Comment sentiment, which is real here and only here.
 *
 * `l2_gold.comment_sentiment_post` classifies the actual comment bodies, so this
 * panel prints counts rather than the caption-lexicon guess the account-level tab
 * has to fall back on. Posts whose comments were never ingested say so.
 */
function Sentiment({ data }: { data: PostAnalytics }) {
  if (!data.sentiment) {
    return (
      <Section title="Sentimen komentar" sub="Dari isi komentar, bukan dari caption">
        <p className="text-[11px] text-[#9ca3af] leading-relaxed">
          Komentar post ini belum dianalisis, jadi belum ada sebaran sentimennya.
          {data.source === 'competitor' && ' Komentar akun kompetitor memang tidak diambil.'}
        </p>
      </Section>
    )
  }

  const s = data.sentiment
  const total = Math.max(1, s.total)
  const parts = [
    { label: 'Positif', n: s.positive, color: '#5fa783' },
    { label: 'Netral', n: s.neutral, color: '#cbd5e1' },
    { label: 'Negatif', n: s.negative, color: '#d97a7a' },
  ]

  return (
    <Section title="Sentimen komentar"
      sub={`${fmtNum(s.total)} komentar dianalisis · dominan ${s.dominant}`}>
      <div className="flex h-2.5 rounded overflow-hidden mb-2">
        {parts.map(p => (
          <div key={p.label} style={{ width: `${(p.n / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {parts.map(p => (
          <span key={p.label} className="inline-flex items-center gap-1 text-[10.5px] text-[#6b7280]">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            {p.label} <b style={{ color: SENTIMENT_FG[p.label.toLowerCase()] ?? '#374151' }}>{fmtNum(p.n)}</b>
          </span>
        ))}
      </div>
    </Section>
  )
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#e5e7eb] rounded-xl p-3">
      <div style={PJ} className="text-[11.5px] font-extrabold text-[#111827]">{title}</div>
      {sub && <div className="text-[10px] text-[#9ca3af] mb-2 mt-0.5">{sub}</div>}
      <div className={sub ? '' : 'mt-2'}>{children}</div>
    </div>
  )
}

const TAG_TONE: Record<string, { bg: string; fg: string }> = {
  teal: { bg: '#e8f1f4', fg: '#285D6E' },
  amber: { bg: '#fdf3e7', fg: '#b5761f' },
  grey: { bg: '#f3f4f6', fg: '#6b7280' },
}

function Tag({ tone, children }: { tone: keyof typeof TAG_TONE; children: React.ReactNode }) {
  const t = TAG_TONE[tone]
  return (
    <span style={{ ...PJ, background: t.bg, color: t.fg }}
      className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide">
      {children}
    </span>
  )
}

/* ── modal wrapper ────────────────────────────────────────────────────────── */

/** The grid opens the panel in a dialog; the analytics table renders it inline. */
export function PostAnalyticsModal({
  orgId, postKey, onClose,
}: { orgId: string; postKey: string | null; onClose: () => void }) {
  const { data, error, loading } = usePostAnalytics(orgId, postKey)

  const onKey = useCallback((e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }, [onClose])
  useEffect(() => {
    if (!postKey) return
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [postKey, onKey])

  if (!postKey) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Analytics post"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto bg-[rgba(17,24,39,.45)]"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-[760px] my-6 rounded-2xl bg-[#f9fafb] border border-[#e5e7eb] shadow-[0_26px_56px_rgba(30,74,88,.18)]"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#e5e7eb] bg-white rounded-t-2xl sticky top-0 z-10">
          <span style={PJ} className="text-[13px] font-extrabold text-[#111827]">Analytics post</span>
          <button type="button" onClick={onClose} aria-label="Tutup"
            className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-[#9ca3af] hover:bg-[#f3f4f6]">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="p-4">
          <PostAnalyticsPanel data={data} loading={loading} error={error} />
        </div>
      </div>
    </div>
  )
}
