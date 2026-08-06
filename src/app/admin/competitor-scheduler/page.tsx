'use client'

import { useState, useEffect } from 'react'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

type ScheduleTime = { hour: number; minute: number }
type RunState     = 'idle' | 'running' | 'done' | 'error'

function pad(n: number) { return String(n).padStart(2, '0') }
function fmtTime(t: ScheduleTime) { return `${pad(t.hour)}:${pad(t.minute)}` }

function nextRunLabel(times: ScheduleTime[], isActive: boolean): string {
  if (!isActive || times.length === 0) return 'Tidak aktif'
  const wibNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }))
  const curMin = wibNow.getHours() * 60 + wibNow.getMinutes()
  const sorted = [...times].sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute))
  const next   = sorted.find(t => t.hour * 60 + t.minute > curMin) ?? sorted[0]
  if (!next) return '—'
  const diff  = (next.hour * 60 + next.minute) > curMin
    ? (next.hour * 60 + next.minute) - curMin
    : 1440 - curMin + (next.hour * 60 + next.minute)
  const h = Math.floor(diff / 60)
  const m = diff % 60
  const label = h > 0 ? `${h}j ${m > 0 ? `${m}m` : ''}`.trim() : `${m}m`
  return `Profile berikutnya: ${fmtTime(next)} WIB · ${label} lagi`
}

const POSTS_INTERVAL_OPTIONS = [7, 14, 21, 28, 30, 60, 90]

function fmtLastSync(iso: string | null): string {
  if (!iso) return 'Belum pernah'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'Belum pernah'
  const days = Math.floor((Date.now() - then) / 86_400_000)
  const date = new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
  if (days <= 0) return `Hari ini (${date})`
  return `${days} hari lalu (${date})`
}

export default function CompetitorSchedulerSettingsPage() {
  const [times,      setTimes]      = useState<ScheduleTime[]>([{ hour: 0, minute: 5 }])
  const [postsEvery, setPostsEvery] = useState(28)
  const [lastPosts,  setLastPosts]  = useState<string | null>(null)
  const [isActive,   setIsActive]   = useState(true)
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [saved,      setSaved]      = useState(false)
  const [saveError,  setSaveError]  = useState<string | null>(null)
  const [addHour,    setAddHour]    = useState(0)
  const [addMinute,  setAddMinute]  = useState(0)
  const [adding,     setAdding]     = useState(false)
  const [runState,   setRunState]   = useState<RunState>('idle')
  const [runResult,  setRunResult]  = useState<{ success: number; failed: number; accounts: number } | null>(null)
  const [runError,   setRunError]   = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/competitor-scheduler/config')
      .then(r => r.json())
      .then(d => {
        setTimes(d.scheduleTimes ?? [{ hour: 0, minute: 5 }])
        setPostsEvery(d.postsIntervalDays ?? 28)
        setLastPosts(d.lastPostsSyncAt ?? null)
        setIsActive(d.isActive ?? true)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function openAdd() {
    const used = new Set(times.map(t => t.hour * 60 + t.minute))
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m++) {
        if (!used.has(h * 60 + m)) { setAddHour(h); setAddMinute(m); setAdding(true); return }
      }
    }
  }

  function confirmAdd() {
    if (!times.some(t => t.hour === addHour && t.minute === addMinute)) {
      setTimes(prev => [...prev, { hour: addHour, minute: addMinute }]
        .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute)))
    }
    setAdding(false)
  }

  async function save() {
    setSaving(true); setSaveError(null)
    try {
      const res = await fetch('/api/admin/competitor-scheduler/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduleTimes: times, postsIntervalDays: postsEvery, isActive }),
      })
      if (!res.ok) { setSaveError('Gagal menyimpan'); return }
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch { setSaveError('Network error') }
    finally { setSaving(false) }
  }

  async function runNow() {
    setRunState('running'); setRunResult(null); setRunError(null)
    try {
      const res  = await fetch('/api/admin/competitor-scheduler/trigger', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setRunError(data.error ?? 'Failed'); setRunState('error'); return }
      setRunResult({ success: data.success, failed: data.failed, accounts: data.accounts })
      setRunState('done')
    } catch { setRunError('Network error'); setRunState('error') }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <span className="material-symbols-outlined text-[24px] text-[#94a3b8] animate-spin">progress_activity</span>
    </div>
  )

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="mb-8">
        <h1 className="text-[28px] font-bold text-[#0f172a] tracking-[-0.03em]" style={PJB}>Competitor Scheduler</h1>
        <p className="text-[13.5px] text-[#94a3b8] mt-1" style={PJB}>Jadwal sync otomatis data competitor (WIB) — Apify</p>
      </div>

      <div className="space-y-4">

        {/* Active toggle */}
        <div className="bg-white border border-[#e2e8f0] rounded-2xl px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-[14px] font-semibold text-[#0f172a]" style={PJB}>Auto Scheduler</p>
            <p className="text-[12.5px] text-[#94a3b8] mt-0.5" style={PJB}>
              {isActive ? nextRunLabel(times, isActive) : 'Tidak aktif — tidak akan auto-run'}
            </p>
          </div>
          <button onClick={() => setIsActive(v => !v)}
            className={`relative w-12 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${isActive ? 'bg-[#22c55e]' : 'bg-[#e2e8f0]'}`}>
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${isActive ? 'translate-x-6' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {/* Profile schedule times */}
        <div className="bg-white border border-[#e2e8f0] rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#f1f5f9]">
            <p className="text-[13px] font-bold text-[#0f172a]" style={PJB}>Jadwal Profile (Harian)</p>
            <p className="text-[12px] text-[#94a3b8] mt-0.5" style={PJB}>Snapshot profile semua competitor diambil tiap hari di setiap jam berikut (WIB)</p>
          </div>
          <div className="px-5 py-4 space-y-2.5">
            {times.length === 0 && (
              <p className="text-[13px] text-[#94a3b8] py-1" style={PJB}>Belum ada jadwal.</p>
            )}
            {times.map((t, idx) => (
              <div key={idx} className="flex items-center justify-between px-4 py-3 bg-[#f8fafc] rounded-xl border border-[#e2e8f0]">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-white border border-[#e2e8f0] flex items-center justify-center flex-shrink-0">
                    <span className="material-symbols-outlined text-[15px] text-[#285D6E]">schedule</span>
                  </div>
                  <div>
                    <span className="text-[16px] font-bold text-[#0f172a]" style={PJB}>{fmtTime(t)}</span>
                    <span className="text-[11.5px] text-[#94a3b8] ml-2" style={PJB}>WIB</span>
                  </div>
                </div>
                <button onClick={() => setTimes(prev => prev.filter((_, i) => i !== idx))}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-[#94a3b8] hover:text-[#ef4444] hover:bg-[#fef2f2] transition-colors">
                  <span className="material-symbols-outlined text-[16px]">delete</span>
                </button>
              </div>
            ))}

            {adding ? (
              <div className="flex items-center gap-2 pt-1">
                <div className="flex items-center gap-1.5 flex-1 px-4 py-2.5 bg-[#f8fafc] rounded-xl border border-[#285D6E]">
                  <select value={addHour} onChange={e => setAddHour(+e.target.value)}
                    className="bg-transparent text-[15px] font-bold text-[#0f172a] focus:outline-none cursor-pointer" style={PJB}>
                    {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{pad(i)}</option>)}
                  </select>
                  <span className="text-[16px] font-bold text-[#94a3b8]">:</span>
                  <select value={addMinute} onChange={e => setAddMinute(+e.target.value)}
                    className="bg-transparent text-[15px] font-bold text-[#0f172a] focus:outline-none cursor-pointer" style={PJB}>
                    {Array.from({ length: 60 }, (_, i) => <option key={i} value={i}>{pad(i)}</option>)}
                  </select>
                  <span className="text-[11.5px] text-[#94a3b8] ml-1" style={PJB}>WIB</span>
                </div>
                <button onClick={confirmAdd} style={PJB}
                  className="h-10 px-4 rounded-xl bg-[#0f172a] text-white text-[12.5px] font-semibold hover:bg-[#1e293b] transition-colors">
                  Tambah
                </button>
                <button onClick={() => setAdding(false)}
                  className="w-10 h-10 rounded-xl border border-[#e2e8f0] flex items-center justify-center text-[#94a3b8] hover:bg-[#f8fafc] transition-colors">
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            ) : (
              <button onClick={openAdd} style={PJB}
                className="flex items-center gap-1.5 text-[13px] font-semibold text-[#285D6E] hover:text-[#2d6a80] transition-colors pt-1">
                <span className="material-symbols-outlined text-[17px]">add_circle</span>
                Tambah jadwal
              </button>
            )}
          </div>
        </div>

        {/* Posts interval */}
        <div className="bg-white border border-[#e2e8f0] rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#f1f5f9]">
            <p className="text-[13px] font-bold text-[#0f172a]" style={PJB}>Jadwal Posts (Berkala)</p>
            <p className="text-[12px] text-[#94a3b8] mt-0.5" style={PJB}>Posts 30 hari terakhir di-sync kalau sudah lewat selang waktu ini sejak sync terakhir</p>
          </div>
          <div className="px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-white border border-[#e2e8f0] flex items-center justify-center flex-shrink-0">
                <span className="material-symbols-outlined text-[15px] text-[#285D6E]">event_repeat</span>
              </div>
              <div>
                <span className="text-[14px] font-semibold text-[#0f172a]" style={PJB}>Sync posts tiap</span>
                <p className="text-[11.5px] text-[#94a3b8] mt-0.5" style={PJB}>
                  Terakhir: {fmtLastSync(lastPosts)} · ikut jam profile
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-4 py-2.5 bg-[#f8fafc] rounded-xl border border-[#e2e8f0]">
              <select value={postsEvery} onChange={e => setPostsEvery(+e.target.value)}
                className="bg-transparent text-[15px] font-bold text-[#0f172a] focus:outline-none cursor-pointer" style={PJB}>
                {POSTS_INTERVAL_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <span className="text-[11.5px] text-[#94a3b8]" style={PJB}>hari</span>
            </div>
          </div>
        </div>

        {/* Save */}
        <button onClick={save} disabled={saving} style={PJB}
          className="w-full h-11 rounded-2xl bg-[#0f172a] text-white text-[13.5px] font-semibold hover:bg-[#1e293b] transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {saved   ? <><span className="material-symbols-outlined text-[16px]">check_circle</span> Tersimpan!</>
          : saving  ? <><span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span> Menyimpan…</>
          : 'Simpan Pengaturan'}
        </button>
        {saveError && <p className="text-[12.5px] text-[#ef4444] text-center" style={PJB}>{saveError}</p>}

        {/* Divider */}
        <div className="border-t border-[#e2e8f0]" />

        {/* Manual trigger */}
        <div className="bg-white border border-[#e2e8f0] rounded-2xl px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="min-w-0 mr-4">
              <p className="text-[14px] font-semibold text-[#0f172a]" style={PJB}>Run Manual</p>
              <p className="text-[12.5px] mt-0.5" style={PJB}>
                {runState === 'running' && <span className="text-[#3b82f6]">Sedang sync profile + posts semua competitor…</span>}
                {runState === 'done' && runResult && (
                  <span className="text-[#166534]">
                    Selesai · {runResult.accounts} competitor · {runResult.success} berhasil
                    {runResult.failed > 0 && <span className="text-[#991b1b]"> · {runResult.failed} gagal</span>}
                  </span>
                )}
                {runState === 'error' && <span className="text-[#ef4444]">{runError}</span>}
                {runState === 'idle' && <span className="text-[#94a3b8]">Jalankan sync penuh (profile + posts) untuk semua competitor</span>}
              </p>
            </div>
            <button onClick={runNow} disabled={runState === 'running'} style={PJB}
              className="flex items-center gap-1.5 h-9 px-4 rounded-xl border border-[#e2e8f0] text-[12.5px] font-semibold text-[#334155] hover:bg-[#f8fafc] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0">
              <span className={`material-symbols-outlined text-[15px] ${runState === 'running' ? 'animate-spin' : ''}`}>
                {runState === 'running' ? 'progress_activity' : 'play_arrow'}
              </span>
              {runState === 'running' ? 'Running…' : 'Run Now'}
            </button>
          </div>
        </div>

        {/* Info */}
        <div className="bg-[#f8fafc] border border-[#e2e8f0] rounded-2xl px-5 py-4 space-y-3">
          <p className="text-[10.5px] font-bold text-[#94a3b8] uppercase tracking-wider" style={PJB}>Cara Kerja</p>
          <div className="space-y-2.5">
            <div className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded-full bg-[#dbeafe] flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="material-symbols-outlined text-[11px] text-[#1d4ed8]">person</span>
              </div>
              <p className="text-[12.5px] text-[#64748b]" style={PJB}>
                <span className="font-semibold text-[#334155]">Profile:</span> di-snapshot tiap hari di jam yang dikonfigurasi — untuk semua competitor (IG, Facebook, TikTok).
              </p>
            </div>
            <div className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded-full bg-[#dcfce7] flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="material-symbols-outlined text-[11px] text-[#166534]">grid_view</span>
              </div>
              <p className="text-[12.5px] text-[#64748b]" style={PJB}>
                <span className="font-semibold text-[#334155]">Posts:</span> di-sync (30 hari terakhir) begitu selang waktunya terlampaui — bukan di tanggal tetap. Run yang terlewat diambil run berikutnya, jadi tidak pernah bolong sebulan.
              </p>
            </div>
            <div className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded-full bg-[#fef9c3] flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="material-symbols-outlined text-[11px] text-[#a16207]">cloud</span>
              </div>
              <p className="text-[12.5px] text-[#64748b]" style={PJB}>
                <span className="font-semibold text-[#334155]">Production:</span> pasang crontab di VPS untuk memanggil endpoint setiap menit.
              </p>
            </div>
          </div>
          <code className="block text-[11px] text-[#64748b] bg-white border border-[#e2e8f0] rounded-xl px-3 py-2 leading-relaxed whitespace-pre">
            {'* * * * * curl -s -X POST https://domain.com/api/competitor-scheduler/run \\\n  -H "Authorization: Bearer $SCHEDULER_SECRET"'}
          </code>
        </div>

      </div>
    </div>
  )
}
