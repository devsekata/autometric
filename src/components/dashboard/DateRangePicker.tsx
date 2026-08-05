'use client'

import { useEffect, useRef, useState } from 'react'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

/* ───────────────────────────── date helpers ─────────────────────────────
 * Semua aritmetika tanggal dikerjakan pada string YYYY-MM-DD lewat Date UTC —
 * sama seperti sisa dashboard, yang menerima `metric_date` gold sebagai hari
 * polos tanpa zona waktu. Satu-satunya yang TIDAK boleh UTC adalah "hari ini":
 * toISOString() akan memundurkan sehari untuk pemakai UTC+7 sebelum jam 07:00.
 */
const MS_DAY = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
const parseISO = (s: string) => new Date(s + 'T00:00:00Z')
const shift = (s: string, n: number) => iso(new Date(parseISO(s).getTime() + n * MS_DAY))
const firstOfMonth = (s: string) => `${s.slice(0, 8)}01`

/** Tanggal kalender lokal pemakai. */
export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'] as const
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const

/* ───────────────────────────── selection model ───────────────────────── */

export type RangeMode =
  | 'fixed' | 'today' | 'yesterday' | 'month_to_date' | 'last_month'
  | 'last_7' | 'last_14' | 'last_28' | 'last_30' | 'last_90' | 'advanced'

export interface DateSelection {
  mode: RangeMode
  /**
   * Batas range. Untuk mode `fixed` inilah pilihan pemakai; untuk mode relatif
   * ini hasil resolve terakhir — disimpan supaya kalender punya sesuatu untuk
   * ditampilkan dan supaya localStorage tidak menyimpan range kosong.
   */
  start: string
  end: string
  /** Khusus `advanced`: offset hari ke belakang dari hari ini. */
  advFrom?: number
  advTo?: number
}

export const MODE_LABEL: Record<RangeMode, string> = {
  fixed: 'Fixed',
  today: 'Today',
  yesterday: 'Yesterday',
  month_to_date: 'This month (to date)',
  last_month: 'Last month',
  last_7: 'Last 7 days',
  last_14: 'Last 14 days',
  last_28: 'Last 28 days',
  last_30: 'Last 30 days',
  last_90: 'Last 90 days',
  advanced: 'Advanced',
}

export const RANGE_MODES = Object.keys(MODE_LABEL) as RangeMode[]
export const isRangeMode = (v: unknown): v is RangeMode =>
  typeof v === 'string' && (RANGE_MODES as string[]).includes(v)

/**
 * Ubah pilihan menjadi dua tanggal konkret.
 *
 * "Last N days" berakhir KEMARIN, bukan hari ini: hari ini selalu hari
 * separuh jalan — scraper baru menuliskannya nanti — jadi memasukkannya akan
 * menyeret rata-rata ke bawah tanpa alasan. Ini juga perilaku Looker Studio,
 * acuan yang dipakai untuk kontrol ini. "This month (to date)" tetap sampai
 * hari ini karena "to date" memang berarti begitu.
 */
export function resolveSelection(sel: DateSelection, today = todayISO()): { start: string; end: string } {
  const back = (n: number) => shift(today, -n)
  switch (sel.mode) {
    case 'today':
      return { start: today, end: today }
    case 'yesterday':
      return { start: back(1), end: back(1) }
    case 'month_to_date':
      return { start: firstOfMonth(today), end: today }
    case 'last_month': {
      const lastDayPrev = shift(firstOfMonth(today), -1)
      return { start: firstOfMonth(lastDayPrev), end: lastDayPrev }
    }
    case 'last_7': case 'last_14': case 'last_28': case 'last_30': case 'last_90': {
      const n = Number(sel.mode.slice(5))
      return { start: back(n), end: back(1) } // N hari penuh, berakhir kemarin
    }
    case 'advanced': {
      const a = Math.max(0, Math.trunc(sel.advFrom ?? 30))
      const b = Math.max(0, Math.trunc(sel.advTo ?? 1))
      return { start: back(Math.max(a, b)), end: back(Math.min(a, b)) }
    }
    case 'fixed':
    default:
      return sel.start <= sel.end
        ? { start: sel.start, end: sel.end }
        : { start: sel.end, end: sel.start }
  }
}

/** Pilihan lengkap dengan start/end yang sudah di-resolve. */
export function withResolved(sel: DateSelection, today = todayISO()): DateSelection {
  return { ...sel, ...resolveSelection(sel, today) }
}

/** Label pendek: "28 Jul 2026" untuk satu hari, "1 – 28 Jul 2026" untuk range. */
export function fmtSelection(start: string, end: string): string {
  const day = (s: string) => { const [, m, d] = s.split('-').map(Number); return `${d} ${MONTHS[m - 1]}` }
  if (start === end) return `${day(start)} ${start.slice(0, 4)}`
  const ys = start.slice(0, 4), ye = end.slice(0, 4)
  if (ys !== ye) return `${day(start)} ${ys} – ${day(end)} ${ye}`
  return start.slice(0, 7) === end.slice(0, 7)
    ? `${start.split('-')[2].replace(/^0/, '')} – ${day(end)} ${ye}`
    : `${day(start)} – ${day(end)} ${ye}`
}

/* ───────────────────────────── menu tree ─────────────────────────────── */

interface MenuEntry { label: string; mode?: RangeMode; children?: RangeMode[] }
const MENU: MenuEntry[] = [
  { label: 'Fixed', mode: 'fixed' },
  { label: 'Today', mode: 'today' },
  { label: 'Yesterday', mode: 'yesterday' },
  { label: 'This month', children: ['month_to_date', 'last_month'] },
  { label: 'Last 7 days', children: ['last_7', 'last_14', 'last_28', 'last_30', 'last_90'] },
  { label: 'Advanced', mode: 'advanced' },
]

/* ───────────────────────────── month grid ────────────────────────────── */

interface View { y: number; m: number } // m = 0-11

const viewOf = (isoDate: string): View => ({
  y: Number(isoDate.slice(0, 4)),
  m: Number(isoDate.slice(5, 7)) - 1,
})
const stepView = (v: View, n: number): View => {
  const t = v.m + n
  return { y: v.y + Math.floor(t / 12), m: ((t % 12) + 12) % 12 }
}

function monthCells(v: View): (string | null)[] {
  const lead = new Date(Date.UTC(v.y, v.m, 1)).getUTCDay()
  const days = new Date(Date.UTC(v.y, v.m + 1, 0)).getUTCDate()
  const cells: (string | null)[] = Array(lead).fill(null)
  for (let d = 1; d <= days; d++) cells.push(`${v.y}-${pad(v.m + 1)}-${pad(d)}`)
  while (cells.length % 7) cells.push(null)
  return cells
}

/* ───────────────────────────── calendar ──────────────────────────────── */

function Calendar({ label, view, onView, selected, rangeStart, rangeEnd, today, bounds, onPick }: {
  label: string
  view: View
  onView: (v: View) => void
  selected: string
  rangeStart: string
  rangeEnd: string
  today: string
  bounds: { min: string; max: string } | null
  onPick: (d: string) => void
}) {
  const [jump, setJump] = useState(false)
  const cells = monthCells(view)

  return (
    <div className="w-[236px]">
      <p style={PJ} className="text-[11px] font-bold text-[#374151] text-center mb-2">{label}</p>

      <div className="relative flex items-center justify-between mb-1.5">
        <button type="button" onClick={() => setJump(j => !j)} style={PJ}
          className="flex items-center gap-0.5 px-1.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wide text-[#374151] hover:bg-[#f3f4f6]">
          {MONTHS[view.m]} {view.y}
          <span className="material-symbols-outlined text-[15px] text-[#9ca3af]">arrow_drop_down</span>
        </button>
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={() => onView(stepView(view, -1))} title="Bulan sebelumnya"
            className="w-6 h-6 flex items-center justify-center rounded-md text-[#6b7280] hover:bg-[#f3f4f6]">
            <span className="material-symbols-outlined text-[17px]">chevron_left</span>
          </button>
          <button type="button" onClick={() => onView(stepView(view, 1))} title="Bulan berikutnya"
            className="w-6 h-6 flex items-center justify-center rounded-md text-[#6b7280] hover:bg-[#f3f4f6]">
            <span className="material-symbols-outlined text-[17px]">chevron_right</span>
          </button>
        </div>

        {jump && (
          <div className="absolute left-0 top-[calc(100%+4px)] z-10 w-[196px] bg-white border border-[#e5e7eb] rounded-lg shadow-lg shadow-black/[0.08] p-2">
            <div className="flex items-center justify-between mb-1.5">
              <button type="button" onClick={() => onView({ ...view, y: view.y - 1 })}
                className="w-6 h-6 flex items-center justify-center rounded text-[#6b7280] hover:bg-[#f3f4f6]">
                <span className="material-symbols-outlined text-[16px]">chevron_left</span>
              </button>
              <span style={PJ} className="text-[12px] font-bold text-[#111827]">{view.y}</span>
              <button type="button" onClick={() => onView({ ...view, y: view.y + 1 })}
                className="w-6 h-6 flex items-center justify-center rounded text-[#6b7280] hover:bg-[#f3f4f6]">
                <span className="material-symbols-outlined text-[16px]">chevron_right</span>
              </button>
            </div>
            <div className="grid grid-cols-4 gap-0.5">
              {MONTHS.map((m, i) => (
                <button key={m} type="button" onClick={() => { onView({ ...view, m: i }); setJump(false) }} style={PJ}
                  className={`h-6 rounded text-[11px] font-semibold transition-colors ${
                    i === view.m ? 'bg-[#2C3079] text-white' : 'text-[#374151] hover:bg-[#f3f4f6]'
                  }`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-7 mb-0.5">
        {DOW.map((d, i) => (
          <span key={i} className="h-6 flex items-center justify-center text-[10px] font-semibold text-[#9ca3af]">{d}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((d, i) => {
          if (!d) return <span key={i} className="h-7" />
          const isSel = d === selected
          const inRange = d >= rangeStart && d <= rangeEnd
          const isToday = d === today
          // Hari di luar rentang data tetap bisa diklik — memblokirnya akan
          // membuat "Today" bohong saat pipeline tertinggal sehari. Cukup
          // diredupkan supaya jelas grafiknya nanti kosong.
          const noData = !!bounds && (d < bounds.min || d > bounds.max)
          return (
            <button key={i} type="button" onClick={() => onPick(d)} style={PJ}
              title={noData ? 'Belum ada data di tanggal ini' : undefined}
              className={`h-7 flex items-center justify-center text-[11.5px] transition-colors ${
                inRange && !isSel ? 'bg-[#eef0f9]' : ''
              } ${
                isSel
                  ? 'font-bold text-white'
                  : noData ? 'text-[#cbd1d8] hover:bg-[#f3f4f6]' : 'text-[#374151] font-medium hover:bg-[#f3f4f6]'
              }`}>
              <span className={`w-7 h-7 flex items-center justify-center rounded-full ${
                isSel ? 'bg-[#2C3079]' : isToday ? 'border border-[#9ca3af]' : ''
              }`}>
                {Number(d.slice(8))}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ───────────────────────────── picker ────────────────────────────────── */

export default function DateRangePicker({ value, onChange, bounds }: {
  value: DateSelection
  onChange: (s: DateSelection) => void
  bounds?: { min: string; max: string } | null
}) {
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const [sub, setSub] = useState<string | null>(null)
  const [draft, setDraft] = useState<DateSelection>(value)
  const [viewA, setViewA] = useState<View>(() => viewOf(value.start || todayISO()))
  const [viewB, setViewB] = useState<View>(() => viewOf(value.end || todayISO()))
  const ref = useRef<HTMLDivElement>(null)
  const today = todayISO()

  // Membuka popover selalu mulai dari pilihan yang sedang aktif; menutup tanpa
  // Apply membuang draft, jadi tidak perlu dibersihkan di sini.
  function openPanel() {
    const r = resolveSelection(value, today)
    setDraft({ ...value, ...r })
    setViewA(viewOf(r.start))
    setViewB(viewOf(r.end))
    setMenu(false); setSub(null); setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const shown = resolveSelection(draft, today)
  const applied = resolveSelection(value, today)

  // Mode relatif menyimpan hasil resolve-nya di start/end, jadi kalender selalu
  // punya tanggal nyata untuk ditampilkan — dan ikut melompat ke sana.
  function setResolved(sel: DateSelection) {
    const next = withResolved(sel, today)
    setDraft(next)
    setViewA(viewOf(next.start))
    setViewB(viewOf(next.end))
    return next
  }

  function pickMode(mode: RangeMode) {
    setResolved(mode === 'advanced'
      ? { ...draft, mode, advFrom: draft.advFrom ?? 30, advTo: draft.advTo ?? 1 }
      : { ...draft, mode })
    setMenu(false); setSub(null)
  }

  // Menyentuh kalender berarti pemakai memilih tanggal sendiri, jadi mode
  // otomatis jatuh ke Fixed — sama seperti Looker.
  function pickStart(d: string) {
    setDraft(p => ({ mode: 'fixed', start: d, end: d > p.end ? d : p.end }))
  }
  function pickEnd(d: string) {
    setDraft(p => ({ mode: 'fixed', start: d < p.start ? d : p.start, end: d }))
  }

  function apply() {
    onChange(withResolved(draft, today))
    setOpen(false)
  }

  const advFrom = draft.advFrom ?? 30
  const advTo = draft.advTo ?? 1
  const tailMissing = !!bounds && shown.end > bounds.max

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => (open ? setOpen(false) : openPanel())} style={PJ}
        title={value.mode === 'fixed' ? 'Rentang tanggal' : MODE_LABEL[value.mode]}
        className="flex items-center gap-1.5 text-[12px] font-semibold text-[#374151] bg-white border border-[#e5e7eb] rounded-lg pl-2.5 pr-2 py-2 cursor-pointer hover:border-[#d1d5db] outline-none">
        <span className="material-symbols-outlined text-[16px] text-[#9ca3af]">calendar_month</span>
        {fmtSelection(applied.start, applied.end)}
        <span className="material-symbols-outlined text-[16px] text-[#9ca3af]">arrow_drop_down</span>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-[560px] bg-white border border-[#e5e7eb] rounded-xl shadow-xl shadow-black/[0.09] p-4">
          {/* header: mode + submenu */}
          <div className="flex items-start justify-between mb-3">
            <div>
              <p style={PJ} className="text-[13px] font-bold text-[#111827]">{fmtSelection(shown.start, shown.end)}</p>
              <p className="text-[11px] text-[#9ca3af] mt-0.5">
                {MODE_LABEL[draft.mode]}
                {draft.mode !== 'fixed' && ' · dihitung ulang setiap hari'}
              </p>
            </div>

            <div className="relative">
              <button type="button" onClick={() => { setMenu(m => !m); setSub(null) }} style={PJ}
                className="flex items-center justify-between gap-2 w-[176px] text-[12px] font-semibold text-[#374151] bg-white border border-[#d1d5db] rounded-lg px-3 py-2 hover:border-[#9ca3af]">
                <span className="truncate">{MODE_LABEL[draft.mode]}</span>
                <span className="material-symbols-outlined text-[16px] text-[#6b7280]">arrow_drop_down</span>
              </button>

              {menu && (
                <div className="absolute right-0 top-[calc(100%+4px)] z-50 w-[176px] bg-white border border-[#e5e7eb] rounded-lg shadow-xl shadow-black/[0.1] py-1">
                  {MENU.map(entry => {
                    const active = entry.mode
                      ? draft.mode === entry.mode
                      : !!entry.children?.includes(draft.mode)
                    return (
                      <div key={entry.label} className="relative"
                        onMouseEnter={() => setSub(entry.children ? entry.label : null)}>
                        <button type="button" style={PJ}
                          onClick={() => entry.mode ? pickMode(entry.mode) : setSub(s => s === entry.label ? null : entry.label)}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] transition-colors ${
                            active ? 'font-bold text-[#2C3079] bg-[#f2f3fa]' : 'font-medium text-[#374151] hover:bg-[#f7f8f9]'
                          }`}>
                          <span className="truncate">{entry.label}</span>
                          {entry.children && (
                            <span className="material-symbols-outlined text-[15px] text-[#9ca3af]">chevron_right</span>
                          )}
                        </button>

                        {/* Dibuka ke KIRI: dropdown mode ini menempel tepi kanan
                            popover, yang sendirinya menempel tepi kanan header —
                            submenu ke kanan akan keluar layar. */}
                        {entry.children && sub === entry.label && (
                          <div className="absolute right-full top-[-4px] mr-0.5 w-[164px] bg-white border border-[#e5e7eb] rounded-lg shadow-xl shadow-black/[0.1] py-1">
                            {entry.children.map(m => (
                              <button key={m} type="button" onClick={() => pickMode(m)} style={PJ}
                                className={`w-full px-3 py-2 text-left text-[12.5px] transition-colors ${
                                  draft.mode === m
                                    ? 'font-bold text-[#2C3079] bg-[#f2f3fa]'
                                    : 'font-medium text-[#374151] hover:bg-[#f7f8f9]'
                                }`}>
                                {MODE_LABEL[m]}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {draft.mode === 'advanced' && (
            <div className="flex items-center gap-2 flex-wrap bg-[#f7f8f9] border border-[#eceef0] rounded-lg px-3 py-2.5 mb-3">
              <span className="text-[11.5px] font-semibold text-[#6b7280]">Dari</span>
              <input type="number" min={0} value={advFrom} style={PJ}
                onChange={e => setResolved({ ...draft, advFrom: Math.max(0, Number(e.target.value) || 0) })}
                className="w-16 text-[12px] font-semibold text-[#374151] bg-white border border-[#e5e7eb] rounded-md px-2 py-1.5 outline-none focus:border-[#2C3079]" />
              <span className="text-[11.5px] text-[#6b7280]">hari lalu sampai</span>
              <input type="number" min={0} value={advTo} style={PJ}
                onChange={e => setResolved({ ...draft, advTo: Math.max(0, Number(e.target.value) || 0) })}
                className="w-16 text-[12px] font-semibold text-[#374151] bg-white border border-[#e5e7eb] rounded-md px-2 py-1.5 outline-none focus:border-[#2C3079]" />
              <span className="text-[11.5px] text-[#6b7280]">hari lalu</span>
              <span className="text-[11px] text-[#9ca3af] ml-auto">0 = hari ini</span>
            </div>
          )}

          <div className="flex justify-between gap-4">
            <Calendar label="Start Date" view={viewA} onView={setViewA}
              selected={shown.start} rangeStart={shown.start} rangeEnd={shown.end}
              today={today} bounds={bounds ?? null} onPick={pickStart} />
            <div className="w-px bg-[#eceef0]" />
            <Calendar label="End Date" view={viewB} onView={setViewB}
              selected={shown.end} rangeStart={shown.start} rangeEnd={shown.end}
              today={today} bounds={bounds ?? null} onPick={pickEnd} />
          </div>

          <div className="flex items-center justify-between gap-3 mt-3.5 pt-3 border-t border-[#f0f1f3]">
            <p className="text-[11px] text-[#9ca3af] leading-snug">
              {bounds
                ? <>Data tersedia {fmtSelection(bounds.min, bounds.max)}
                    {tailMissing && <span className="text-[#c79235]"> · sebagian rentang ini belum ada datanya</span>}</>
                : 'Brand ini belum punya data.'}
            </p>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button type="button" onClick={() => setOpen(false)} style={PJ}
                className="text-[12px] font-semibold text-[#6b7280] px-3 py-2 rounded-lg hover:bg-[#f3f4f6]">
                Batal
              </button>
              <button type="button" onClick={apply} style={PJ}
                className="text-[12px] font-bold text-white bg-[#2C3079] px-4 py-2 rounded-lg hover:bg-[#242a68]">
                Terapkan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
