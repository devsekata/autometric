'use client'

/**
 * Campaign Management — where an order becomes a campaign you run.
 *
 * The lifecycle here is a stored field (migration 046), not something derived
 * from payment status and the calendar. Those are different axes: an order can
 * be paid while the campaign is still being briefed, and a campaign can be
 * completed with an invoice outstanding. Deriving one from the other made both
 * unanswerable, which is the bug this screen exists to fix.
 *
 * Nothing here is inferred from the warehouse, because the warehouse has nothing
 * to say about it: autometric does not ingest per-order delivery. The stage and
 * each creator's progress are recorded by the team running the campaign, and the
 * screen is explicit that the performance figures beside them are the frozen
 * checkout estimate, not measured delivery.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/dashboard/ui'
import { Btn, DiscoverHeader, EmptyState, ErrorState, PJ, Spinner, TabStrip, fmtDate, fmtNum } from './ui'
import type { OrderDetail, OrderItem, OrderSummary } from '@/lib/discover/orders'

const idr = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID')

/* ── lifecycle ────────────────────────────────────────────────────────────── */

const STAGES = [
  { id: 'draft',          label: 'Draft',          icon: 'edit_note',        bg: '#f3f4f6', fg: '#6b7280' },
  { id: 'planning',       label: 'Planning',       icon: 'event_note',       bg: '#f0f7fa', fg: '#285D6E' },
  { id: 'briefed',        label: 'Briefed',        icon: 'assignment_turned_in', bg: '#f3f0fb', fg: '#6b5bb5' },
  { id: 'in_progress',    label: 'In Progress',    icon: 'pending_actions',  bg: '#fdf3e7', fg: '#b5761f' },
  { id: 'content_review', label: 'Content Review', icon: 'rate_review',      bg: '#fdf3e7', fg: '#b5761f' },
  { id: 'published',      label: 'Published',      icon: 'publish',          bg: '#eaf5ef', fg: '#3d8a5f' },
  { id: 'monitoring',     label: 'Monitoring',     icon: 'monitoring',       bg: '#eaf5ef', fg: '#3d8a5f' },
  { id: 'completed',      label: 'Completed',      icon: 'task_alt',         bg: '#eef2f5', fg: '#4b5563' },
] as const

type StageId = (typeof STAGES)[number]['id']

const STAGE_BY_ID = Object.fromEntries(STAGES.map(s => [s.id, s])) as Record<StageId, (typeof STAGES)[number]>

const stageOf = (o: OrderSummary): StageId =>
  (STAGES.some(s => s.id === o.campaign.campaignStatus)
    ? o.campaign.campaignStatus : 'draft') as StageId

/** Where each deliverable is in production. */
const PROGRESS = [
  { id: 'pending',     label: 'Belum mulai',  icon: 'schedule' },
  { id: 'briefed',     label: 'Briefed',      icon: 'assignment' },
  { id: 'in_progress', label: 'Produksi',     icon: 'pending_actions' },
  { id: 'review',      label: 'Review',       icon: 'rate_review' },
  { id: 'published',   label: 'Published',    icon: 'check_circle' },
] as const

const TABS = [
  { id: 'planning' as const, label: 'Perencanaan', icon: 'event_note' },
  { id: 'running' as const, label: 'Berjalan', icon: 'play_circle' },
  { id: 'done' as const, label: 'Selesai', icon: 'task_alt' },
]

const IN_TAB: Record<(typeof TABS)[number]['id'], StageId[]> = {
  planning: ['draft', 'planning', 'briefed'],
  running: ['in_progress', 'content_review', 'published', 'monitoring'],
  done: ['completed'],
}

export default function CampaignsWorkspace({
  orgId, orgSlug,
}: {
  orgId: string
  orgSlug: string
}) {
  const router = useRouter()
  /** No campaigns yet means "go order one" — back into the KOL workspace. */
  const onGoToPlanning = useCallback(
    () => router.push(`/organizations/${orgSlug}/discover/kol?tab=ordering`),
    [router, orgSlug])

  const [orders, setOrders] = useState<OrderSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('running')
  const [openId, setOpenId] = useState<number | null>(null)

  const load = useCallback(() => {
    fetch(`/api/organizations/${orgId}/discover/orders`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { orders: OrderSummary[] }) => setOrders(d.orders))
      .catch(e => setError(String(e.message ?? e)))
  }, [orgId])

  useEffect(() => { load() }, [load])

  const counts = useMemo(() => {
    const out = { planning: 0, running: 0, done: 0 }
    for (const o of orders ?? []) {
      const s = stageOf(o)
      for (const t of TABS) if (IN_TAB[t.id].includes(s)) out[t.id]++
    }
    return out
  }, [orders])

  /** Portfolio roll-up across everything currently running. */
  const totals = useMemo(() => {
    const live = (orders ?? []).filter(o => IN_TAB.running.includes(stageOf(o)))
    return {
      count: live.length,
      spend: live.reduce((n, o) => n + o.total, 0),
      reach: live.reduce((n, o) => n + (o.campaign.estReach ?? 0), 0),
      emv: live.reduce((n, o) => n + (o.campaign.estEmv ?? 0), 0),
    }
  }, [orders])

  const setStage = async (orderId: number, stage: StageId) => {
    setError(null)
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/orders/${orderId}/campaign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignStatus: stage }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`)
      load()
    } catch (e) {
      setError(String((e as Error).message ?? e))
    }
  }

  if (error && !orders) return <Shell><ErrorState message={error} /></Shell>
  if (!orders) return <Shell><Spinner /></Shell>

  if (orders.length === 0) {
    return (
      <Shell>
        <EmptyState
          icon="campaign"
          title="Belum ada campaign"
          body="Campaign lahir dari order: pilih KOL di KOL Intelligence, masukkan paketnya ke Cart, lalu jalankan Ordering Flow."
          action={<Btn variant="primary" onClick={onGoToPlanning}>
            <span className="material-symbols-outlined text-[15px]">add</span>Mulai Ordering Flow
          </Btn>}
        />
      </Shell>
    )
  }

  const rows = orders.filter(o => IN_TAB[tab].includes(stageOf(o)))

  return (
    <Shell>
      {error && (
        <div className="flex items-start gap-2 bg-[#fcefec] border border-[#f0c8bf] rounded-xl px-3.5 py-2.5 mb-3.5">
          <span className="material-symbols-outlined text-[16px] text-[#c2553f] mt-0.5">error</span>
          <p className="text-[11.5px] text-[#c2553f]">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-4">
        <Roll label="Campaign berjalan" value={String(totals.count)} icon="play_circle" />
        <Roll label="Total spend" value={idr(totals.spend)} icon="payments" />
        <Roll label="Est. reach" value={fmtNum(totals.reach)} sub="Proyeksi checkout" icon="visibility" />
        <Roll label="Est. EMV" value={idr(totals.emv)} sub="Proyeksi checkout" icon="savings" />
      </div>

      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <TabStrip
          tabs={TABS.map(t => ({ id: t.id, label: `${t.label} (${counts[t.id]})`, icon: t.icon }))}
          value={tab}
          onChange={setTab}
        />
        <Btn size="sm" variant="secondary" onClick={onGoToPlanning}>
          <span className="material-symbols-outlined text-[14px]">add</span>Campaign baru
        </Btn>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="filter_list_off" title="Tidak ada campaign di tab ini"
          body="Coba tab lain, atau mulai order baru dari Ordering Flow." />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map(o => (
            <CampaignRow
              key={o.id}
              order={o}
              orgId={orgId}
              orgSlug={orgSlug}
              open={openId === o.id}
              onToggleOpen={() => setOpenId(openId === o.id ? null : o.id)}
              onSetStage={stage => setStage(o.id, stage)}
            />
          ))}
        </div>
      )}
    </Shell>
  )
}

/** Page chrome. Campaign Management is its own route now, so it owns its header. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-5 max-w-[1500px] mx-auto">
      <DiscoverHeader
        title="Campaign Management"
        subtitle="Campaign yang sudah dipesan: status dari Draft sampai Completed, progres tiap creator dan performanya."
      />
      {children}
    </div>
  )
}

function Roll({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: string }) {
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

function CampaignRow({
  order: o, orgId, orgSlug, open, onToggleOpen, onSetStage,
}: {
  order: OrderSummary
  orgId: string
  orgSlug: string
  open: boolean
  onToggleOpen: () => void
  onSetStage: (s: StageId) => void
}) {
  const stage = stageOf(o)
  const s = STAGE_BY_ID[stage]
  const c = o.campaign
  const base = `/organizations/${orgSlug}/discover/kol`
  const stageIndex = STAGES.findIndex(x => x.id === stage)
  const next = STAGES[stageIndex + 1]

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ ...PJ, background: s.bg, color: s.fg }}
              className="inline-flex items-center gap-1 rounded-md text-[9.5px] font-extrabold uppercase tracking-wide px-1.5 py-0.5">
              <span className="material-symbols-outlined text-[12px]">{s.icon}</span>{s.label}
            </span>
            <span style={PJ} className="text-[14px] font-extrabold text-[#111827] truncate">{o.name}</span>
            {c.objective && (
              <span className="text-[10.5px] text-[#6b7280] bg-[#f9fafb] border border-[#e5e7eb] rounded px-1.5 py-0.5">
                {c.objective}
              </span>
            )}
            <span className="text-[10.5px] text-[#9ca3af]">#{o.id}</span>
          </div>
          <div className="text-[11px] text-[#9ca3af] mt-1">
            {c.startDate && c.endDate
              ? `${fmtDate(c.startDate)} – ${fmtDate(c.endDate)}`
              : 'Jadwal belum ditentukan'}
            {' · '}{o.accountCount} creator · {o.itemCount} deliverable
            {o.kols.length > 0 && <> · {o.kols.slice(0, 3).join(', ')}{o.kols.length > 3 ? ` +${o.kols.length - 3}` : ''}</>}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
          {next && (
            <Btn size="sm" variant="secondary" onClick={() => onSetStage(next.id)}>
              <span className="material-symbols-outlined text-[14px]">{next.icon}</span>
              Tandai {next.label}
            </Btn>
          )}
          <Link href={`${base}/orders/${o.id}`}>
            <Btn size="sm" variant="ghost">
              <span className="material-symbols-outlined text-[14px]">receipt_long</span>Order
            </Btn>
          </Link>
          <Link href={`${base}/campaigns/${o.id}`}>
            <Btn size="sm" variant="primary">
              <span className="material-symbols-outlined text-[14px]">monitoring</span>Dashboard
            </Btn>
          </Link>
        </div>
      </div>

      {/* Lifecycle rail — the whole journey, with where this one sits on it. */}
      <div className="flex items-center gap-1 mt-3 flex-wrap">
        {STAGES.map((x, i) => {
          const passed = i <= stageIndex
          return (
            <button key={x.id} type="button" onClick={() => onSetStage(x.id)}
              title={`Pindahkan ke ${x.label}`} style={PJ}
              className={`inline-flex items-center gap-1 h-6 px-2 rounded-full text-[9.5px] font-bold transition-colors ${
                i === stageIndex
                  ? 'bg-[#327488] text-white'
                  : passed ? 'bg-[#f0f7fa] text-[#285D6E] hover:bg-[#e2eff4]'
                  : 'bg-white border border-[#e5e7eb] text-[#b6bcc4] hover:text-[#374151] hover:border-[#A7C8D4]'
              }`}>
              {x.label}
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-3 pt-3 border-t border-[#f3f4f6]">
        <Metric label="Budget" value={c.budget != null ? idr(c.budget) : '—'} />
        <Metric label="Dibayar" value={idr(o.total)} />
        <Metric label="Est. reach" value={c.estReach != null ? fmtNum(c.estReach) : '—'}
          goal={c.goalReach != null ? fmtNum(c.goalReach) : undefined} />
        <Metric label="Est. engagement" value={c.estEngagement != null ? fmtNum(c.estEngagement) : '—'}
          goal={c.goalEngagement != null ? fmtNum(c.goalEngagement) : undefined} />
        <Metric label="Predicted success" value={c.successRate != null ? `${c.successRate}%` : '—'} />
      </div>

      <button type="button" onClick={onToggleOpen} style={PJ}
        className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-[#285D6E] hover:underline">
        <span className={`material-symbols-outlined text-[15px] transition-transform ${open ? 'rotate-90' : ''}`}>
          chevron_right
        </span>
        Progress per creator
      </button>

      {open && <CreatorProgress orgId={orgId} orderId={o.id} />}
    </Card>
  )
}

/**
 * Per-creator deliverable progress, loaded on expand.
 *
 * Fetched lazily rather than with the list: the orders list is a summary, and
 * pulling every order's line items to render a collapsed row would be a query
 * per campaign for something nobody is looking at yet.
 */
function CreatorProgress({ orgId, orderId }: { orgId: string; orderId: number }) {
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/organizations/${orgId}/discover/orders/${orderId}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: OrderDetail) => { if (!cancelled) setDetail(d) })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })
    return () => { cancelled = true }
  }, [orgId, orderId])

  const setProgress = async (item: OrderItem, progressStatus: string) => {
    setBusy(item.id); setError(null)
    try {
      const res = await fetch(
        `/api/organizations/${orgId}/discover/orders/${orderId}/items/${item.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ progressStatus }),
        },
      )
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      setDetail(body as OrderDetail)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy(null)
    }
  }

  if (error) return <p className="text-[11.5px] text-[#c2553f] mt-2">{error}</p>
  if (!detail) return <div className="mt-2"><Spinner /></div>

  const done = detail.items.filter(i => i.progressStatus === 'published').length

  return (
    <div className="mt-2 rounded-xl border border-[#e5e7eb] overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[#f9fafb] border-b border-[#e5e7eb] flex-wrap">
        <span style={PJ} className="text-[11px] font-bold text-[#374151]">
          {done} dari {detail.items.length} deliverable published
        </span>
        <span className="text-[10px] text-[#9ca3af]">
          Status diisi manual — Autometric tidak menerima laporan delivery per order.
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px]">
          <tbody>
            {detail.items.map(i => (
              <tr key={i.id} className="border-b border-[#f3f4f6] last:border-0">
                <td className="px-3 py-2">
                  <div style={PJ} className="text-[11.5px] font-bold text-[#111827] truncate max-w-[150px]">
                    {i.accountUsername}
                  </div>
                  <div className="text-[10px] text-[#9ca3af]">
                    {i.deliverableLabel} × {i.qty}
                    {i.target?.objective && <> · target {i.target.objective}</>}
                  </div>
                </td>
                <td className="px-3 py-2 text-[10.5px] text-[#9ca3af] whitespace-nowrap">
                  {i.target?.reach ? `Target ${fmtNum(i.target.reach)} reach` : '—'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1 flex-wrap">
                    {PROGRESS.map(p => (
                      <button key={p.id} type="button" disabled={busy === i.id}
                        onClick={() => setProgress(i, p.id)} style={PJ}
                        className={`inline-flex items-center gap-1 h-6 px-2 rounded-full text-[9.5px] font-bold transition-colors ${
                          i.progressStatus === p.id
                            ? 'bg-[#327488] text-white'
                            : 'bg-white border border-[#e5e7eb] text-[#9ca3af] hover:text-[#374151] hover:border-[#A7C8D4]'
                        } ${busy === i.id ? 'opacity-50' : ''}`}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  {i.publishedUrl ? (
                    <a href={i.publishedUrl} target="_blank" rel="noopener noreferrer"
                      className="text-[10.5px] text-[#285D6E] hover:underline">Lihat konten</a>
                  ) : (
                    <span className="text-[10.5px] text-[#d1d5db]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Metric({ label, value, goal }: { label: string; value: string; goal?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[9.5px] font-bold uppercase tracking-widest text-[#9ca3af]">{label}</div>
      <div style={PJ} className="text-[13px] font-extrabold text-[#111827] tabular-nums truncate">{value}</div>
      {goal && <div className="text-[10px] text-[#9ca3af] truncate">Target {goal}</div>}
    </div>
  )
}
