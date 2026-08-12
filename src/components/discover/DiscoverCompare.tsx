'use client'

/**
 * Compare — port of the source platform's `pages/compare.js`.
 *
 * Keeps the original's shape: a grid of per-account columns (or a table view),
 * the winning value in each metric row marked with a ★, an "Add:" strip of
 * candidates, and an empty state until at least two are selected. Selection is
 * shared with Directory through localStorage (see useDiscoverSelection).
 *
 * The source compared influencer commercials (CPE, EMV, rate card). None of
 * those exist here, so the metric set is the performance data autometric
 * actually holds for an account.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Btn, DiscoverHeader, EmptyState, ErrorState, PJ, PLATFORM_ICON, Spinner,
  fmtNum, gradientFor,
} from './ui'
import { useDiscoverSelection } from './useDiscoverSelection'
import type { DirectoryAccount, DirectoryPayload } from '@/lib/discover/types'

/** `higherIsBetter` drives which value gets the ★ in each row. */
const METRICS: {
  label: string
  get: (a: DirectoryAccount) => number
  fmt: (a: DirectoryAccount) => string
  higherIsBetter: boolean
}[] = [
  { label: 'Posts',        get: a => a.postCount,     fmt: a => String(a.postCount),          higherIsBetter: true },
  { label: 'Total Views',  get: a => a.totalViews,    fmt: a => fmtNum(a.totalViews),         higherIsBetter: true },
  { label: 'Total Likes',  get: a => a.totalLikes,    fmt: a => fmtNum(a.totalLikes),         higherIsBetter: true },
  { label: 'Comments',     get: a => a.totalComments, fmt: a => fmtNum(a.totalComments),      higherIsBetter: true },
  { label: 'Avg. ER',      get: a => a.avgErPct,      fmt: a => `${a.avgErPct.toFixed(2)}%`,  higherIsBetter: true },
  {
    label: 'Views / Post',
    get: a => (a.postCount ? a.totalViews / a.postCount : 0),
    fmt: a => (a.postCount ? fmtNum(Math.round(a.totalViews / a.postCount)) : '—'),
    higherIsBetter: true,
  },
]

export default function DiscoverCompare({
  orgId, orgSlug, embedded = false, onGoToPlanning,
}: {
  orgId: string
  orgSlug: string
  embedded?: boolean
  /**
   * Compare answers "which of these?", and the answer is only worth anything if
   * you can act on it. Embedded in the workspace it continues into Campaign
   * Planning with the compared set already shortlisted.
   */
  onGoToPlanning?: () => void
}) {
  const [data, setData] = useState<DirectoryPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [view, setView] = useState<'grid' | 'table'>('grid')
  const compare = useDiscoverSelection(orgId, 'compare')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/organizations/${orgId}/discover/directory`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: DirectoryPayload) => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })
    return () => { cancelled = true }
  }, [orgId])

  const selected = useMemo(
    () => (data?.accounts ?? []).filter(a => compare.ids.has(a.id)),
    [data, compare.ids],
  )

  const available = useMemo(() => {
    if (!data) return []
    const needle = q.trim().toLowerCase()
    return data.accounts.filter(a =>
      !compare.ids.has(a.id) && (!needle || a.username.toLowerCase().includes(needle)))
  }, [data, compare.ids, q])

  /** Winning value per metric — recomputed per render over the selected set. */
  const best = useMemo(() => METRICS.map(m => {
    if (selected.length === 0) return null
    const vals = selected.map(m.get)
    return m.higherIsBetter ? Math.max(...vals) : Math.min(...vals)
  }), [selected])

  if (error) return embedded ? <ErrorState message={error} /> : <div className="p-5"><ErrorState message={error} /></div>
  if (!data || !compare.ready) return embedded ? <Spinner /> : <div className="p-5"><Spinner /></div>

  return (
    <div className={embedded ? '' : 'p-5 max-w-[1500px] mx-auto'}>
      {!embedded && <DiscoverHeader
        title="Compare"
        subtitle={`${selected.length} akun dipilih · pilih minimal 2 untuk membandingkan`}
        actions={
          <>
            <div className="flex rounded-lg border border-[#e5e7eb] overflow-hidden">
              {(['grid', 'table'] as const).map(v => (
                <button key={v} type="button" onClick={() => setView(v)} style={PJ}
                  className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 h-8 ${
                    view === v ? 'bg-[#f0f7fa] text-[#285D6E]' : 'bg-white text-[#9ca3af] hover:text-[#374151]'
                  }`}>
                  <span className="material-symbols-outlined text-[15px]">{v === 'grid' ? 'grid_view' : 'table_rows'}</span>
                  {v === 'grid' ? 'Grid' : 'Table'}
                </button>
              ))}
            </div>
            {selected.length > 0 && (
              <Btn variant="ghost" onClick={compare.clear}>
                <span className="material-symbols-outlined text-[15px]">close</span>Clear
              </Btn>
            )}
            <Link href={`/organizations/${orgSlug}/discover/kol`}>
              <Btn variant="secondary">
                <span className="material-symbols-outlined text-[15px]">badge</span>KOL Intelligence
              </Btn>
            </Link>
          </>
        }
      />}

      {/* Embedded, the page header above belongs to the workspace, so the same
          controls need their own row here — without it the view toggle and
          Clear simply vanished inside KOL Intelligence. */}
      {embedded && (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className="text-[11px] text-[#9ca3af]">
            {selected.length} akun dipilih{selected.length < 2 && ' · pilih minimal 2 untuk membandingkan'}
          </span>
          <div className="flex-1" />
          <div className="flex rounded-lg border border-[#e5e7eb] overflow-hidden">
            {(['grid', 'table'] as const).map(v => (
              <button key={v} type="button" onClick={() => setView(v)} style={PJ}
                className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 h-8 ${
                  view === v ? 'bg-[#f0f7fa] text-[#285D6E]' : 'bg-white text-[#9ca3af] hover:text-[#374151]'
                }`}>
                <span className="material-symbols-outlined text-[15px]">{v === 'grid' ? 'grid_view' : 'table_rows'}</span>
                {v === 'grid' ? 'Grid' : 'Table'}
              </button>
            ))}
          </div>
          {selected.length > 0 && (
            <Btn size="sm" variant="ghost" onClick={compare.clear}>
              <span className="material-symbols-outlined text-[14px]">close</span>Clear
            </Btn>
          )}
          {onGoToPlanning && selected.length > 0 && (
            <Btn size="sm" variant="primary" onClick={onGoToPlanning}>
              <span className="material-symbols-outlined text-[14px]">edit_calendar</span>
              Lanjut ke Campaign Planning
            </Btn>
          )}
        </div>
      )}

      {/* Candidate picker — the source's "Add:" chip strip. */}
      <div className="bg-white border border-[#e5e7eb] rounded-xl p-3 mb-4">
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-[#9ca3af]">search</span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Cari akun…"
              className="w-[260px] max-w-full h-8 pl-8 pr-3 rounded-lg border border-[#e5e7eb] text-[12px] text-[#374151] placeholder:text-[#9ca3af] focus:outline-none focus:border-[#327488]" />
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
          <span style={PJ} className="text-[10.5px] font-bold text-[#9ca3af]">Tambah:</span>
          {available.length === 0 ? (
            <span className="text-[11px] text-[#9ca3af]">Semua akun sudah dipilih atau tidak ada yang cocok.</span>
          ) : available.slice(0, 8).map(a => (
            <button key={a.id} type="button" onClick={() => compare.toggle(a.id)} style={PJ}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#e5e7eb] bg-white pl-1 pr-2.5 h-7 text-[11px] font-bold text-[#6b7280] hover:border-[#327488] hover:text-[#285D6E]">
              <span className="material-symbols-outlined text-[13px]">add</span>
              <span style={{ background: gradientFor(a.username) }}
                className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[8px] font-extrabold">
                {a.username.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '??'}
              </span>
              {a.username}
            </button>
          ))}
        </div>
      </div>

      {selected.length < 2 ? (
        <EmptyState icon="compare" title="Pilih minimal 2 akun"
          body="Tambahkan akun lewat chip di atas atau dari halaman Directory untuk membandingkannya berdampingan." />
      ) : view === 'grid' ? (
        <div className="overflow-x-auto pb-1">
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${selected.length}, minmax(200px, 1fr))` }}>
            {selected.map(a => (
              <div key={a.id} className="bg-white border border-[#e5e7eb] rounded-xl overflow-hidden">
                <div className="relative p-3 text-white" style={{ background: gradientFor(a.id) }}>
                  <button type="button" onClick={() => compare.toggle(a.id)} title="Hapus dari compare"
                    className="absolute top-2 right-2 w-5 h-5 rounded-md bg-white/25 hover:bg-white/40 flex items-center justify-center">
                    <span className="material-symbols-outlined text-[13px]">close</span>
                  </button>
                  <div style={PJ} className="w-9 h-9 rounded-xl bg-white/25 flex items-center justify-center text-[12px] font-extrabold">
                    {a.username.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '??'}
                  </div>
                  <div style={PJ} className="text-[12.5px] font-extrabold mt-1.5 truncate">{a.username}</div>
                  <div className="flex items-center gap-1 text-[10px] opacity-90 mt-0.5">
                    <span className="material-symbols-outlined text-[11px]">{PLATFORM_ICON[a.platform] ?? 'public'}</span>
                    {a.platform} · {a.relation === 'owned' ? 'Brand' : 'Competitor'}
                  </div>
                </div>
                {METRICS.map((m, i) => {
                  const isBest = best[i] !== null && m.get(a) === best[i] && selected.length > 1
                  return (
                    <div key={m.label} className="flex items-center justify-between px-3 py-2 border-b border-[#f3f4f6] last:border-0">
                      <span className="text-[10.5px] text-[#9ca3af]">{m.label}</span>
                      <span style={PJ}
                        className={`text-[11.5px] font-extrabold tabular-nums ${isBest ? 'text-[#3d8a5f]' : 'text-[#374151]'}`}>
                        {m.fmt(a)}{isBest && ' ★'}
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white border border-[#e5e7eb] rounded-xl overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-[#e5e7eb]">
                <th style={PJ} className="text-left text-[10.5px] font-bold uppercase tracking-wider text-[#9ca3af] px-3 py-2.5">Akun</th>
                {METRICS.map(m => (
                  <th key={m.label} style={PJ} className="text-right text-[10.5px] font-bold uppercase tracking-wider text-[#9ca3af] px-3 py-2.5">
                    {m.label}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {selected.map(a => (
                <tr key={a.id} className="border-b border-[#f3f4f6] last:border-0 hover:bg-[#f9fafb]">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div style={{ ...PJ, background: gradientFor(a.username) }}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[9px] font-extrabold">
                        {a.username.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '??'}
                      </div>
                      <span style={PJ} className="text-[12px] font-bold text-[#111827]">{a.username}</span>
                    </div>
                  </td>
                  {METRICS.map((m, i) => {
                    const isBest = best[i] !== null && m.get(a) === best[i]
                    return (
                      <td key={m.label} style={PJ}
                        className={`px-3 py-2 text-[11.5px] font-bold text-right tabular-nums ${isBest ? 'text-[#3d8a5f]' : 'text-[#374151]'}`}>
                        {m.fmt(a)}{isBest && ' ★'}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => compare.toggle(a.id)}
                      className="material-symbols-outlined text-[16px] text-[#9ca3af] hover:text-[#374151] cursor-pointer">
                      close
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
