'use client'

/**
 * Discover Settings — port of the source's `pages/module-settings.js`.
 *
 * The source's tab set was Connected Brands / Linked Influencers / Keywords /
 * Integrations / Rules / Preferences / AI. Here those become a read-out of the
 * real configuration behind Discover: which accounts feed it, which competitors
 * are tracked (with their verification state), which content pillars and
 * hashtags exist in the corpus, and which platforms are connected.
 *
 * Those sections are intentionally read-only, and say so. The source's toggles
 * were decorative — they flipped a CSS class and fired a toast. Wiring fake
 * switches to real infrastructure settings would be worse than not shipping
 * them, so each links to the page in autometric that actually owns that setting.
 *
 * **Brand Profile is the exception, and it is why this screen now writes.** It
 * is the source's `Connected Brands` / `Keywords & Hashtags` / `Recommendation
 * Rules` tabs made real: instead of decorative switches over invented rules, one
 * form that states what the brand is and what it wants, feeding
 * `@/lib/discover/brandMatch` — the engine that scores every creator in the
 * Creator Database. Nothing else in autometric owns that configuration, so
 * unlike every other tab here there is no page to link to.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardHead } from '@/components/dashboard/ui'
import {
  Btn, DiscoverHeader, EmptyState, ErrorState, PJ, PLATFORM_ICON, Spinner,
  TabStrip, fmtNum, gradientFor,
} from './ui'
import BrandProfileForm from './BrandProfileForm'
import type { DirectoryAccount, DirectoryPayload } from '@/lib/discover/types'
import type { DiscoverSummaryPayload } from '@/lib/discover/summary'

type Tab = 'brand' | 'accounts' | 'competitors' | 'pillars' | 'platforms'

/**
 * Brand Profile leads, and is the one tab here that WRITES.
 *
 * Everything else on this screen is a read-out of configuration autometric owns
 * elsewhere. The brand profile is owned here and nowhere else, and it is the
 * input to every match score in the module — so it sits first rather than being
 * filed behind the data sources it has nothing to do with.
 */
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'brand', label: 'Brand Profile', icon: 'handshake' },
  { id: 'accounts', label: 'Akun Brand', icon: 'storefront' },
  { id: 'competitors', label: 'Kompetitor', icon: 'group' },
  { id: 'pillars', label: 'Content Pillars', icon: 'tag' },
  { id: 'platforms', label: 'Platform', icon: 'hub' },
]

/**
 * One read-out source's load state. `unavailable` is its own state, not an
 * error: on the KOL-only product `/discover/directory` and `/discover/summary`
 * answer 503 `feature_unavailable` by design, because their data lives on the
 * analytics warehouse — the same answer `DiscoverCompare` treats as "no tracked
 * accounts" rather than a failure.
 */
type Source<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string }

async function loadSource<T>(url: string): Promise<Source<T>> {
  try {
    const r = await fetch(url)
    if (r.ok) return { status: 'ready', data: (await r.json()) as T }
    const body = await r.json().catch(() => null) as { error?: string; code?: string } | null
    if (r.status === 503 && body?.code === 'feature_unavailable') {
      return { status: 'unavailable', message: body.error ?? 'Sementara tidak tersedia.' }
    }
    return { status: 'error', message: `HTTP ${r.status}` }
  } catch (e) {
    return { status: 'error', message: String((e as Error).message ?? e) }
  }
}

export default function DiscoverSettings({
  orgId, orgSlug, embedded = false,
}: { orgId: string; orgSlug: string; embedded?: boolean }) {
  const [tab, setTab] = useState<Tab>('brand')
  const [dir, setDir] = useState<Source<DirectoryPayload>>({ status: 'loading' })
  const [summary, setSummary] = useState<Source<DiscoverSummaryPayload>>({ status: 'loading' })

  // Loaded independently, and never ahead of Brand Profile: that tab reads the
  // KOL database through its own route, so a read-out source being switched
  // off must not take the whole screen down with it.
  useEffect(() => {
    let cancelled = false
    setDir({ status: 'loading' })
    setSummary({ status: 'loading' })
    loadSource<DirectoryPayload>(`/api/organizations/${orgId}/discover/directory`)
      .then(s => { if (!cancelled) setDir(s) })
    loadSource<DiscoverSummaryPayload>(`/api/organizations/${orgId}/discover/summary`)
      .then(s => { if (!cancelled) setSummary(s) })
    return () => { cancelled = true }
  }, [orgId])

  const owned = dir.status === 'ready' ? dir.data.accounts.filter(a => a.relation === 'owned') : []
  const competitors = dir.status === 'ready' ? dir.data.accounts.filter(a => a.relation === 'competitor') : []

  return (
    <div className={embedded ? '' : 'p-5 max-w-[1200px] mx-auto'}>
      <DiscoverHeader
        title="Discover Settings"
        subtitle="Brand profile yang dipakai Brand Match Engine, plus sumber data modul Discover. Tab selain Brand Profile bersifat hanya-baca dan menautkan ke halaman yang mengatur setelan itu."
        actions={
          <Link href={`/organizations/${orgSlug}/brands`}>
            <Btn variant="primary">
              <span className="material-symbols-outlined text-[15px]">settings</span>Kelola brand &amp; akun
            </Btn>
          </Link>
        }
      />

      <TabStrip tabs={TABS} value={tab} onChange={setTab} />

      <div className="mt-4">
        {tab === 'brand' && <BrandProfileForm orgId={orgId} />}

        {tab === 'accounts' && dir.status !== 'ready' && <SourceState source={dir} />}
        {tab === 'accounts' && dir.status === 'ready' && (
          <Card className="overflow-hidden">
            <CardHead title="Akun brand" sub={`${owned.length} akun yang datanya masuk ke Discover`} />
            {owned.length === 0
              ? <EmptyState icon="storefront" title="Belum ada akun brand"
                  body="Hubungkan akun sosial brand kamu supaya kontennya muncul di Discover."
                  action={<Link href={`/organizations/${orgSlug}/brands`}><Btn size="sm">Ke halaman Brands</Btn></Link>} />
              : <AccountRows rows={owned} />}
          </Card>
        )}

        {tab === 'competitors' && dir.status !== 'ready' && <SourceState source={dir} />}
        {tab === 'competitors' && dir.status === 'ready' && (
          <Card className="overflow-hidden">
            <CardHead title="Akun kompetitor" sub={`${competitors.length} akun kompetitor yang dilacak`} />
            {competitors.length === 0
              ? <EmptyState icon="group" title="Belum ada kompetitor"
                  body="Tambahkan kompetitor di halaman brand untuk membandingkan kontennya di Discover." />
              : <AccountRows rows={competitors} />}
          </Card>
        )}

        {(tab === 'pillars' || tab === 'platforms') && summary.status !== 'ready' && <SourceState source={summary} />}
        {tab === 'pillars' && summary.status === 'ready' && (
          <Card>
            <CardHead title="Content pillars" sub="Pillar yang terdeteksi pada konten brand — dipakai sebagai filter Category di Discovery Content" />
            <div className="px-4 pb-4">
              {summary.data.byPillar.length === 0 ? (
                <EmptyState icon="category" title="Belum ada pillar"
                  body="Konten brand belum diberi content pillar, jadi filter Category di Discover masih kosong." />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {summary.data.byPillar.map(p => (
                    <span key={p.label} style={PJ}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#e5e7eb] bg-white px-3 h-8 text-[11.5px] font-bold text-[#374151]">
                      {p.label}
                      <span className="text-[10px] font-semibold text-[#9ca3af]">{p.posts} post</span>
                      <span className="text-[10px] font-bold text-[#285D6E]">{p.erPct.toFixed(1)}% ER</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}

        {tab === 'platforms' && summary.status === 'ready' && (
          <Card>
            <CardHead title="Platform" sub="Platform yang menyumbang data ke Discover" />
            <div className="px-4 pb-4 flex flex-col gap-2">
              {summary.data.byPlatform.map(p => (
                <div key={p.label} className="flex items-center gap-3 py-2 border-b border-[#f3f4f6] last:border-0">
                  <span className="w-9 h-9 rounded-xl bg-[#f0f7fa] flex items-center justify-center">
                    <span className="material-symbols-outlined text-[17px] text-[#285D6E]">
                      {PLATFORM_ICON[p.label] ?? 'public'}
                    </span>
                  </span>
                  <div className="flex-1">
                    <div style={PJ} className="text-[12.5px] font-bold text-[#111827] capitalize">{p.label}</div>
                    <div className="text-[10.5px] text-[#9ca3af]">
                      {p.posts} post · {fmtNum(p.views)} views · {p.erPct.toFixed(2)}% ER
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-md bg-[#eaf5ef] text-[#3d8a5f] text-[9.5px] font-extrabold uppercase px-2 py-1">
                    <span className="material-symbols-outlined text-[12px]">check_circle</span>Aktif
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

/**
 * A read-out tab whose source is not ready. `unavailable` says so plainly and
 * shows no numbers: an empty list would read as "this workspace has none",
 * which is not what a switched-off source means.
 */
function SourceState({ source }: { source: Source<unknown> }) {
  if (source.status === 'loading') return <Spinner />
  if (source.status === 'error') return <ErrorState message={source.message} />
  if (source.status === 'unavailable') {
    return (
      <Card>
        <EmptyState icon="cloud_off" title={source.message}
          body="Data ini belum tersedia di database KOL, jadi tab ini sengaja tidak menampilkan angka. Brand Profile tetap bisa dipakai." />
      </Card>
    )
  }
  return null
}

function AccountRows({ rows }: { rows: DirectoryAccount[] }) {
  return (
    <div className="px-4 pb-4 flex flex-col">
      {rows.map(a => (
        <div key={`${a.relation}:${a.id}`}
          className="flex items-center gap-3 py-2.5 border-b border-[#f3f4f6] last:border-0">
          <div style={{ ...PJ, background: gradientFor(a.username) }}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-[11px] font-extrabold">
            {a.username.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '??'}
          </div>
          <div className="flex-1 min-w-0">
            <div style={PJ} className="text-[12.5px] font-bold text-[#111827] truncate">{a.username}</div>
            <div className="flex items-center gap-1 text-[10.5px] text-[#9ca3af]">
              <span className="material-symbols-outlined text-[12px]">{PLATFORM_ICON[a.platform] ?? 'public'}</span>
              <span className="capitalize">{a.platform}</span>
              {a.brandName && <><span className="text-[#d1d5db]">·</span><span className="truncate">{a.brandName}</span></>}
            </div>
          </div>
          <div className="text-right">
            <div style={PJ} className="text-[12px] font-extrabold text-[#111827] tabular-nums">{a.postCount}</div>
            <div className="text-[9.5px] text-[#9ca3af]">post</div>
          </div>
          <div className="text-right w-20">
            <div style={PJ} className="text-[12px] font-extrabold text-[#111827] tabular-nums">{fmtNum(a.totalViews)}</div>
            <div className="text-[9.5px] text-[#9ca3af]">views</div>
          </div>
        </div>
      ))}
    </div>
  )
}
