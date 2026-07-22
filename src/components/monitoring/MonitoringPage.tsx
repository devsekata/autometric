'use client'

import { useState, useTransition } from 'react'
import type { PlatformSyncRow } from '@/lib/monitoring/queries'

const PJB = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

// ─── Helpers ──────────────────────────────────────────────────────────────────

type SyncStatus = 'synced' | 'never'

function getSyncStatus(lastSync: string | null): SyncStatus {
  return lastSync ? 'synced' : 'never'
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 6e4)
  const hours = Math.floor(diff / 36e5)
  const days  = Math.floor(diff / 864e5)
  if (mins < 1)    return 'just now'
  if (mins < 60)   return `${mins}m ago`
  if (hours < 24)  return `${hours}h ago`
  if (days === 1)  return 'yesterday'
  return `${days}d ago`
}

const STATUS_CONFIG: Record<SyncStatus, { label: string; dot: string; bg: string; text: string }> = {
  synced: { label: 'Synced',     dot: '#22c55e', bg: '#f0fdf4', text: '#166534' },
  never:  { label: 'Not synced', dot: '#94a3b8', bg: '#f8fafc', text: '#475569' },
}

const PLATFORM_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  instagram: { label: 'Instagram', icon: '/instagram.png', color: '#E1306C' },
  tiktok:    { label: 'TikTok',    icon: '/tiktok.png',    color: '#010101' },
  facebook:  { label: 'Facebook',  icon: '/facebook.png',  color: '#1877F2' },
}

const DATA_LABEL: Record<string, string> = {
  instagram: 'posts',
  tiktok:    'videos',
  facebook:  'posts',
}

// ─── Status Chip ──────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: SyncStatus }) {
  const c = STATUS_CONFIG[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-semibold"
      style={{ background: c.bg, color: c.text, ...PJB }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c.dot }} />
      {c.label}
    </span>
  )
}

// ─── Platform Icon ────────────────────────────────────────────────────────────

function PlatformIcon({ platform }: { platform: string }) {
  const cfg = PLATFORM_CONFIG[platform]
  if (!cfg) return (
    <span className="material-symbols-outlined text-[20px] text-[#94a3b8]">link</span>
  )
  return (
    <img
      src={cfg.icon}
      alt={cfg.label}
      width={20} height={20}
      className="flex-shrink-0 object-contain"
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
    />
  )
}

// ─── Sync Button ──────────────────────────────────────────────────────────────

function SyncButton({
  brandId, platform, orgSlug,
  onDone,
}: {
  brandId: string; platform: string; orgSlug: string
  onDone: (brandId: string, platform: string, newTs: string) => void
}) {
  const [isPending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function trigger() {
    setErr(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/brands/${brandId}/${platform}/initial-sync`, { method: 'POST' })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          setErr(j.error ?? 'Sync failed')
          return
        }
        onDone(brandId, platform, new Date().toISOString())
      } catch {
        setErr('Network error')
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={trigger}
        disabled={isPending}
        style={PJB}
        className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#e2e8f0] bg-white text-[12.5px] font-semibold text-[#334155] hover:bg-[#f8fafc] hover:border-[#cbd5e1] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className={`material-symbols-outlined text-[14px] text-[#1B8A80] ${isPending ? 'animate-spin' : ''}`}>
          {isPending ? 'progress_activity' : 'sync'}
        </span>
        {isPending ? 'Syncing…' : 'Sync now'}
      </button>
      {err && (
        <span className="text-[11px] text-[#ef4444]" style={PJB}>{err}</span>
      )}
    </div>
  )
}

// ─── Brand Card ───────────────────────────────────────────────────────────────

type BrandGroup = {
  brandId:   string
  brandName: string
  rows:      PlatformSyncRow[]
}

function BrandCard({
  group, orgSlug, onSynced,
}: {
  group: BrandGroup; orgSlug: string
  onSynced: (brandId: string, platform: string, ts: string) => void
}) {
  return (
    <div className="bg-white border border-[#e2e8f0] rounded-2xl overflow-hidden">
      {/* Brand header */}
      <div className="px-5 py-3.5 border-b border-[#f1f5f9] bg-[#fafbfc]">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px] text-[#94a3b8]">store</span>
          <span className="text-[14px] font-bold text-[#0f172a]" style={PJB}>{group.brandName}</span>
          <span className="text-[12px] text-[#94a3b8] ml-1" style={PJB}>
            {group.rows.length} platform{group.rows.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Platform rows */}
      <div className="divide-y divide-[#f1f5f9]">
        {group.rows.map(row => {
          const status  = getSyncStatus(row.lastProfileSync)
          const platCfg = PLATFORM_CONFIG[row.platform]

          return (
            <div key={row.platform} className="flex items-center gap-4 px-5 py-4">
              {/* Platform */}
              <div className="flex items-center gap-2.5 w-[130px] flex-shrink-0">
                <PlatformIcon platform={row.platform} />
                <div>
                  <p className="text-[13px] font-semibold text-[#0f172a]" style={PJB}>
                    {platCfg?.label ?? row.platform}
                  </p>
                  <p className="text-[11.5px] text-[#94a3b8]" style={PJB}>@{row.username}</p>
                </div>
              </div>

              {/* Status */}
              <div className="w-[110px] flex-shrink-0">
                <StatusChip status={status} />
              </div>

              {/* Last sync */}
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-[#64748b]" style={PJB}>Last sync</p>
                <p className="text-[13px] font-semibold text-[#334155]" style={PJB}>
                  {formatRelative(row.lastProfileSync)}
                </p>
                {row.lastProfileSync && (
                  <p className="text-[11px] text-[#94a3b8] mt-0.5" style={PJB}>
                    {new Date(row.lastProfileSync).toLocaleString('id-ID', {
                      day: '2-digit', month: 'short', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                      timeZone: 'Asia/Jakarta',
                    })} WIB
                  </p>
                )}
              </div>

              {/* Data count */}
              <div className="w-[90px] flex-shrink-0 text-center">
                <p className="text-[22px] font-bold text-[#0f172a] leading-none" style={PJB}>{row.dataCount}</p>
                <p className="text-[11.5px] text-[#94a3b8] mt-0.5" style={PJB}>{DATA_LABEL[row.platform] ?? 'items'}</p>
              </div>

              {/* Action */}
              <div className="flex-shrink-0">
                <SyncButton
                  brandId={row.brandId}
                  platform={row.platform}
                  orgSlug={orgSlug}
                  onDone={onSynced}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Summary Stats ────────────────────────────────────────────────────────────

function SummaryStats({ rows }: { rows: PlatformSyncRow[] }) {
  const total   = rows.length
  const synced  = rows.filter(r => getSyncStatus(r.lastProfileSync) === 'synced').length
  const problem = rows.filter(r => getSyncStatus(r.lastProfileSync) === 'never').length

  const stats = [
    { label: 'Total accounts', value: total,   color: '#0f172a' },
    { label: 'Synced',         value: synced,  color: '#166534' },
    { label: 'Not synced',     value: problem, color: '#991b1b' },
  ]

  return (
    <div className="grid grid-cols-3 gap-4 mb-8">
      {stats.map(s => (
        <div key={s.label} className="bg-white border border-[#e2e8f0] rounded-2xl px-5 py-4">
          <p className="text-[28px] font-bold leading-none" style={{ color: s.color, ...PJB }}>{s.value}</p>
          <p className="text-[12.5px] text-[#64748b] mt-1.5" style={PJB}>{s.label}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

interface Props {
  orgSlug: string
  data:    PlatformSyncRow[]
}

export default function MonitoringPage({ orgSlug, data: initialData }: Props) {
  const [rows, setRows] = useState<PlatformSyncRow[]>(initialData)

  function handleSynced(brandId: string, platform: string, ts: string) {
    setRows(prev => prev.map(r =>
      r.brandId === brandId && r.platform === platform
        ? { ...r, lastProfileSync: ts }
        : r
    ))
  }

  // Group by brand
  const groups: BrandGroup[] = []
  const seen = new Map<string, BrandGroup>()
  for (const row of rows) {
    let g = seen.get(row.brandId)
    if (!g) {
      g = { brandId: row.brandId, brandName: row.brandName, rows: [] }
      groups.push(g)
      seen.set(row.brandId, g)
    }
    g.rows.push(row)
  }

  const isEmpty = rows.length === 0

  return (
    <div className="flex flex-col min-h-full bg-white">
      {/* Header */}
      <div className="px-10 pt-7 pb-5 border-b-2 border-[#e2e8f0]">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[12.5px] text-[#94a3b8] mb-1.5 tracking-wide" style={PJB}>Admin only</p>
            <h1 style={PJB} className="text-[36px] font-bold text-[#0f172a] tracking-[-0.04em] leading-none">
              Monitoring
            </h1>
            <p className="text-[13.5px] text-[#94a3b8] mt-2" style={PJB}>
              Data sync status for all connected accounts
            </p>
          </div>

          <div className="flex items-center gap-2 mt-2">
            <span className="material-symbols-outlined text-[15px] text-[#94a3b8]">lock</span>
            <span className="text-[12.5px] text-[#94a3b8] font-medium" style={PJB}>Visible to admins only</span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 px-10 pt-7 pb-10">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <span className="material-symbols-outlined text-[48px] text-[#e2e8f0] mb-4">monitor_heart</span>
            <p style={PJB} className="text-[15px] font-semibold text-[#334155]">No connected accounts</p>
            <p className="text-[13px] text-[#94a3b8] mt-1.5 max-w-xs">
              Connect social accounts to your brands to start monitoring sync status.
            </p>
          </div>
        ) : (
          <>
            <SummaryStats rows={rows} />

            <div className="flex flex-col gap-4">
              {groups.map(group => (
                <BrandCard
                  key={group.brandId}
                  group={group}
                  orgSlug={orgSlug}
                  onSynced={handleSynced}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
