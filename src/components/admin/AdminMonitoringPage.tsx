'use client'

import { useState } from 'react'
import type { PlatformSyncRow, SchedulerLogRow, CategorySyncRow } from '@/lib/monitoring/queries'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

// ─── Types ────────────────────────────────────────────────────────────────────

type SyncStatus = 'success' | 'failed' | 'never'
type JobStatus  = 'running' | 'success' | 'failed' | 'skipped'

type RunBatch = {
  date:         string   // 'YYYY-MM-DD' WIB
  logs:         SchedulerLogRow[]
  successCount: number
  failedCount:  number
  skippedCount: number
  totalRecords: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSyncStatus(lastStatus: string | null): SyncStatus {
  if (lastStatus === 'success') return 'success'
  if (lastStatus === 'failed')  return 'failed'
  return 'never'
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const diff  = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 6e4)
  const hours = Math.floor(diff / 36e5)
  const days  = Math.floor(diff / 864e5)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000)  return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

function formatWIB(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
  }) + ' WIB'
}

function toWIBDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
}

function formatDateLabel(dateStr: string): string {
  const today     = toWIBDate(new Date().toISOString())
  const yesterday = toWIBDate(new Date(Date.now() - 864e5).toISOString())
  if (dateStr === today)     return 'Today'
  if (dateStr === yesterday) return 'Yesterday'
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

// ─── Config ───────────────────────────────────────────────────────────────────

const SYNC_CFG: Record<SyncStatus, { label: string; dot: string; bg: string; text: string }> = {
  success: { label: 'Success', dot: '#22c55e', bg: '#f0fdf4', text: '#166534' },
  failed:  { label: 'Failed',  dot: '#ef4444', bg: '#fef2f2', text: '#991b1b' },
  never:   { label: 'No data', dot: '#94a3b8', bg: '#f8fafc', text: '#475569' },
}

const JOB_CFG: Record<JobStatus, { label: string; dot: string; bg: string; text: string }> = {
  success: { label: 'Success', dot: '#22c55e', bg: '#f0fdf4', text: '#166534' },
  running: { label: 'Running', dot: '#3b82f6', bg: '#eff6ff', text: '#1e40af' },
  failed:  { label: 'Failed',  dot: '#ef4444', bg: '#fef2f2', text: '#991b1b' },
  skipped: { label: 'Skipped', dot: '#94a3b8', bg: '#f8fafc', text: '#475569' },
}

const PLATFORM_CFG: Record<string, { label: string; icon: string }> = {
  instagram: { label: 'Instagram', icon: '/instagram.png' },
  tiktok:    { label: 'TikTok',    icon: '/tiktok.png' },
  facebook:  { label: 'Facebook',  icon: '/facebook.png' },
}

const CATEGORY_ORDER = [
  'ig_profile', 'ig_posts', 'ig_stories', 'ig_tagged', 'ig_comments',
  'tt_profile', 'tt_videos',
  'fb_profile', 'fb_posts',
] as const

const CATEGORY_CFG: Record<string, { label: string; unit: string; platform: string; icon: string }> = {
  ig_profile:  { label: 'IG Profile',   unit: 'snapshots', platform: 'instagram', icon: 'person'      },
  ig_posts:    { label: 'IG Posts',     unit: 'posts',     platform: 'instagram', icon: 'grid_on'     },
  ig_stories:  { label: 'IG Stories',   unit: 'stories',   platform: 'instagram', icon: 'circle'      },
  ig_tagged:   { label: 'IG Tagged',    unit: 'tagged',    platform: 'instagram', icon: 'sell'        },
  ig_comments: { label: 'IG Comments',  unit: 'comments',  platform: 'instagram', icon: 'comment'     },
  tt_profile:  { label: 'TT Profile',   unit: 'snapshots', platform: 'tiktok',    icon: 'person'      },
  tt_videos:   { label: 'TT Videos',    unit: 'videos',    platform: 'tiktok',    icon: 'play_circle' },
  fb_profile:  { label: 'FB Profile',   unit: 'snapshots', platform: 'facebook',  icon: 'person'      },
  fb_posts:    { label: 'FB Posts',     unit: 'posts',     platform: 'facebook',  icon: 'article'     },
}

const PLATFORM_CATEGORIES: Record<string, string[]> = {
  instagram: ['ig_profile', 'ig_posts', 'ig_stories', 'ig_tagged', 'ig_comments'],
  tiktok:    ['tt_profile', 'tt_videos'],
  facebook:  ['fb_profile', 'fb_posts'],
}

// ─── Chips ────────────────────────────────────────────────────────────────────

function SyncChip({ status }: { status: SyncStatus }) {
  const c = SYNC_CFG[status]
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-semibold whitespace-nowrap"
      style={{ background: c.bg, color: c.text, ...PJB }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c.dot }} />
      {c.label}
    </span>
  )
}

function JobChip({ status }: { status: JobStatus }) {
  const c = JOB_CFG[status]
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-semibold whitespace-nowrap"
      style={{ background: c.bg, color: c.text, ...PJB }}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${status === 'running' ? 'animate-pulse' : ''}`}
        style={{ background: c.dot }} />
      {c.label}
    </span>
  )
}

// ─── Platform Icon ─────────────────────────────────────────────────────────────

function PlatformIcon({ platform, size = 18 }: { platform: string; size?: number }) {
  const cfg = PLATFORM_CFG[platform]
  if (!cfg) return <span className="material-symbols-outlined text-[18px] text-[#94a3b8]">link</span>
  return (
    <img src={cfg.icon} alt={cfg.label} width={size} height={size}
      className="flex-shrink-0 object-contain"
      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
  )
}

// ─── Scheduler Sidebar ────────────────────────────────────────────────────────

// ─── Summary Stats ─────────────────────────────────────────────────────────────

function SummaryStats({ rows }: { rows: PlatformSyncRow[] }) {
  const brands   = new Set(rows.map(r => r.brandId)).size
  const accounts = new Set(rows.map(r => r.socialAccountId)).size
  const ok       = rows.filter(r => r.lastProfileSync !== null).length
  const problem  = rows.filter(r => r.lastProfileSync === null).length

  return (
    <div className="grid grid-cols-4 gap-4 mb-8">
      {([
        { label: 'Brands',         value: brands,   icon: 'store',           color: '#0f172a' },
        { label: 'Accounts',       value: accounts, icon: 'manage_accounts', color: '#0f172a' },
        { label: 'Up to date',     value: ok,       icon: 'check_circle',    color: '#166534' },
        { label: 'Need attention', value: problem,  icon: problem > 0 ? 'warning' : 'verified',
          color: problem > 0 ? '#991b1b' : '#0f172a' },
      ] as const).map(s => (
        <div key={s.label} className="bg-white border border-[#e2e8f0] rounded-2xl px-5 py-4">
          <span className="material-symbols-outlined text-[18px] text-[#94a3b8] mb-2 block">{s.icon}</span>
          <p className="text-[28px] font-bold leading-none" style={{ color: s.color, ...PJB }}>{s.value}</p>
          <p className="text-[12.5px] text-[#64748b] mt-1.5" style={PJB}>{s.label}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Collapsible Card Shell ───────────────────────────────────────────────────
// Shared by RunBatchCard and CategoryStatusCard

function CollapsibleCard({
  defaultOpen, dotColor, header, children,
}: {
  defaultOpen: boolean
  dotColor:    string
  header:      React.ReactNode
  children:    React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white border border-[#e2e8f0] rounded-2xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 bg-[#fafbfc] border-b border-[#f1f5f9] hover:bg-[#f1f5f9] transition-colors text-left">
        <span className={`material-symbols-outlined text-[16px] text-[#94a3b8] transition-transform flex-shrink-0 ${open ? 'rotate-90' : ''}`}>
          chevron_right
        </span>
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dotColor }} />
        {header}
      </button>
      {open && children}
    </div>
  )
}

// ─── Run Batch Card ────────────────────────────────────────────────────────────

function RunBatchCard({ batch, defaultOpen }: { batch: RunBatch; defaultOpen: boolean }) {
  const platforms = [...new Set(batch.logs.map(l => l.platform))].filter(Boolean)
  const dotColor  = batch.failedCount > 0 ? '#ef4444' : batch.skippedCount === 0 ? '#22c55e' : '#f59e0b'

  // Unique accounts in this day batch
  const uniqueAccounts = new Set(batch.logs.map(l => l.socialAccountId ?? l.username)).size

  const header = (
    <>
      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] font-bold text-[#0f172a]" style={PJB}>{formatDateLabel(batch.date)}</p>
        <div className="flex items-center gap-2.5 mt-0.5">
          <div className="flex items-center gap-1">{platforms.map(p => <PlatformIcon key={p} platform={p} size={13} />)}</div>
          <span className="text-[11.5px] text-[#94a3b8]" style={PJB}>
            {uniqueAccounts} account{uniqueAccounts !== 1 ? 's' : ''}
            · {batch.logs.length} entries
          </span>
          {batch.totalRecords > 0 && (
            <span className="text-[11.5px] text-[#94a3b8]" style={PJB}>· {batch.totalRecords.toLocaleString()} records</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {batch.successCount > 0 && <span className="flex items-center gap-1 text-[12px] font-semibold text-[#166534]" style={PJB}><span className="material-symbols-outlined text-[13px]">check_circle</span>{batch.successCount}</span>}
        {batch.failedCount  > 0 && <span className="flex items-center gap-1 text-[12px] font-semibold text-[#991b1b]" style={PJB}><span className="material-symbols-outlined text-[13px]">cancel</span>{batch.failedCount}</span>}
        {batch.skippedCount > 0 && <span className="flex items-center gap-1 text-[12px] font-semibold text-[#94a3b8]" style={PJB}><span className="material-symbols-outlined text-[13px]">skip_next</span>{batch.skippedCount}</span>}
      </div>
    </>
  )

  // Group logs by socialAccountId, preserve order of first appearance
  const accountOrder: string[] = []
  const accountMap = new Map<string, { username: string; platform: string; brandName: string; logs: SchedulerLogRow[] }>()
  for (const log of batch.logs) {
    const key = log.socialAccountId ?? log.username ?? '?'
    if (!accountMap.has(key)) {
      accountMap.set(key, { username: log.username ?? '—', platform: log.platform, brandName: log.brandName ?? '—', logs: [] })
      accountOrder.push(key)
    }
    accountMap.get(key)!.logs.push(log)
  }

  return (
    <CollapsibleCard defaultOpen={defaultOpen} dotColor={dotColor} header={header}>
      <div className="divide-y divide-[#f1f5f9]">
        {accountOrder.map(key => {
          const group = accountMap.get(key)!
          return (
            <div key={key}>
              {/* Account sub-header */}
              <div className="flex items-center gap-2.5 px-5 py-2.5 bg-[#f8fafc]">
                <PlatformIcon platform={group.platform} size={15} />
                <span className="text-[13px] font-semibold text-[#334155]" style={PJB}>@{group.username}</span>
                <span className="text-[12px] text-[#94a3b8]" style={PJB}>· {group.brandName}</span>
                <span className="text-[11.5px] text-[#94a3b8] ml-auto" style={PJB}>
                  {group.logs.length} categor{group.logs.length !== 1 ? 'ies' : 'y'}
                </span>
              </div>
              {/* Category rows */}
              <table className="w-full">
                <tbody className="divide-y divide-[#f8fafc]">
                  {group.logs.map(log => {
                    const catCfg = log.category ? CATEGORY_CFG[log.category] : null
                    return (
                      <tr key={log.id} className="hover:bg-[#fafbfc] transition-colors">
                        <td className="pl-10 pr-5 py-2.5 w-[200px]">
                          {catCfg ? (
                            <div className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-[14px] text-[#94a3b8]">{catCfg.icon}</span>
                              <span className="text-[12.5px] font-medium text-[#334155]" style={PJB}>{catCfg.label}</span>
                            </div>
                          ) : (
                            <span className="text-[12.5px] text-[#94a3b8]" style={PJB}>—</span>
                          )}
                        </td>
                        <td className="px-5 py-2.5">
                          <JobChip status={log.status} />
                          {log.errorMessage && <p className="text-[11px] text-[#ef4444] mt-0.5" style={PJB}>{log.errorMessage}</p>}
                        </td>
                        <td className="px-5 py-2.5">
                          <span className="text-[13px] font-semibold text-[#0f172a]" style={PJB}>
                            {log.recordsSynced != null ? log.recordsSynced.toLocaleString() : '—'}
                          </span>
                          {catCfg && log.recordsSynced != null && (
                            <span className="text-[11.5px] text-[#94a3b8] ml-1.5" style={PJB}>{catCfg.unit}</span>
                          )}
                        </td>
                        <td className="px-5 py-2.5">
                          <span className="text-[12.5px] text-[#64748b]" style={PJB}>{formatDuration(log.durationMs)}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>
    </CollapsibleCard>
  )
}

// ─── Scheduler Section ─────────────────────────────────────────────────────────

function SchedulerSection({ logs }: { logs: SchedulerLogRow[] }) {
  // Group by WIB date (per hari)
  const batchMap = new Map<string, RunBatch>()
  for (const log of logs) {
    const date = toWIBDate(log.startedAt)
    let b = batchMap.get(date)
    if (!b) {
      b = { date, logs: [], successCount: 0, failedCount: 0, skippedCount: 0, totalRecords: 0 }
      batchMap.set(date, b)
    }
    b.logs.push(log)
    if (log.status === 'success') b.successCount++
    if (log.status === 'failed')  b.failedCount++
    if (log.status === 'skipped') b.skippedCount++
    b.totalRecords += log.recordsSynced ?? 0
  }
  const batches = [...batchMap.values()].sort((a, b) => b.date.localeCompare(a.date))

  if (batches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-white border border-[#e2e8f0] rounded-2xl">
        <span className="material-symbols-outlined text-[40px] text-[#e2e8f0] mb-3">schedule</span>
        <p className="text-[14px] font-semibold text-[#334155]" style={PJB}>No scheduler runs yet</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {batches.map((batch, i) => <RunBatchCard key={batch.date} batch={batch} defaultOpen={i === 0} />)}
    </div>
  )
}

// ─── Category Status Card ──────────────────────────────────────────────────────

function CategoryStatusCard({ categoryKey, rows, defaultOpen }: {
  categoryKey: string
  rows:        CategorySyncRow[]
  defaultOpen: boolean
}) {
  const cfg        = CATEGORY_CFG[categoryKey]
  if (!cfg) return null

  const okCount      = rows.filter(r => getSyncStatus(r.lastStatus) === 'success').length
  const problemCount = rows.filter(r => getSyncStatus(r.lastStatus) !== 'success').length
  const dotColor     = problemCount > 0 ? '#ef4444' : '#22c55e'

  const header = (
    <>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <PlatformIcon platform={cfg.platform} size={16} />
        <span className="material-symbols-outlined text-[15px] text-[#94a3b8]">{cfg.icon}</span>
        <span className="text-[13.5px] font-bold text-[#0f172a]" style={PJB}>{cfg.label}</span>
        <span className="text-[12px] text-[#94a3b8]" style={PJB}>· {rows.length} account{rows.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {okCount      > 0 && <span className="flex items-center gap-1 text-[12px] font-semibold text-[#166534]" style={PJB}><span className="material-symbols-outlined text-[13px]">check_circle</span>{okCount}</span>}
        {problemCount > 0 && <span className="flex items-center gap-1 text-[12px] font-semibold text-[#991b1b]" style={PJB}><span className="material-symbols-outlined text-[13px]">warning</span>{problemCount}</span>}
      </div>
    </>
  )

  return (
    <CollapsibleCard defaultOpen={defaultOpen} dotColor={dotColor} header={header}>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#f1f5f9]">
              {['Account', 'Brand', 'Status', cfg.unit.charAt(0).toUpperCase() + cfg.unit.slice(1), 'Last sync'].map(h => (
                <th key={h} className="px-5 py-2.5 text-left text-[11px] font-semibold text-[#94a3b8] uppercase tracking-wider whitespace-nowrap" style={PJB}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f8fafc]">
            {rows.map(row => {
              const status = getSyncStatus(row.lastStatus)
              return (
                <tr key={row.socialAccountId} className="hover:bg-[#fafbfc] transition-colors">
                  <td className="px-5 py-3">
                    <span className="text-[13px] font-semibold text-[#334155]" style={PJB}>@{row.username}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-[12.5px] text-[#64748b]" style={PJB}>{row.brandName ?? '—'}</span>
                  </td>
                  <td className="px-5 py-3"><SyncChip status={status} /></td>
                  <td className="px-5 py-3">
                    <span className="text-[14px] font-bold text-[#0f172a]" style={PJB}>{row.dataCount.toLocaleString()}</span>
                  </td>
                  <td className="px-5 py-3">
                    <p className="text-[12.5px] font-semibold text-[#334155]" style={PJB}>{formatRelative(row.lastSync)}</p>
                    {row.lastSync && <p className="text-[11px] text-[#94a3b8] mt-0.5" style={PJB}>{formatWIB(row.lastSync)}</p>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </CollapsibleCard>
  )
}

// ─── Account Status Section ────────────────────────────────────────────────────

function AccountStatusSection({ categories }: { categories: CategorySyncRow[] }) {
  const grouped = new Map<string, CategorySyncRow[]>()
  for (const row of categories) {
    const arr = grouped.get(row.category) ?? []
    arr.push(row)
    grouped.set(row.category, arr)
  }

  const active = CATEGORY_ORDER.filter(cat => (grouped.get(cat) ?? []).length > 0)

  if (active.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center bg-white border border-[#e2e8f0] rounded-2xl">
        <span className="material-symbols-outlined text-[48px] text-[#e2e8f0] mb-4">monitor_heart</span>
        <p style={PJB} className="text-[15px] font-semibold text-[#334155]">No connected accounts yet</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {active.map((cat, i) => (
        <CategoryStatusCard
          key={cat}
          categoryKey={cat}
          rows={grouped.get(cat) ?? []}
          defaultOpen={i === 0}
        />
      ))}
    </div>
  )
}

// ─── Per Account Section ──────────────────────────────────────────────────────

type AccountGroup = {
  socialAccountId: string
  username:        string
  platform:        string
  brandId:         string
  brandName:       string
  rows:            CategorySyncRow[]
}

function SocialAccountCard({ group }: { group: AccountGroup }) {
  const catKeys  = PLATFORM_CATEGORIES[group.platform] ?? []
  const statuses = group.rows.map(r => getSyncStatus(r.lastStatus))
  const dotColor = statuses.includes('failed')  ? '#ef4444'
    : statuses.includes('never')   ? '#94a3b8'
    : '#22c55e'

  const header = (
    <>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <PlatformIcon platform={group.platform} size={16} />
        <span className="text-[13.5px] font-bold text-[#0f172a]" style={PJB}>@{group.username}</span>
        <span className="text-[12px] text-[#94a3b8]" style={PJB}>· {group.brandName}</span>
      </div>
      <span className="text-[11.5px] text-[#94a3b8] flex-shrink-0" style={PJB}>
        {catKeys.length} categor{catKeys.length !== 1 ? 'ies' : 'y'}
      </span>
    </>
  )

  return (
    <CollapsibleCard defaultOpen={false} dotColor={dotColor} header={header}>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#f1f5f9]">
              {['Category', 'Status', 'Count', 'Last sync'].map(h => (
                <th key={h} className="px-5 py-2.5 text-left text-[11px] font-semibold text-[#94a3b8] uppercase tracking-wider whitespace-nowrap" style={PJB}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f8fafc]">
            {catKeys.map(catKey => {
              const cfg = CATEGORY_CFG[catKey]
              const row = group.rows.find(r => r.category === catKey)
              const status = getSyncStatus(row?.lastStatus ?? null)
              return (
                <tr key={catKey} className="hover:bg-[#fafbfc] transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[15px] text-[#94a3b8]">{cfg?.icon}</span>
                      <span className="text-[13px] font-medium text-[#334155]" style={PJB}>{cfg?.label ?? catKey}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3"><SyncChip status={status} /></td>
                  <td className="px-5 py-3">
                    <span className="text-[14px] font-bold text-[#0f172a]" style={PJB}>
                      {row ? row.dataCount.toLocaleString() : '—'}
                    </span>
                    {cfg && row && (
                      <span className="text-[11.5px] text-[#94a3b8] ml-1.5" style={PJB}>{cfg.unit}</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <p className="text-[12.5px] font-semibold text-[#334155]" style={PJB}>{formatRelative(row?.lastSync ?? null)}</p>
                    {row?.lastSync && (
                      <p className="text-[11px] text-[#94a3b8] mt-0.5" style={PJB}>{formatWIB(row.lastSync)}</p>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </CollapsibleCard>
  )
}

function PerAccountSection({ categories }: { categories: CategorySyncRow[] }) {
  // Group by socialAccountId
  const groupMap   = new Map<string, AccountGroup>()
  const groupOrder: string[] = []

  for (const row of categories) {
    if (!groupMap.has(row.socialAccountId)) {
      groupMap.set(row.socialAccountId, {
        socialAccountId: row.socialAccountId,
        username:  row.username,
        platform:  row.platform,
        brandId:   row.brandId,
        brandName: row.brandName ?? '',
        rows: [],
      })
      groupOrder.push(row.socialAccountId)
    }
    groupMap.get(row.socialAccountId)!.rows.push(row)
  }

  const groups = groupOrder.map(id => groupMap.get(id)!)

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center bg-white border border-[#e2e8f0] rounded-2xl">
        <span className="material-symbols-outlined text-[48px] text-[#e2e8f0] mb-4">monitor_heart</span>
        <p style={PJB} className="text-[15px] font-semibold text-[#334155]">No connected accounts yet</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map(group => (
        <SocialAccountCard key={group.socialAccountId} group={group} />
      ))}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function AdminMonitoringPage({
  data,
  logs,
  categories,
}: {
  data:       PlatformSyncRow[]
  logs:       SchedulerLogRow[]
  categories: CategorySyncRow[]
}) {
  const [activeTab, setTab] = useState<'scheduler' | 'by-category' | 'by-account'>('scheduler')

  const TABS = [
    { key: 'scheduler'   as const, label: 'Scheduler Runs', icon: 'schedule'         },
    { key: 'by-category' as const, label: 'Per Category',   icon: 'category'         },
    { key: 'by-account'  as const, label: 'Per Account',    icon: 'manage_accounts'  },
  ]

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-[30px] font-bold text-[#0f172a] tracking-[-0.03em]" style={PJB}>Monitoring</h1>
        <p className="text-[13.5px] text-[#94a3b8] mt-1" style={PJB}>
          Scheduler run history and account sync status
        </p>
      </div>

      <SummaryStats rows={data} />

      <div className="flex items-center gap-1 mb-6 p-1 bg-[#f1f5f9] rounded-xl w-fit">
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setTab(tab.key)} style={PJB}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold transition-all ${
              activeTab === tab.key ? 'bg-white text-[#0f172a] shadow-sm' : 'text-[#64748b] hover:text-[#334155]'
            }`}>
            <span className="material-symbols-outlined text-[15px]">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'scheduler'   && <SchedulerSection logs={logs} />}
      {activeTab === 'by-category' && <AccountStatusSection categories={categories} />}
      {activeTab === 'by-account'  && <PerAccountSection categories={categories} />}
    </div>
  )
}
