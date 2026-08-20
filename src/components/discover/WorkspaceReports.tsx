'use client'

/**
 * Workspace › Reports — port of the source platform's `pages/reports.js`.
 *
 * Same three tabs, same order, same job:
 *   1  Creator Profile Report   pick a creator, pick sections, pick a format,
 *                               watch the preview update, export
 *   2  Campaign Report          best and worst performing content for one
 *                               campaign's creators, with an automatic read
 *   3  Workspace Report         portfolio KPIs, campaigns by status, and
 *                               purchase history grouped by month
 * plus the Report History table the source kept at the bottom.
 *
 * Two honest departures from the source, both forced by what autometric
 * actually knows:
 *
 * - The source's Campaign Report ranked "the campaign's posts". Nothing reports
 *   per-order delivery back to autometric, so there is no such set. This ranks
 *   the *recent content of the creators on that campaign* and says so on screen.
 *   Ranking arbitrary posts and calling them campaign results would be the kind
 *   of invented number the rest of this module refuses to print.
 *
 * - The source labelled its rule-based summary "AI Analysis" — it was three
 *   template strings filled from counts. The same three readings are computed
 *   here from real numbers and labelled as automatic analysis, not AI. The AI
 *   Assistant page is where a model is actually called.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardHead } from '@/components/dashboard/ui'
import {
  Btn, Chip, DiscoverHeader, EmptyState, ErrorState, PJ, Spinner, TabStrip,
  fmtDate, fmtNum, gradientFor,
} from './ui'
import { exportCsv, exportExcel, exportPrintable, type ExportColumn } from './exportData'
import type { KolProfile } from '@/lib/discover/profile'
import type { OrderSummary } from '@/lib/discover/orders'
import type { DiscoverContentPayload, DiscoverPost } from '@/lib/discover/types'

const idr = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID')
const initials = (s: string) => s.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '??'

type TabId = 'creator' | 'campaign' | 'workspace'
type Format = 'PDF' | 'Excel' | 'CSV'

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'creator', label: 'Creator Profile Report', icon: 'person' },
  { id: 'campaign', label: 'Campaign Report', icon: 'campaign' },
  { id: 'workspace', label: 'Workspace Report', icon: 'timeline' },
]

/** The source's seven creator report sections, unchanged. */
const CREATOR_SECTIONS = [
  'Profile & Metrics', 'Performance', 'Audience Insights', 'Content Analytics',
  'Campaign History', 'Brand Fit', 'AI Insights',
] as const

const FORMATS: Format[] = ['PDF', 'Excel', 'CSV']

/* ── report history ───────────────────────────────────────────────────────── */

interface HistoryEntry {
  id: string
  name: string
  createdAt: string
  range: string
  format: Format
}

/**
 * A log of what this browser generated.
 *
 * Deliberately local, and labelled as such on screen. Exports here are produced
 * client-side — a CSV blob or a print dialog — so nothing reaches the server to
 * record. Writing these rows to a server table would imply a stored artifact
 * that can be re-downloaded, and there is none.
 */
function useReportHistory(orgId: string) {
  const key = `autometric:discover:reporthistory:${orgId}`
  const [items, setItems] = useState<HistoryEntry[]>([])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key)
      const parsed = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed)) setItems(parsed.filter(x => x?.id && x?.name))
    } catch { /* ignore */ }
  }, [key])

  const add = useCallback((name: string, format: Format, range: string) => {
    setItems(prev => {
      const entry: HistoryEntry = {
        // Date.now() is fine here: this runs on a click, never during render.
        id: `${Date.now()}`, name, format, range,
        createdAt: new Date().toISOString(),
      }
      const next = [entry, ...prev].slice(0, 25)
      try { window.localStorage.setItem(key, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [key])

  const clear = useCallback(() => {
    setItems([])
    try { window.localStorage.removeItem(key) } catch { /* ignore */ }
  }, [key])

  return { items, add, clear }
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function WorkspaceReports({
  orgId, orgSlug, embedded = false,
}: { orgId: string; orgSlug: string; embedded?: boolean }) {
  const [tab, setTab] = useState<TabId>('creator')
  const [profiles, setProfiles] = useState<KolProfile[] | null>(null)
  const [orders, setOrders] = useState<OrderSummary[] | null>(null)
  const [posts, setPosts] = useState<DiscoverPost[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const history = useReportHistory(orgId)

  useEffect(() => {
    let cancelled = false
    const get = (url: string) =>
      fetch(url).then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))

    Promise.all([
      get(`/api/organizations/${orgId}/discover/profiles`),
      get(`/api/organizations/${orgId}/discover/orders`),
      // One wide page of content, ranked by ER, is enough to pick a top and
      // bottom ten out of — and it is one request instead of one per creator.
      get(`/api/organizations/${orgId}/discover/content?pageSize=96&sort=er`),
    ])
      .then(([p, o, c]: [{ profiles: KolProfile[] }, { orders: OrderSummary[] }, DiscoverContentPayload]) => {
        if (cancelled) return
        setProfiles(p.profiles); setOrders(o.orders); setPosts(c.posts ?? [])
      })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })
    return () => { cancelled = true }
  }, [orgId])

  if (error) return <Shell embedded={embedded}><ErrorState message={error} /></Shell>
  if (!profiles || !orders || !posts) return <Shell embedded={embedded}><Spinner /></Shell>

  return (
    <Shell embedded={embedded}>
      <TabStrip tabs={TABS} value={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === 'creator' && (
          <CreatorReportTab profiles={profiles} onGenerated={history.add} />
        )}
        {tab === 'campaign' && (
          <CampaignReportTab orders={orders} posts={posts} onGenerated={history.add} />
        )}
        {tab === 'workspace' && (
          <WorkspaceReportTab orders={orders} orgSlug={orgSlug} onGenerated={history.add} />
        )}
      </div>

      <ReportHistory history={history} />
    </Shell>
  )
}

function Shell({
  children, embedded,
}: { children: React.ReactNode; embedded?: boolean }) {
  return (
    <div className={embedded ? '' : 'p-5 max-w-[1500px] mx-auto'}>
      <DiscoverHeader
        title="Reports"
        subtitle="Laporan tingkat creator, campaign dan workspace — lengkap dengan preview dan ekspor."
      />
      {children}
    </div>
  )
}

/* ── tab 1: Creator Profile Report ────────────────────────────────────────── */

function CreatorReportTab({
  profiles, onGenerated,
}: { profiles: KolProfile[]; onGenerated: (n: string, f: Format, r: string) => void }) {
  const [kolId, setKolId] = useState<string | null>(profiles[0]?.account.id ?? null)
  const [sections, setSections] = useState<Set<string>>(
    new Set(['Profile & Metrics', 'Performance', 'Audience Insights']))
  const [format, setFormat] = useState<Format>('PDF')

  const kol = profiles.find(p => p.account.id === kolId) ?? profiles[0]

  if (!kol) {
    return <EmptyState icon="person_off" title="Belum ada creator"
      body="Hubungkan akun brand atau kompetitor dulu supaya ada yang bisa dilaporkan." />
  }

  const toggle = (s: string) => setSections(prev => {
    const next = new Set(prev)
    if (next.has(s)) next.delete(s); else next.add(s)
    return next
  })

  const rows = [
    { metric: 'Followers', value: fmtNum(kol.followers.value) },
    { metric: 'Engagement rate', value: `${kol.erPct.value.toFixed(2)}%` },
    { metric: 'Estimated reach', value: fmtNum(kol.estimatedReach.value) },
    { metric: 'Authenticity', value: String(kol.authenticity.value) },
    { metric: 'Audience quality', value: String(kol.audienceQuality.value) },
    { metric: 'Brand fit', value: String(kol.brandFit.value) },
    { metric: 'EMV', value: idr(kol.emv.value) },
    { metric: 'Posts', value: fmtNum(kol.posts.value) },
  ]
  const cols: ExportColumn<{ metric: string; value: string }>[] = [
    { key: 'metric', header: 'Metric', value: r => r.metric },
    { key: 'value', header: 'Value', value: r => r.value },
  ]

  const name = `${kol.account.username} — Creator Profile Report`

  const generate = () => {
    if (format === 'CSV') exportCsv(rows, cols, name)
    else if (format === 'Excel') exportExcel(rows, cols, name)
    else {
      exportPrintable(name, `
        <h1>${name}</h1>
        <div class="sub">${kol.category.value} · ${kol.tier.value} · ${kol.location.value}</div>
        <table><thead><tr><th>Metric</th><th class="num">Value</th></tr></thead><tbody>
          ${rows.map(r => `<tr><td>${r.metric}</td><td class="num">${r.value}</td></tr>`).join('')}
        </tbody></table>
        <p class="sub" style="margin-top:18px">Sections: ${[...sections].join(', ') || '—'}</p>`)
    }
    onGenerated(name, format, 'Semua data')
  }

  return (
    <div className="grid gap-3.5 items-start" style={{ gridTemplateColumns: 'minmax(0,1.05fr) minmax(0,1fr)' }}>
      <Card>
        <CardHead title="Creator Profile Report" sub="Laporan mendalam untuk satu creator" />
        <div className="px-4 pb-4">
          <Label>Creator</Label>
          <div className="flex flex-wrap gap-1.5 mt-2 mb-3.5">
            {profiles.slice(0, 10).map(p => (
              <Chip key={p.account.id} label={p.account.username}
                on={p.account.id === kol.account.id} onClick={() => setKolId(p.account.id)} />
            ))}
          </div>

          <Label>Sections</Label>
          <div className="flex flex-col gap-1 mt-2 mb-3.5">
            {CREATOR_SECTIONS.map(s => {
              const on = sections.has(s)
              return (
                <button key={s} type="button" onClick={() => toggle(s)}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    on ? 'border-[#327488] bg-[#f0f7fa]' : 'border-[#e5e7eb] hover:border-[#A7C8D4]'
                  }`}>
                  <span className={`material-symbols-outlined text-[15px] ${on ? 'text-[#285D6E]' : 'text-[#d1d5db]'}`}>
                    {on ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                  <span style={PJ} className="text-[12px] font-bold text-[#111827]">{s}</span>
                </button>
              )
            })}
          </div>

          <Label>Format</Label>
          <div className="flex rounded-lg border border-[#e5e7eb] overflow-hidden mt-2 w-fit">
            {FORMATS.map(f => (
              <button key={f} type="button" onClick={() => setFormat(f)} style={PJ}
                className={`text-[11.5px] font-bold px-3 h-8 ${
                  format === f ? 'bg-[#f0f7fa] text-[#285D6E]' : 'bg-white text-[#9ca3af] hover:text-[#374151]'
                }`}>
                {f}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card className="bg-[#f9fbfc]">
        <CardHead title="Preview" sub="Ikut berubah saat pilihan diubah"
          action={<span style={PJ}
            className="text-[10px] font-extrabold uppercase tracking-wide rounded px-1.5 py-0.5 bg-[#eaf4f9] text-[#285D6E]">
            {format}
          </span>} />
        <div className="px-4 pb-4">
          <div className="rounded-xl bg-white border border-[#e5e7eb] p-4">
            <div className="flex items-center gap-2.5">
              <div style={{ ...PJ, background: gradientFor(kol.account.username) }}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-[11px] font-extrabold">
                {initials(kol.account.username)}
              </div>
              <div className="min-w-0">
                <div style={PJ} className="text-[14px] font-extrabold text-[#111827] truncate">{name}</div>
                <div className="text-[10.5px] text-[#9ca3af]">
                  {kol.category.value} · {kol.tier.value} · {kol.location.value}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-3.5">
              {[
                ['Followers', fmtNum(kol.followers.value)],
                ['Eng. rate', `${kol.erPct.value.toFixed(2)}%`],
                ['EMV', idr(kol.emv.value)],
              ].map(([l, v]) => (
                <div key={l} className="text-center rounded-lg bg-[#f9fafb] border border-[#e5e7eb] py-2.5">
                  <div style={PJ} className="text-[13px] font-extrabold text-[#111827] tabular-nums truncate px-1">{v}</div>
                  <div className="text-[9.5px] text-[#9ca3af]">{l}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-1 mt-3">
              {sections.size === 0
                ? <span className="text-[11.5px] text-[#9ca3af]">Belum ada section dipilih.</span>
                : [...sections].map(s => (
                    <div key={s} className="flex items-center gap-2 text-[11.5px] text-[#374151]">
                      <span className="material-symbols-outlined text-[14px] text-[#3d8a5f]">check_circle</span>{s}
                    </div>
                  ))}
            </div>
          </div>

          <Btn variant="primary" onClick={generate}>
            <span className="material-symbols-outlined text-[15px]">summarize</span>
            Generate Creator Report
          </Btn>
          {format === 'PDF' && (
            <p className="text-[10px] text-[#9ca3af] mt-1.5">
              PDF dibuat lewat dialog print browser — pilih “Save as PDF”.
            </p>
          )}
        </div>
      </Card>
    </div>
  )
}

/* ── tab 2: Campaign Report ───────────────────────────────────────────────── */

function CampaignReportTab({
  orders, posts, onGenerated,
}: {
  orders: OrderSummary[]
  posts: DiscoverPost[]
  onGenerated: (n: string, f: Format, r: string) => void
}) {
  const [orderId, setOrderId] = useState<number | null>(orders[0]?.id ?? null)
  const order = orders.find(o => o.id === orderId) ?? orders[0]

  const ranked = useMemo(() => {
    if (!order) return { best: [], low: [] }
    // Handles are stored with and without the leading @ across sources.
    const handles = new Set(order.kols.map(k => k.replace(/^@/, '').toLowerCase()))
    const mine = posts.filter(p => handles.has((p.author ?? '').replace(/^@/, '').toLowerCase()))
    const byEr = [...mine].sort((a, b) => b.erPct - a.erPct || b.views - a.views)
    return { best: byEr.slice(0, 10), low: [...byEr].reverse().slice(0, 10) }
  }, [order, posts])

  if (!order) {
    return <EmptyState icon="campaign" title="Belum ada campaign"
      body="Buat order lewat KOL Intelligence → Ordering Flow, lalu campaign-nya muncul di sini." />
  }

  const name = `${order.name} — Campaign Report`
  const cols: ExportColumn<DiscoverPost>[] = [
    { key: 'author', header: 'Akun', value: p => p.author },
    { key: 'platform', header: 'Platform', value: p => p.platform },
    { key: 'format', header: 'Format', value: p => p.format },
    { key: 'caption', header: 'Caption', value: p => p.caption },
    { key: 'views', header: 'Views', value: p => p.views },
    { key: 'likes', header: 'Likes', value: p => p.likes },
    { key: 'er', header: 'ER %', value: p => p.erPct.toFixed(2) },
    { key: 'date', header: 'Tanggal', value: p => p.postDate.slice(0, 10) },
  ]

  const download = (f: Format) => {
    const rows = [...ranked.best, ...ranked.low]
    if (f === 'CSV') exportCsv(rows, cols, name)
    else if (f === 'Excel') exportExcel(rows, cols, name)
    else exportPrintable(name, `
      <h1>${name}</h1>
      <div class="sub">${order.accountCount} creator · ${order.itemCount} deliverable · ${idr(order.total)}</div>
      <table><thead><tr><th>Akun</th><th>Format</th><th class="num">Views</th><th class="num">ER</th></tr></thead><tbody>
        ${rows.map(p => `<tr><td>${p.author}</td><td>${p.format}</td><td class="num">${p.views}</td><td class="num">${p.erPct.toFixed(2)}%</td></tr>`).join('')}
      </tbody></table>`)
    onGenerated(name, f, 'Konten terbaru creator')
  }

  return (
    <>
      <div className="flex items-center gap-2.5 flex-wrap mb-3.5">
        <select value={order.id} onChange={e => setOrderId(Number(e.target.value))} style={PJ}
          className="h-8 px-2.5 rounded-lg border border-[#e5e7eb] text-[12px] font-semibold text-[#374151] focus:outline-none focus:border-[#327488]">
          {orders.map(o => <option key={o.id} value={o.id}>#{o.id} · {o.name}</option>)}
        </select>
        <span className="text-[11px] text-[#9ca3af]">
          {order.accountCount} creator · {order.itemCount} deliverable
          {order.campaign.startDate && order.campaign.endDate
            && ` · ${fmtDate(order.campaign.startDate)} – ${fmtDate(order.campaign.endDate)}`}
        </span>
        <div className="flex-1" />
        {FORMATS.map(f => (
          <Btn key={f} size="sm" variant="secondary" onClick={() => download(f)}>
            <span className="material-symbols-outlined text-[14px]">download</span>{f}
          </Btn>
        ))}
      </div>

      {/* The honesty note the source did not need, because its posts were fake. */}
      <div className="flex items-start gap-2 bg-[#fdf3e7] border border-[#eed9bb] rounded-xl px-3.5 py-2.5 mb-3.5">
        <span className="material-symbols-outlined text-[16px] text-[#b5761f] mt-0.5">info</span>
        <p className="text-[11.5px] text-[#b5761f]">
          Ini konten terbaru dari creator di campaign ini, bukan hasil delivery campaign-nya.
          Autometric tidak menerima laporan konten per order, jadi tidak ada cara memastikan sebuah
          post dibuat untuk campaign ini.
        </p>
      </div>

      {ranked.best.length === 0 ? (
        <EmptyState icon="search_off" title="Belum ada konten dari creator ini"
          body="Konten creator di campaign ini belum tersinkron ke warehouse." />
      ) : (
        <>
          <SectionHead icon="trending_up" tone="#3d8a5f" label="10 Konten Terbaik" />
          <PostGrid posts={ranked.best} />
          <AutoAnalysis posts={ranked.best} best />

          <div className="mt-5" />
          <SectionHead icon="trending_down" tone="#c2553f" label="10 Konten Terlemah" />
          <PostGrid posts={ranked.low} />
          <AutoAnalysis posts={ranked.low} best={false} />
        </>
      )}
    </>
  )
}

function SectionHead({ icon, tone, label }: { icon: string; tone: string; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <span className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: `${tone}1a` }}>
        <span className="material-symbols-outlined text-[14px]" style={{ color: tone }}>{icon}</span>
      </span>
      <span style={PJ} className="text-[12.5px] font-extrabold text-[#111827]">{label}</span>
      <span className="flex-1 h-px bg-[#e5e7eb]" />
    </div>
  )
}

function PostGrid({ posts }: { posts: DiscoverPost[] }) {
  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
      {posts.map((p, i) => (
        <Card key={p.key} className="p-3">
          <div className="flex items-center gap-1.5">
            <span style={PJ} className="w-5 h-5 rounded-md bg-[#f0f7fa] text-[#285D6E] text-[9.5px] font-extrabold flex items-center justify-center">
              {i + 1}
            </span>
            <span style={PJ} className="text-[11px] font-bold text-[#111827] truncate">{p.author}</span>
          </div>
          <p className="text-[10.5px] text-[#9ca3af] line-clamp-2 leading-snug mt-1.5">
            {p.caption || 'Tanpa caption'}
          </p>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#f3f4f6]">
            <span className="text-[10px] text-[#6b7280]">{p.format}</span>
            <span style={PJ} className="text-[11px] font-extrabold text-[#111827] tabular-nums">
              {p.erPct.toFixed(2)}%
            </span>
          </div>
          <div className="text-[9.5px] text-[#9ca3af] mt-0.5">{fmtNum(p.views)} views</div>
        </Card>
      ))}
    </div>
  )
}

/**
 * The source's "AI Analysis" block, computed rather than templated.
 *
 * Three readings: which format dominates this set, how much of it is organic,
 * and what to do about it. The source filled the same three sentences from
 * counts; these come from the actual posts on screen.
 */
function AutoAnalysis({ posts, best }: { posts: DiscoverPost[]; best: boolean }) {
  if (posts.length === 0) return null

  const byFormat = new Map<string, number>()
  let organic = 0, erTotal = 0
  for (const p of posts) {
    byFormat.set(p.format, (byFormat.get(p.format) ?? 0) + 1)
    if (!p.sponsored) organic++
    erTotal += p.erPct
  }
  const topFormat = [...byFormat.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['—', 0]
  const avgEr = erTotal / posts.length
  const organicPct = Math.round((organic / posts.length) * 100)

  const items = best
    ? [
        { icon: 'check_circle', tone: '#3d8a5f', bg: '#eaf5ef',
          text: `${topFormat[0]} mendominasi konten terbaik — ${topFormat[1]} dari ${posts.length} post, rata-rata ER ${avgEr.toFixed(2)}%.` },
        { icon: 'eco', tone: '#3d8a5f', bg: '#eaf5ef',
          text: `${organicPct}% konten teratas bersifat organik — post yang tidak di-boost tetap unggul.` },
        { icon: 'rocket_launch', tone: '#6b5bb5', bg: '#f3f0fb',
          text: `Rekomendasi: perbanyak produksi ${topFormat[0]} di sprint berikutnya dan pakai ulang hook post nomor 1 untuk creator lain.` },
      ]
    : [
        { icon: 'trending_down', tone: '#c2553f', bg: '#fcefec',
          text: `${topFormat[0]} paling banyak muncul di konten terlemah — ${topFormat[1]} dari ${posts.length} post, rata-rata ER hanya ${avgEr.toFixed(2)}%.` },
        { icon: 'sell', tone: '#b5761f', bg: '#fdf3e7',
          text: `${100 - organicPct}% di antaranya konten berbayar — framing hard-sell menekan engagement.` },
        { icon: 'auto_fix_high', tone: '#6b5bb5', bg: '#f3f0fb',
          text: `Rekomendasi: ubah brief ke arah storytelling organik dan kurangi volume ${topFormat[0]}.` },
      ]

  return (
    <Card className="mt-3 p-3.5">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-7 h-7 rounded-lg bg-[#f3f0fb] flex items-center justify-center">
          <span className="material-symbols-outlined text-[15px] text-[#6b5bb5]">insights</span>
        </span>
        <span style={PJ} className="text-[12px] font-extrabold text-[#111827]">
          Analisis otomatis — kenapa konten ini {best ? 'unggul' : 'tertinggal'}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {items.map(it => (
          <div key={it.icon} className="flex items-start gap-2">
            <span className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: it.bg }}>
              <span className="material-symbols-outlined text-[14px]" style={{ color: it.tone }}>{it.icon}</span>
            </span>
            <p className="text-[11.5px] text-[#374151] leading-relaxed flex-1">{it.text}</p>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-[#9ca3af] mt-2">
        Dihitung dari angka di atas, bukan dari model AI.
      </p>
    </Card>
  )
}

/* ── tab 3: Workspace Report ──────────────────────────────────────────────── */

const STATUS_GROUPS: { key: string; label: string; stages: string[] }[] = [
  { key: 'active', label: 'Berjalan', stages: ['in_progress', 'content_review', 'published', 'monitoring'] },
  { key: 'planned', label: 'Perencanaan', stages: ['draft', 'planning', 'briefed'] },
  { key: 'done', label: 'Selesai', stages: ['completed'] },
]

function WorkspaceReportTab({
  orders, orgSlug, onGenerated,
}: {
  orders: OrderSummary[]
  orgSlug: string
  onGenerated: (n: string, f: Format, r: string) => void
}) {
  const kpis = useMemo(() => {
    const running = orders.filter(o => STATUS_GROUPS[0].stages.includes(o.campaign.campaignStatus))
    return {
      campaigns: orders.length,
      creators: running.reduce((n, o) => n + o.accountCount, 0),
      deliverables: running.reduce((n, o) => n + o.itemCount, 0),
      paid: orders.filter(o => o.status === 'paid').length,
      spend: orders.reduce((n, o) => n + (o.status === 'paid' ? o.total : 0), 0),
    }
  }, [orders])

  /** Purchase history grouped by month, like the source's `purchaseHistoryHTML`. */
  const byMonth = useMemo(() => {
    const groups = new Map<string, OrderSummary[]>()
    for (const o of orders) {
      const key = (o.paidAt ?? o.createdAt ?? '').slice(0, 7) || 'Tanpa tanggal'
      const list = groups.get(key) ?? []
      list.push(o)
      groups.set(key, list)
    }
    return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [orders])

  const cols: ExportColumn<OrderSummary>[] = [
    { key: 'id', header: 'Order', value: o => `#${o.id}` },
    { key: 'name', header: 'Campaign', value: o => o.name },
    { key: 'stage', header: 'Status campaign', value: o => o.campaign.campaignStatus },
    { key: 'payment', header: 'Status bayar', value: o => o.status },
    { key: 'creators', header: 'Creator', value: o => o.accountCount },
    { key: 'items', header: 'Deliverable', value: o => o.itemCount },
    { key: 'budget', header: 'Budget', value: o => o.campaign.budget ?? '' },
    { key: 'total', header: 'Total', value: o => o.total },
    { key: 'reach', header: 'Est. reach', value: o => o.campaign.estReach ?? '' },
    { key: 'emv', header: 'Est. EMV', value: o => o.campaign.estEmv ?? '' },
  ]

  const download = (f: Format) => {
    const name = 'Workspace Report'
    if (f === 'CSV') exportCsv(orders, cols, name)
    else if (f === 'Excel') exportExcel(orders, cols, name)
    else exportPrintable(name, `
      <h1>Workspace Report</h1>
      <div class="sub">${kpis.campaigns} campaign · ${idr(kpis.spend)} total spend</div>
      <table><thead><tr><th>Order</th><th>Campaign</th><th>Status</th><th class="num">Creator</th><th class="num">Total</th></tr></thead><tbody>
        ${orders.map(o => `<tr><td>#${o.id}</td><td>${o.name}</td><td>${o.campaign.campaignStatus}</td><td class="num">${o.accountCount}</td><td class="num">${idr(o.total)}</td></tr>`).join('')}
      </tbody></table>`)
    onGenerated(name, f, 'Seluruh campaign')
  }

  if (orders.length === 0) {
    return <EmptyState icon="workspaces" title="Belum ada campaign di workspace"
      body="Setelah ada order yang dibuat, ringkasan portofolio dan riwayat pembeliannya muncul di sini." />
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5 mb-4">
        <Kpi label="Campaign" value={String(kpis.campaigns)} sub="semua status" icon="timeline" />
        <Kpi label="Creator berjalan" value={String(kpis.creators)} sub="campaign aktif" icon="group" />
        <Kpi label="Deliverable" value={String(kpis.deliverables)} sub="campaign aktif" icon="task_alt" />
        <Kpi label="Order lunas" value={String(kpis.paid)} sub={`dari ${orders.length}`} icon="verified" />
        <Kpi label="Total spend" value={idr(kpis.spend)} sub="order lunas" icon="payments" />
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span style={PJ} className="text-[12.5px] font-extrabold text-[#111827]">Campaign per status</span>
        <div className="flex-1" />
        {FORMATS.map(f => (
          <Btn key={f} size="sm" variant="secondary" onClick={() => download(f)}>
            <span className="material-symbols-outlined text-[14px]">download</span>{f}
          </Btn>
        ))}
      </div>

      {STATUS_GROUPS.map(g => {
        const list = orders.filter(o => g.stages.includes(o.campaign.campaignStatus))
        if (list.length === 0) return null
        return (
          <div key={g.key} className="mb-4">
            <div style={PJ} className="text-[11px] font-extrabold text-[#6b7280] mb-2">
              {g.label} · {list.length}
            </div>
            <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
              {list.map(o => (
                <Link key={o.id} href={`/organizations/${orgSlug}/discover/campaign-management`}>
                  <Card className="p-3.5 hover:border-[#A7C8D4] transition-colors">
                    <div className="flex items-center gap-2.5">
                      <div style={{ ...PJ, background: gradientFor(o.name) }}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[10px] font-extrabold">
                        {initials(o.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div style={PJ} className="text-[12px] font-extrabold text-[#111827] truncate">{o.name}</div>
                        <div className="text-[10px] text-[#9ca3af]">
                          {o.accountCount} creator · {o.itemCount} deliverable
                        </div>
                      </div>
                      <div className="text-right">
                        <div style={PJ} className="text-[12px] font-extrabold text-[#111827] tabular-nums">
                          {o.campaign.estReach != null ? fmtNum(o.campaign.estReach) : '—'}
                        </div>
                        <div className="text-[8.5px] text-[#9ca3af] uppercase tracking-wide">Est. reach</div>
                      </div>
                      <span className="material-symbols-outlined text-[16px] text-[#d1d5db]">chevron_right</span>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )
      })}

      <SectionHead icon="receipt_long" tone="#6b5bb5" label="Purchase History · per bulan" />
      {byMonth.map(([month, list]) => (
        <div key={month} className="mb-3">
          <div style={PJ} className="text-[11px] font-extrabold text-[#6b7280] mb-1.5">
            {month === 'Tanpa tanggal' ? month : monthLabel(month)} · {list.length} order
          </div>
          <div className="flex flex-col gap-2">
            {list.map(o => (
              <Card key={o.id} className="p-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[180px]">
                  <div style={PJ} className="text-[12px] font-extrabold text-[#111827] truncate">{o.name}</div>
                  <div className="text-[10px] text-[#9ca3af] truncate">
                    #{o.id} · {o.createdAt ? fmtDate(o.createdAt) : '—'}
                    {o.kols.length > 0 && ` · ${o.kols.slice(0, 3).join(', ')}`}
                  </div>
                </div>
                {[
                  ['Reach', o.campaign.estReach != null ? fmtNum(o.campaign.estReach) : '—'],
                  ['EMV', o.campaign.estEmv != null ? idr(o.campaign.estEmv) : '—'],
                  ['Total', idr(o.total)],
                ].map(([l, v]) => (
                  <div key={l} className="text-right">
                    <div style={PJ} className="text-[11.5px] font-extrabold text-[#111827] tabular-nums">{v}</div>
                    <div className="text-[8.5px] text-[#9ca3af] uppercase tracking-wide">{l}</div>
                  </div>
                ))}
                <Link href={`/organizations/${orgSlug}/discover/kol/orders/${o.id}`}>
                  <Btn size="sm" variant="secondary">
                    <span className="material-symbols-outlined text-[14px]">receipt_long</span>Detail
                  </Btn>
                </Link>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

/** `2026-08` → `Agustus 2026`. Falls back to the raw key if it is not a month. */
function monthLabel(key: string): string {
  const [y, m] = key.split('-')
  const names = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
  const idx = Number(m) - 1
  return names[idx] ? `${names[idx]} ${y}` : key
}

function Kpi({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: string }) {
  return (
    <Card className="p-3.5">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af]">{label}</div>
          <div style={PJ} className="text-[19px] font-extrabold text-[#111827] mt-1 tabular-nums truncate">{value}</div>
          {sub && <div className="text-[10.5px] text-[#9ca3af] mt-0.5">{sub}</div>}
        </div>
        <span className="w-8 h-8 rounded-lg bg-[#f0f7fa] flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-[17px] text-[#285D6E]">{icon}</span>
        </span>
      </div>
    </Card>
  )
}

/* ── report history ───────────────────────────────────────────────────────── */

function ReportHistory({ history }: { history: ReturnType<typeof useReportHistory> }) {
  return (
    <div className="mt-6">
      <SectionHead icon="history" tone="#285D6E" label="Report History" />
      <Card className="overflow-hidden">
        {history.items.length === 0 ? (
          <div className="px-4 py-6 text-center text-[11.5px] text-[#9ca3af]">
            Belum ada laporan dibuat dari browser ini.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px]">
                <thead>
                  <tr className="border-b border-[#e5e7eb]">
                    {['Report', 'Dibuat', 'Cakupan', 'Format'].map(h => (
                      <th key={h} style={PJ}
                        className="text-[10px] font-bold uppercase tracking-wider text-[#9ca3af] px-3 py-2.5 text-left">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.items.map(h => (
                    <tr key={h.id} className="border-b border-[#f3f4f6] last:border-0">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[15px] text-[#9ca3af]">
                            {h.format === 'PDF' ? 'picture_as_pdf' : h.format === 'Excel' ? 'table_view' : 'csv'}
                          </span>
                          <span style={PJ} className="text-[11.5px] font-bold text-[#111827] truncate">{h.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-[#9ca3af]">{fmtDate(h.createdAt)}</td>
                      <td className="px-3 py-2 text-[11px] text-[#6b7280]">{h.range}</td>
                      <td className="px-3 py-2">
                        <span style={PJ}
                          className="text-[9.5px] font-extrabold uppercase rounded px-1.5 py-0.5 bg-[#f0f7fa] text-[#285D6E]">
                          {h.format}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-[#f3f4f6] flex-wrap">
              {/* The source implied a server-side archive with re-download. This
                  is a local log, and says so rather than offering a button that
                  cannot deliver the same file twice. */}
              <span className="text-[10px] text-[#9ca3af]">
                Catatan lokal di browser ini — file-nya sudah diunduh saat dibuat, tidak disimpan di server.
              </span>
              <Btn size="sm" variant="ghost" onClick={history.clear}>
                <span className="material-symbols-outlined text-[14px]">delete</span>Bersihkan
              </Btn>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={PJ} className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af]">
      {children}
    </span>
  )
}
