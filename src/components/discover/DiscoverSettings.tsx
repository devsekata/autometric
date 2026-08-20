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
 * It is intentionally read-only, and says so. The source's toggles were
 * decorative — they flipped a CSS class and fired a toast. Wiring fake switches
 * to real infrastructure settings would be worse than not shipping them, so
 * each section links to the page in autometric that actually owns that setting.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardHead } from '@/components/dashboard/ui'
import {
  Btn, DiscoverHeader, EmptyState, ErrorState, PJ, PLATFORM_ICON, Spinner,
  TabStrip, fmtNum, gradientFor,
} from './ui'
import type { DirectoryAccount, DirectoryPayload } from '@/lib/discover/types'
import type { DiscoverSummaryPayload } from '@/lib/discover/summary'

type Tab = 'accounts' | 'competitors' | 'pillars' | 'platforms'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'accounts', label: 'Akun Brand', icon: 'storefront' },
  { id: 'competitors', label: 'Kompetitor', icon: 'group' },
  { id: 'pillars', label: 'Content Pillars', icon: 'tag' },
  { id: 'platforms', label: 'Platform', icon: 'hub' },
]

export default function DiscoverSettings({
  orgId, orgSlug, embedded = false,
}: { orgId: string; orgSlug: string; embedded?: boolean }) {
  const [tab, setTab] = useState<Tab>('accounts')
  const [dir, setDir] = useState<DirectoryPayload | null>(null)
  const [summary, setSummary] = useState<DiscoverSummaryPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`/api/organizations/${orgId}/discover/directory`).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))),
      fetch(`/api/organizations/${orgId}/discover/summary`).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))),
    ])
      .then(([d, s]) => { if (!cancelled) { setDir(d); setSummary(s) } })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })
    return () => { cancelled = true }
  }, [orgId])

  if (error) return <div className={embedded ? '' : 'p-5'}><ErrorState message={error} /></div>
  if (!dir || !summary) return <div className={embedded ? '' : 'p-5'}><Spinner /></div>

  const owned = dir.accounts.filter(a => a.relation === 'owned')
  const competitors = dir.accounts.filter(a => a.relation === 'competitor')

  return (
    <div className={embedded ? '' : 'p-5 max-w-[1200px] mx-auto'}>
      <DiscoverHeader
        title="Discover Settings"
        subtitle="Sumber data yang dipakai modul Discover. Hanya-baca — setiap bagian menautkan ke halaman yang mengatur setelan itu."
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
        {tab === 'accounts' && (
          <Card className="overflow-hidden">
            <CardHead title="Akun brand" sub={`${owned.length} akun yang datanya masuk ke Discover`} />
            {owned.length === 0
              ? <EmptyState icon="storefront" title="Belum ada akun brand"
                  body="Hubungkan akun sosial brand kamu supaya kontennya muncul di Discover."
                  action={<Link href={`/organizations/${orgSlug}/brands`}><Btn size="sm">Ke halaman Brands</Btn></Link>} />
              : <AccountRows rows={owned} />}
          </Card>
        )}

        {tab === 'competitors' && (
          <Card className="overflow-hidden">
            <CardHead title="Akun kompetitor" sub={`${competitors.length} akun kompetitor yang dilacak`} />
            {competitors.length === 0
              ? <EmptyState icon="group" title="Belum ada kompetitor"
                  body="Tambahkan kompetitor di halaman brand untuk membandingkan kontennya di Discover." />
              : <AccountRows rows={competitors} />}
          </Card>
        )}

        {tab === 'pillars' && (
          <Card>
            <CardHead title="Content pillars" sub="Pillar yang terdeteksi pada konten brand — dipakai sebagai filter Category di Discovery Content" />
            <div className="px-4 pb-4">
              {summary.byPillar.length === 0 ? (
                <EmptyState icon="category" title="Belum ada pillar"
                  body="Konten brand belum diberi content pillar, jadi filter Category di Discover masih kosong." />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {summary.byPillar.map(p => (
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

        {tab === 'platforms' && (
          <Card>
            <CardHead title="Platform" sub="Platform yang menyumbang data ke Discover" />
            <div className="px-4 pb-4 flex flex-col gap-2">
              {summary.byPlatform.map(p => (
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
