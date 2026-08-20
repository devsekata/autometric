'use client'

/**
 * Compare — port of the source platform's `pages/compare.js`.
 *
 * Keeps the original's shape: per-creator columns (or a table view), the winning
 * value in each row marked with a ★, an "Add:" strip of candidates, and an empty
 * state until at least two are picked.
 *
 * Every figure is read from a database. Nothing here is modelled or sampled —
 * which is worth stating, because the Creator Intelligence Workspace next door
 * *does* generate demo figures for roster creators (`@/lib/discover/kolSample`)
 * and this screen deliberately shares none of that. If a number cannot be
 * measured it is left blank rather than filled in.
 *
 * Two populations can be compared, and they are measured by different systems:
 *
 *   * **tracked accounts** — the warehouse holds the posts autometric collected,
 *     so posts, views, likes, comments and engagement rate are aggregates over
 *     real content;
 *   * **roster creators** — the commercial KOL platform's directory holds mostly
 *     identity: follower count, its own published engagement rate, tier,
 *     category, city, verified flag. A small number of them do have harvested
 *     posts and prices in the warehouse (`@/lib/discover/kolMeasured`), which
 *     this screen does not read yet — it compares the roster's own columns, so a
 *     creator here is described by the same fields as every other.
 *
 * So the rows are grouped by what actually produced them, and a creator without
 * a given measurement shows "—", never a zero. The only figure both populations
 * carry is engagement rate, and even that comes from two different measurements,
 * so each cell says which one it is. Presenting those side by side without
 * saying so would be the one dishonest thing this screen could do.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Btn, DiscoverHeader, EmptyState, ErrorState, PJ, PLATFORM_ICON, Spinner,
  fmtNum, gradientFor,
} from './ui'
import { idsOf, selectionKey, useDiscoverSelection } from './useDiscoverSelection'
import type { DirectoryAccount, DirectoryPayload } from '@/lib/discover/types'
import type { KolDirectoryPayload, KolDirectoryRow } from '@/lib/discover/kolDirectory'

/* ── the two populations, in one shape ────────────────────────────────────── */

interface Contender {
  /** The key it is stored under in the selection. */
  key: string
  id: string
  source: 'account' | 'roster'
  username: string
  platform: string | null
  /** Brand / Competitor for a tracked account; the tier for a roster creator. */
  badge: string

  /* measured by autometric, from collected posts */
  postCount: number | null
  totalViews: number | null
  totalLikes: number | null
  totalComments: number | null
  measuredErPct: number | null

  /* published by the KOL platform */
  followers: number | null
  rosterErPct: number | null
  verified: boolean | null
  category: string | null
  city: string | null
}

const fromAccount = (a: DirectoryAccount): Contender => ({
  key: selectionKey('account', a.id),
  id: a.id,
  source: 'account',
  username: a.username,
  platform: a.platform,
  badge: a.relation === 'owned' ? 'Brand' : 'Competitor',
  postCount: a.postCount,
  totalViews: a.totalViews,
  totalLikes: a.totalLikes,
  totalComments: a.totalComments,
  measuredErPct: a.avgErPct,
  followers: null,
  rosterErPct: null,
  verified: null,
  category: null,
  city: null,
})

const fromRoster = (r: KolDirectoryRow): Contender => ({
  key: selectionKey('roster', r.id),
  id: r.id,
  source: 'roster',
  username: r.username,
  platform: r.platform,
  badge: r.tier ?? 'Directory',
  postCount: null,
  totalViews: null,
  totalLikes: null,
  totalComments: null,
  measuredErPct: null,
  followers: r.followers,
  rosterErPct: r.erPct,
  verified: r.verified,
  category: r.categories[0] ?? null,
  city: r.city,
})

/* ── the rows ─────────────────────────────────────────────────────────────── */

interface MetricRow {
  label: string
  /** Null when this creator's source does not measure it. */
  get: (c: Contender) => number | null
  fmt: (c: Contender) => string
  higherIsBetter: boolean
  /** Shown on hover, per cell, when the value is missing. */
  missing: (c: Contender) => string
}

interface MetricGroup {
  title: string
  note: string
  rows: MetricRow[]
}

const noPosts = 'Creator dari roster: platform KOL tidak menyimpan post, jadi angka ini tidak ada.'
const notRoster = 'Akun yang di-track: angka ini hanya diterbitkan oleh platform KOL.'

const num = (v: number | null, f: (n: number) => string) => (v === null ? '—' : f(v))

const GROUPS: MetricGroup[] = [
  {
    title: 'Engagement rate',
    note: 'Satu-satunya angka yang dimiliki kedua sumber — dan keduanya mengukurnya dengan cara berbeda, jadi tiap sel menyebut asalnya.',
    rows: [
      {
        label: 'Engagement rate',
        get: c => (c.source === 'account' ? c.measuredErPct : c.rosterErPct),
        fmt: c => {
          const v = c.source === 'account' ? c.measuredErPct : c.rosterErPct
          return v === null ? '—' : `${v.toFixed(2)}%`
        },
        higherIsBetter: true,
        missing: () => 'Belum pernah terukur.',
      },
    ],
  },
  {
    title: 'Dari post yang terkumpul',
    note: 'Agregat atas konten yang benar-benar di-ingest autometric. Kosong untuk creator roster.',
    rows: [
      {
        label: 'Jumlah post', get: c => c.postCount,
        fmt: c => num(c.postCount, n => String(n)), higherIsBetter: true, missing: () => noPosts,
      },
      {
        label: 'Total views', get: c => c.totalViews,
        fmt: c => num(c.totalViews, fmtNum), higherIsBetter: true, missing: () => noPosts,
      },
      {
        label: 'Total likes', get: c => c.totalLikes,
        fmt: c => num(c.totalLikes, fmtNum), higherIsBetter: true, missing: () => noPosts,
      },
      {
        label: 'Total komentar', get: c => c.totalComments,
        fmt: c => num(c.totalComments, fmtNum), higherIsBetter: true, missing: () => noPosts,
      },
      {
        label: 'Views / post',
        get: c => (c.postCount && c.totalViews !== null ? c.totalViews / c.postCount : null),
        fmt: c => (c.postCount && c.totalViews !== null
          ? fmtNum(Math.round(c.totalViews / c.postCount)) : '—'),
        higherIsBetter: true,
        missing: c => (c.source === 'roster' ? noPosts : 'Belum ada post terkumpul.'),
      },
    ],
  },
  {
    title: 'Dari roster KOL',
    note: 'Diterbitkan oleh platform KOL. Kosong untuk akun yang kamu track sendiri.',
    rows: [
      {
        label: 'Followers', get: c => c.followers,
        fmt: c => num(c.followers, fmtNum), higherIsBetter: true, missing: () => notRoster,
      },
    ],
  },
]

/** Non-numeric facts, shown under the columns rather than ranked. */
const FACTS: { label: string; get: (c: Contender) => string | null }[] = [
  { label: 'Tier / relasi', get: c => c.badge },
  { label: 'Kategori', get: c => c.category },
  { label: 'Kota', get: c => c.city },
  { label: 'Verified', get: c => (c.verified === null ? null : c.verified ? 'Ya' : 'Tidak') },
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
  const [roster, setRoster] = useState<KolDirectoryRow[]>([])
  const [rosterError, setRosterError] = useState<string | null>(null)
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

  /** The roster ids currently selected, as a stable key for the fetch below. */
  const rosterIds = useMemo(
    () => idsOf(compare.ids, 'roster').sort().join(','),
    [compare.ids])

  /**
   * Roster creators are fetched by id rather than filtered out of a page: a
   * selection can span any part of a 7.7k roster, and the ids are exactly what
   * the selection already knows.
   */
  useEffect(() => {
    if (!compare.ready) return
    if (!rosterIds) { setRoster([]); setRosterError(null); return }
    let cancelled = false
    fetch(`/api/organizations/${orgId}/discover/kol-directory?ids=${rosterIds}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: KolDirectoryPayload) => { if (!cancelled) { setRoster(d.rows); setRosterError(null) } })
      // The roster lives on another server. Losing it drops those columns and
      // says so, rather than failing the whole comparison.
      .catch(e => { if (!cancelled) setRosterError(String(e.message ?? e)) })
    return () => { cancelled = true }
  }, [orgId, rosterIds, compare.ready])

  const selected = useMemo<Contender[]>(() => {
    const accounts = (data?.accounts ?? [])
      .filter(a => compare.ids.has(selectionKey('account', a.id)))
      .map(fromAccount)
    return [...accounts, ...roster.map(fromRoster)]
  }, [data, roster, compare.ids])

  const available = useMemo(() => {
    if (!data) return []
    const needle = q.trim().toLowerCase()
    return data.accounts.filter(a =>
      !compare.ids.has(selectionKey('account', a.id))
      && (!needle || a.username.toLowerCase().includes(needle)))
  }, [data, compare.ids, q])

  /**
   * The winning value per row, over the cells that actually have one.
   *
   * Rows where fewer than two creators are measured get no ★ at all: crowning a
   * winner out of a field of one is not a comparison, and with mixed populations
   * that happens on most rows.
   */
  const best = useMemo(() => {
    const map = new Map<string, number | null>()
    for (const g of GROUPS) {
      for (const m of g.rows) {
        const vals = selected.map(m.get).filter((v): v is number => v !== null)
        map.set(m.label, vals.length >= 2
          ? (m.higherIsBetter ? Math.max(...vals) : Math.min(...vals))
          : null)
      }
    }
    return map
  }, [selected])

  const rosterCount = selected.filter(c => c.source === 'roster').length
  const accountCount = selected.length - rosterCount

  if (error) return embedded ? <ErrorState message={error} /> : <div className="p-5"><ErrorState message={error} /></div>
  if (!data || !compare.ready) return embedded ? <Spinner /> : <div className="p-5"><Spinner /></div>

  const viewToggle = (
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
  )

  const mixNote = accountCount > 0 && rosterCount > 0

  return (
    <div className={embedded ? '' : 'p-5 max-w-[1500px] mx-auto'}>
      {!embedded && <DiscoverHeader
        title="Compare"
        subtitle={`${selected.length} creator dipilih · pilih minimal 2 untuk membandingkan`}
        actions={
          <>
            {viewToggle}
            {selected.length > 0 && (
              <Btn variant="ghost" onClick={compare.clear}>
                <span className="material-symbols-outlined text-[15px]">close</span>Clear
              </Btn>
            )}
            <Link href={`/organizations/${orgSlug}/discover`}>
              <Btn variant="secondary">
                <span className="material-symbols-outlined text-[15px]">grid_view</span>Directory
              </Btn>
            </Link>
          </>
        }
      />}

      {/* Embedded, the page header above belongs to the workspace, so the same
          controls need their own row here — without it the view toggle and
          Clear simply vanished inside the workspace. */}
      {embedded && (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className="text-[11px] text-[#9ca3af]">
            {selected.length} creator dipilih
            {accountCount > 0 && rosterCount > 0 && ` · ${accountCount} akun tracked, ${rosterCount} dari Directory`}
            {selected.length < 2 && ' · pilih minimal 2 untuk membandingkan'}
          </span>
          <div className="flex-1" />
          {viewToggle}
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

      {rosterError && (
        <div className="flex items-start gap-2 bg-[#fcefec] border border-[#f0c8bf] rounded-xl px-3.5 py-2.5 mb-3">
          <span className="material-symbols-outlined text-[16px] text-[#c2553f] mt-0.5">cloud_off</span>
          <p className="text-[11.5px] text-[#c2553f] leading-relaxed">
            Creator dari Directory tidak bisa dimuat — database KOL tidak terjangkau. Akun yang
            kamu track tetap dibandingkan. ({rosterError})
          </p>
        </div>
      )}

      {mixNote && (
        <div className="flex items-start gap-2 bg-[#f0f7fa] border border-[#A7C8D4] rounded-xl px-3.5 py-2.5 mb-3">
          <span className="material-symbols-outlined text-[16px] text-[#285D6E] mt-0.5">info</span>
          <p className="text-[11.5px] text-[#285D6E] leading-relaxed">
            Kamu membandingkan dua sumber yang berbeda. Akun tracked punya angka dari post yang
            terkumpul; creator Directory hanya punya identitas dari platform KOL. Sel yang kosong
            berarti <b>tidak diukur</b>, bukan nol.
          </p>
        </div>
      )}

      {/* Candidate picker — the source's "Add:" chip strip. */}
      <div className="bg-white border border-[#e5e7eb] rounded-xl p-3 mb-4">
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-[#9ca3af]">search</span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Cari akun tracked…"
              className="w-[260px] max-w-full h-8 pl-8 pr-3 rounded-lg border border-[#e5e7eb] text-[12px] text-[#374151] placeholder:text-[#9ca3af] focus:outline-none focus:border-[#327488]" />
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
          <span style={PJ} className="text-[10.5px] font-bold text-[#9ca3af]">Tambah:</span>
          {available.length === 0 ? (
            <span className="text-[11px] text-[#9ca3af]">Semua akun sudah dipilih atau tidak ada yang cocok.</span>
          ) : available.slice(0, 8).map(a => (
            <button key={a.id} type="button" onClick={() => compare.toggle(selectionKey('account', a.id))} style={PJ}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#e5e7eb] bg-white pl-1 pr-2.5 h-7 text-[11px] font-bold text-[#6b7280] hover:border-[#327488] hover:text-[#285D6E]">
              <span className="material-symbols-outlined text-[13px]">add</span>
              <span style={{ background: gradientFor(a.username) }}
                className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[8px] font-extrabold">
                {a.username.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '??'}
              </span>
              {a.username}
            </button>
          ))}
          <span className="text-[10.5px] text-[#9ca3af] w-full mt-1">
            Creator dari roster ditambahkan lewat tombol Compare di tab Directory.
          </span>
        </div>
      </div>

      {selected.length < 2 ? (
        <EmptyState icon="compare" title="Pilih minimal 2 creator"
          body="Tambahkan akun lewat chip di atas, atau tekan Compare pada creator di tab Directory." />
      ) : view === 'grid' ? (
        <div className="overflow-x-auto pb-1">
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${selected.length}, minmax(210px, 1fr))` }}>
            {selected.map(c => (
              <div key={c.key} className="bg-white border border-[#e5e7eb] rounded-xl overflow-hidden">
                <div className="relative p-3 text-white" style={{ background: gradientFor(c.id) }}>
                  <button type="button" onClick={() => compare.toggle(c.key)} title="Hapus dari compare"
                    className="absolute top-2 right-2 w-5 h-5 rounded-md bg-white/25 hover:bg-white/40 flex items-center justify-center">
                    <span className="material-symbols-outlined text-[13px]">close</span>
                  </button>
                  <div style={PJ} className="w-9 h-9 rounded-xl bg-white/25 flex items-center justify-center text-[12px] font-extrabold">
                    {c.username.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '??'}
                  </div>
                  <div style={PJ} className="text-[12.5px] font-extrabold mt-1.5 truncate">{c.username}</div>
                  <div className="flex items-center gap-1 text-[10px] opacity-90 mt-0.5">
                    <span className="material-symbols-outlined text-[11px]">
                      {PLATFORM_ICON[c.platform ?? ''] ?? 'public'}
                    </span>
                    {c.platform ?? '—'} · {c.badge}
                  </div>
                  <div style={PJ} className="inline-flex items-center gap-1 mt-1.5 rounded-full bg-white/20 px-1.5 h-[17px] text-[8.5px] font-bold uppercase tracking-wider">
                    {c.source === 'account' ? 'Akun tracked' : 'Roster KOL'}
                  </div>
                </div>

                {GROUPS.map(g => (
                  <div key={g.title}>
                    <div style={PJ} className="px-3 pt-2 pb-1 text-[8.5px] font-bold uppercase tracking-widest text-[#b6bcc6]">
                      {g.title}
                    </div>
                    {g.rows.map(m => {
                      const v = m.get(c)
                      const isBest = v !== null && best.get(m.label) === v
                      return (
                        <div key={m.label}
                          className="flex items-center justify-between px-3 py-1.5 border-b border-[#f3f4f6] last:border-0">
                          <span className="text-[10.5px] text-[#9ca3af]">{m.label}</span>
                          <span
                            style={PJ}
                            title={v === null ? m.missing(c) : undefined}
                            className={`text-[11.5px] font-extrabold tabular-nums ${
                              v === null ? 'text-[#d1d5db] cursor-help' : isBest ? 'text-[#3d8a5f]' : 'text-[#374151]'
                            }`}
                          >
                            {m.fmt(c)}{isBest && ' ★'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                ))}

                <div style={PJ} className="px-3 pt-2 pb-1 text-[8.5px] font-bold uppercase tracking-widest text-[#b6bcc6]">
                  Profil
                </div>
                {FACTS.map(f => (
                  <div key={f.label} className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-[#f3f4f6] last:border-0">
                    <span className="text-[10.5px] text-[#9ca3af]">{f.label}</span>
                    <span style={PJ} className={`text-[11px] font-bold truncate ${f.get(c) ? 'text-[#374151]' : 'text-[#d1d5db]'}`}>
                      {f.get(c) ?? '—'}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white border border-[#e5e7eb] rounded-xl overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead>
              <tr className="border-b border-[#e5e7eb]">
                <th style={PJ} className="text-left text-[10.5px] font-bold uppercase tracking-wider text-[#9ca3af] px-3 py-2.5">
                  Creator
                </th>
                {GROUPS.flatMap(g => g.rows).map(m => (
                  <th key={m.label} style={PJ}
                    className="text-right text-[10.5px] font-bold uppercase tracking-wider text-[#9ca3af] px-3 py-2.5">
                    {m.label}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {selected.map(c => (
                <tr key={c.key} className="border-b border-[#f3f4f6] last:border-0 hover:bg-[#f9fafb]">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div style={{ ...PJ, background: gradientFor(c.username) }}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[9px] font-extrabold">
                        {c.username.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '??'}
                      </div>
                      <div className="min-w-0">
                        <span style={PJ} className="block text-[12px] font-bold text-[#111827] truncate">
                          {c.username}
                        </span>
                        <span className="block text-[9.5px] text-[#9ca3af]">
                          {c.source === 'account' ? 'Akun tracked' : 'Roster KOL'} · {c.badge}
                        </span>
                      </div>
                    </div>
                  </td>
                  {GROUPS.flatMap(g => g.rows).map(m => {
                    const v = m.get(c)
                    const isBest = v !== null && best.get(m.label) === v
                    return (
                      <td
                        key={m.label}
                        style={PJ}
                        title={v === null ? m.missing(c) : undefined}
                        className={`px-3 py-2 text-[11.5px] font-bold text-right tabular-nums ${
                          v === null ? 'text-[#d1d5db] cursor-help' : isBest ? 'text-[#3d8a5f]' : 'text-[#374151]'
                        }`}
                      >
                        {m.fmt(c)}{isBest && ' ★'}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => compare.toggle(c.key)}
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

      {selected.length >= 2 && (
        <p className="text-[10px] text-[#9ca3af] mt-3 leading-relaxed max-w-[80ch]">
          Semua angka dibaca langsung dari database — agregat post untuk akun yang di-track, dan
          data terbitan platform KOL untuk creator roster. Tidak ada nilai yang dimodelkan atau
          dicontohkan di layar ini; yang tidak terukur ditulis &quot;—&quot;.
        </p>
      )}
    </div>
  )
}
