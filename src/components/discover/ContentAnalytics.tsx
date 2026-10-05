'use client'

/**
 * Content Analytics — the latest 10 posts, analysed.
 *
 * Reach, engagement, views, comments, format and paid-vs-organic are measured
 * from the posts themselves. Sentiment and topics are *derived from the caption
 * text*, not from comment data: autometric stores no comment bodies for these
 * accounts, so a per-comment sentiment model would be fabrication. What is
 * provided instead is a lexicon pass over the caption plus the post's own
 * engagement shape, badged Estimated, with the limitation stated on screen.
 *
 * Hashtags are extracted from the real caption text, so those are live.
 */

import { useMemo, useState } from 'react'
import { Card, CardHead } from '@/components/dashboard/ui'
import { BarChart, Donut, HBars } from '@/components/dashboard/charts'
import { EmptyState, PJ, fmtDate, fmtNum } from './ui'
import { ConfidenceBadge } from './credibility'
import { PostAnalyticsPanel, usePostAnalytics } from './PostAnalyticsPanel'
import type { AccountDetailPayload, AccountPost } from '@/lib/discover/account'

const PALETTE = ['#285D6E', '#4E96AC', '#e0a458', '#5fa783', '#8b7fc7', '#d97a7a', '#7DB4C6']
const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']
const BUCKETS = ['00-04', '04-08', '08-12', '12-16', '16-20', '20-24']

/* ── caption-derived signals ─────────────────────────────────────────────── */

const POSITIVE = ['seru', 'segar', 'suka', 'favorit', 'terbaik', 'mantap', 'keren', 'senang',
  'spesial', 'nikmat', 'enak', 'happy', 'best', 'love', 'fresh', 'good', 'great']
const NEGATIVE = ['kurang', 'susah', 'masalah', 'gagal', 'kecewa', 'buruk', 'sulit', 'bad', 'sorry']

export type Sentiment = 'positive' | 'neutral' | 'negative'

/**
 * Lexicon sentiment over the caption. Deliberately simple and transparent —
 * a bag-of-words hit count — because an opaque score here would invite more
 * trust than the input deserves.
 */
export function sentimentOf(caption: string): { label: Sentiment; score: number } {
  const text = caption.toLowerCase()
  const pos = POSITIVE.filter(w => text.includes(w)).length
  const neg = NEGATIVE.filter(w => text.includes(w)).length
  const score = pos - neg
  return { label: score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral', score }
}

/** Hashtags straight out of the caption — real text, so this is measured. */
export const hashtagsOf = (caption: string): string[] =>
  (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).map(h => h.toLowerCase())

const STOP = new Set(['yang', 'dan', 'untuk', 'dengan', 'dari', 'ini', 'itu', 'kamu', 'kita',
  'ada', 'jadi', 'lebih', 'the', 'and', 'for', 'with', 'you', 'your'])

/** Crude topic extraction: most frequent non-trivial words across the captions. */
export function topicsOf(posts: AccountPost[], limit = 8): { word: string; count: number }[] {
  const freq = new Map<string, number>()
  for (const p of posts) {
    const words = (p.caption.toLowerCase().match(/[\p{L}]{4,}/gu) ?? [])
    for (const w of words) {
      if (STOP.has(w)) continue
      freq.set(w, (freq.get(w) ?? 0) + 1)
    }
  }
  return [...freq.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

const SENTIMENT_STYLE: Record<Sentiment, { label: string; bg: string; fg: string }> = {
  positive: { label: 'Positif', bg: '#eaf5ef', fg: '#3d8a5f' },
  neutral: { label: 'Netral', bg: '#f3f4f6', fg: '#6b7280' },
  negative: { label: 'Negatif', bg: '#fcefec', fg: '#c2553f' },
}

export default function ContentAnalytics({
  orgId, data,
}: { orgId: string; data: AccountDetailPayload }) {
  const posts = data.latestPosts
  const [openPost, setOpenPost] = useState<string | null>(null)

  /**
   * The open row's full analytics, fetched on demand from the same endpoint the
   * Discover grid uses. The row used to restate what the table already showed
   * plus a caption-lexicon guess; this is the post's measured record — reach,
   * saves, follows, link clicks, and the real comment sentiment where the
   * warehouse has classified it.
   */
  const detail = usePostAnalytics(orgId, openPost)

  const analysis = useMemo(() => posts.map(p => ({
    post: p,
    sentiment: sentimentOf(p.caption),
    hashtags: hashtagsOf(p.caption),
  })), [posts])

  const topics = useMemo(() => topicsOf(posts), [posts])

  const hashtagFreq = useMemo(() => {
    const freq = new Map<string, number>()
    for (const a of analysis) for (const h of a.hashtags) freq.set(h, (freq.get(h) ?? 0) + 1)
    return [...freq.entries()].map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count).slice(0, 10)
  }, [analysis])

  const sentimentMix = useMemo(() => {
    const c: Record<Sentiment, number> = { positive: 0, neutral: 0, negative: 0 }
    analysis.forEach(a => { c[a.sentiment.label]++ })
    return c
  }, [analysis])

  const paid = posts.filter(p => p.sponsored)
  const organic = posts.filter(p => !p.sponsored)
  const avg = (arr: AccountPost[], f: (p: AccountPost) => number) =>
    arr.length ? arr.reduce((n, p) => n + f(p), 0) / arr.length : 0

  const best = [...posts].sort((a, b) => b.erPct - a.erPct)[0]

  if (posts.length === 0) {
    return <EmptyState icon="inbox" title="Belum ada post" body="Akun ini belum punya post yang tersinkron." />
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-4 gap-3">
        <Mini label="Post dianalisis" value={String(posts.length)} />
        <Mini label="Rata-rata views" value={fmtNum(avg(posts, p => p.views))} />
        <Mini label="Rata-rata comments" value={fmtNum(avg(posts, p => p.comments))} />
        <Mini label="Rata-rata ER" value={`${avg(posts, p => p.erPct).toFixed(2)}%`} />
      </div>

      {best && (
        <Card>
          <CardHead title="Post terbaik" sub="Engagement rate tertinggi dari 10 post terakhir" />
          <div className="px-4 pb-4">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-[20px] text-[#e0a458]">emoji_events</span>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-[#374151] leading-relaxed">{best.caption || '—'}</p>
                <div className="flex items-center gap-3 mt-1.5 text-[10.5px] text-[#9ca3af] flex-wrap">
                  <span>{best.format}</span>
                  <span>{best.postDate ? fmtDate(best.postDate) : '—'}</span>
                  <span>{fmtNum(best.views)} views</span>
                  <span>{fmtNum(best.likes)} likes</span>
                  <span>{fmtNum(best.comments)} comments</span>
                  <b className="text-[#285D6E]">{best.erPct.toFixed(2)}% ER</b>
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3.5">
        <Card>
          <CardHead title="Sentimen caption"
            sub="Analisis leksikon atas teks caption"
            action={<ConfidenceBadge confidence="estimated" basis="Dari kata kunci pada caption, bukan dari isi komentar — komentar belum tersedia" />} />
          <div className="px-4 pb-4">
            <Donut
              segments={(['positive', 'neutral', 'negative'] as Sentiment[]).map((k, i) => ({
                label: SENTIMENT_STYLE[k].label, value: sentimentMix[k],
                color: [PALETTE[3], PALETTE[6], '#d97a7a'][i],
              }))}
              centerLabel={String(posts.length)} centerSub="post"
            />
          </div>
        </Card>

        <Card>
          <CardHead title="Paid vs organic" sub="Performa konten berbayar dibanding organik" />
          <div className="px-4 pb-4">
            {paid.length === 0 ? (
              <EmptyState icon="sell" title="Tidak ada post berbayar"
                body="10 post terakhir semuanya organik." />
            ) : (
              <BarChart bars={[
                { label: `Paid (${paid.length})`, value: avg(paid, p => p.erPct), color: PALETTE[2], display: `${avg(paid, p => p.erPct).toFixed(2)}%` },
                { label: `Organic (${organic.length})`, value: avg(organic, p => p.erPct), color: PALETTE[0], display: `${avg(organic, p => p.erPct).toFixed(2)}%` },
              ]} height={180} />
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        <Card>
          <CardHead title="Topik dominan" sub="Kata paling sering muncul di caption" />
          <div className="px-4 pb-4">
            {topics.length === 0
              ? <EmptyState icon="topic" title="Caption terlalu pendek" />
              : <HBars items={topics.map((t, i) => ({
                  label: t.word, value: t.count, display: `${t.count}×`, color: PALETTE[i % PALETTE.length],
                }))} />}
          </div>
        </Card>

        <Card>
          <CardHead title="Hashtag" sub="Diambil langsung dari teks caption"
            action={<ConfidenceBadge confidence="live" basis="Diekstrak dari caption asli" />} />
          <div className="px-4 pb-4">
            {hashtagFreq.length === 0 ? (
              <EmptyState icon="tag" title="Tidak ada hashtag" body="10 post terakhir tidak memakai hashtag." />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {hashtagFreq.map(h => (
                  <span key={h.tag} style={PJ}
                    className="inline-flex items-center gap-1 rounded-full border border-[#e5e7eb] bg-[#f9fafb] px-2.5 h-7 text-[11px] font-bold text-[#374151]">
                    {h.tag}
                    <span className="text-[9.5px] text-[#9ca3af]">{h.count}×</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="Waktu posting" sub="Hari dan jam posting, diwarnai menurut jumlah post" />
        <div className="px-4 pb-4 overflow-x-auto">
          <PostingHeatmap times={data.postingTimes} />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHead title="10 post terakhir" sub="Klik satu baris untuk analisis per post" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="border-b border-[#e5e7eb]">
                {['Post', 'Format', 'Tanggal', 'Views', 'Likes', 'Comments', 'ER', 'Sentimen', ''].map((h, i) => (
                  <th key={h} style={PJ}
                    className={`text-[10px] font-bold uppercase tracking-wider text-[#9ca3af] px-3 py-2 ${i >= 3 && i <= 6 ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {analysis.map(({ post: p, sentiment }) => {
                const open = openPost === p.key
                const st = SENTIMENT_STYLE[sentiment.label]
                return (
                  <>
                    <tr key={p.key}
                      onClick={() => setOpenPost(open ? null : p.key)}
                      className={`border-b border-[#f3f4f6] cursor-pointer ${open ? 'bg-[#f0f7fa]' : 'hover:bg-[#f9fafb]'}`}>
                      <td className="px-3 py-2">
                        <div className="text-[11.5px] text-[#374151] truncate max-w-[260px]">{p.caption || '—'}</div>
                        {p.pillar && <div className="text-[10px] text-[#285D6E] font-semibold">{p.pillar}</div>}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-[#6b7280]">
                        {p.format}
                        {p.sponsored && <span className="ml-1 text-[8.5px] font-extrabold uppercase bg-[#fdf3e7] text-[#b5761f] rounded px-1 py-0.5">Ads</span>}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-[#9ca3af]">{p.postDate ? fmtDate(p.postDate) : '—'}</td>
                      <Num>{fmtNum(p.views)}</Num>
                      <Num>{fmtNum(p.likes)}</Num>
                      <Num>{fmtNum(p.comments)}</Num>
                      <Num>{p.erPct.toFixed(2)}%</Num>
                      <td className="px-3 py-2">
                        <span style={{ ...PJ, background: st.bg, color: st.fg }}
                          className="inline-flex rounded-md text-[9.5px] font-extrabold uppercase px-1.5 py-0.5">
                          {st.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="material-symbols-outlined text-[16px] text-[#9ca3af]">
                          {open ? 'expand_less' : 'expand_more'}
                        </span>
                      </td>
                    </tr>
                    {open && (
                      <tr key={`${p.key}-detail`} className="bg-[#f9fafb] border-b border-[#f3f4f6]">
                        <td colSpan={9} className="px-4 py-3">
                          <PostAnalyticsPanel
                            data={detail.data} loading={detail.loading} error={detail.error} />
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function PostingHeatmap({ times }: { times: AccountDetailPayload['postingTimes'] }) {
  const max = Math.max(1, ...times.map(t => t.posts))
  const at = (day: number, bucket: number) => times.find(t => t.day === day && t.bucket === bucket)
  return (
    <table className="border-separate" style={{ borderSpacing: 3 }}>
      <thead>
        <tr>
          <th />
          {BUCKETS.map(b => (
            <th key={b} style={PJ} className="text-[9.5px] font-bold text-[#9ca3af] px-1">{b}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {DAYS.map((d, di) => (
          <tr key={d}>
            <td style={PJ} className="text-[10px] font-bold text-[#9ca3af] pr-1 text-right">{d}</td>
            {BUCKETS.map((_, bi) => {
              const cell = at(di, bi)
              const n = cell?.posts ?? 0
              const alpha = n === 0 ? 0 : 0.15 + (n / max) * 0.85
              return (
                <td key={bi}
                  title={n ? `${n} post · ER ${cell!.avgEr.toFixed(2)}%` : 'tidak ada post'}
                  style={{ background: n ? `rgba(40,93,110,${alpha})` : '#f3f4f6' }}
                  className="w-11 h-7 rounded text-center align-middle">
                  <span style={PJ} className={`text-[10px] font-bold ${alpha > 0.55 ? 'text-white' : 'text-[#6b7280]'}`}>
                    {n || ''}
                  </span>
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Label({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div style={PJ} className={`text-[10px] font-bold uppercase tracking-widest text-[#9ca3af] mb-1 ${className}`}>
      {children}
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-[#e5e7eb] rounded-xl px-3 py-2.5">
      <div style={PJ} className="text-[16px] font-extrabold text-[#111827] tabular-nums">{value}</div>
      <div className="text-[10px] text-[#9ca3af] mt-0.5">{label}</div>
    </div>
  )
}

function Num({ children }: { children: React.ReactNode }) {
  return <td style={PJ} className="px-3 py-2 text-[11.5px] font-bold text-[#374151] text-right tabular-nums">{children}</td>
}
