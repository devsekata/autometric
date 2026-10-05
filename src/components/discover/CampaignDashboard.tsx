'use client'

/**
 * Campaign Dashboard — where a paid campaign lands.
 *
 * The honesty problem this screen has to solve: autometric does not ingest
 * campaign delivery. Nobody reports "this sponsored post delivered X reach"
 * back against an order. So the numbers here are the checkout estimate paced
 * against the campaign window, and the screen says so in a banner rather than
 * dressing a projection as measurement. Every actual carries the Estimated
 * badge for the same reason.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardHead } from '@/components/dashboard/ui'
import { Donut, HBars } from '@/components/dashboard/charts'
import { Btn, EmptyState, ErrorState, PJ, Spinner, fmtDate, fmtNum, gradientFor } from './ui'
import { ConfidenceBadge } from './credibility'
import { SuccessGauge } from './CampaignBuilder'
import { StatusPill } from './DiscoverOrders'
import type { CampaignDashboardPayload } from '@/lib/discover/campaignStore'
import type { OrderStatus } from '@/lib/discover/orders'

const idr = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID')
/** Shown wherever a contribution has no reach reading. Never '0'. */
const NOT_MEASURED = 'Belum terukur'

/** Stands in for the success gauge when coverage was too thin to score. */
function LimitedData() {
  return (
    <div className="flex flex-col items-center justify-center py-5 text-center">
      <span className="material-symbols-outlined text-[22px] text-[#9ca3af]">query_stats</span>
      <div style={PJ} className="text-[12px] font-bold text-[#374151] mt-1">Data belum cukup</div>
      <p className="text-[10.5px] text-[#9ca3af] leading-snug mt-0.5 max-w-[210px]">
        Faktor terukur untuk KOL di campaign ini belum cukup untuk memprediksi hasil.
      </p>
    </div>
  )
}

const PALETTE = ['#285D6E', '#4E96AC', '#e0a458', '#5fa783', '#8b7fc7', '#d97a7a', '#7DB4C6']
const initials = (s: string) => s.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '??'

export default function CampaignDashboard({
  orgId, orgSlug, orderId,
}: { orgId: string; orgSlug: string; orderId: number }) {
  const [data, setData] = useState<CampaignDashboardPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/organizations/${orgId}/discover/orders/${orderId}/dashboard`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'Campaign tidak ditemukan.' : `HTTP ${r.status}`))))
      .then((d: CampaignDashboardPayload) => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })
    return () => { cancelled = true }
  }, [orgId, orderId])

  if (error) return <div className="p-5"><ErrorState message={error} /></div>
  if (!data) return <div className="p-5"><Spinner /></div>

  const { order, campaign, estimate, prediction, contributions, actuals, goals } = data

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <Link href={`/organizations/${orgSlug}/discover/kol?tab=orders`}>
        <Btn size="sm" variant="ghost">
          <span className="material-symbols-outlined text-[15px]">arrow_back</span>Kembali ke Orders
        </Btn>
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap mt-3 mb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 style={PJ} className="text-[19px] font-extrabold text-[#111827] tracking-[-0.02em]">{order.name}</h1>
            <StatusPill status={order.status as OrderStatus} />
            {campaign.objective && (
              <span style={PJ} className="rounded-md bg-[#f0f7fa] text-[#285D6E] text-[9.5px] font-extrabold uppercase px-1.5 py-0.5">
                {campaign.objective}
              </span>
            )}
          </div>
          <p className="text-[11.5px] text-[#9ca3af] mt-1">
            Campaign #{order.id} · {estimate.creators} KOL · {estimate.totalUnits} deliverable
            {campaign.startDate && campaign.endDate && ` · ${campaign.startDate} → ${campaign.endDate}`}
          </p>
        </div>
        <Link href={`/organizations/${orgSlug}/discover/kol/orders/${order.id}`}>
          <Btn variant="secondary">
            <span className="material-symbols-outlined text-[15px]">receipt_long</span>Lihat order
          </Btn>
        </Link>
      </div>

      {/* The banner is not decoration: it is the difference between a report and
          a misleading report. */}
      <div className="flex items-start gap-2 bg-[#fdf3e7] border border-[#eed9bb] rounded-xl px-3.5 py-2.5 mb-4">
        <span className="material-symbols-outlined text-[16px] text-[#b5761f] mt-0.5">info</span>
        <p className="text-[11.5px] text-[#b5761f] leading-relaxed">
          <b>Angka di bawah adalah proyeksi, bukan hasil terukur.</b> autometric belum menerima
          laporan delivery per campaign, jadi realisasi dihitung dari estimasi saat checkout
          dikalikan progres periode campaign ({data.pacingPct}% berjalan). Begitu data delivery
          tersedia, bagian ini diganti angka nyata.
        </p>
      </div>

      {data.missingProfiles.length > 0 && (
        <div className="flex items-start gap-2 bg-[#fcefec] border border-[#f0c8bf] rounded-xl px-3.5 py-2.5 mb-4">
          <span className="material-symbols-outlined text-[16px] text-[#c2553f] mt-0.5">link_off</span>
          <p className="text-[11.5px] text-[#c2553f]">
            {data.missingProfiles.length} akun sudah tidak terhubung ke organisasi ini
            ({data.missingProfiles.join(', ')}), jadi kontribusinya tidak bisa dimodelkan.
            Baris ordernya tetap utuh.
          </p>
        </div>
      )}

      <div className="grid grid-cols-4 gap-3.5 mb-4">
        <Kpi label="Reach" value={fmtNum(actuals.reach)} sub={`dari est. ${fmtNum(estimate.reach)}`} icon="visibility" projected />
        <Kpi label="Engagement" value={fmtNum(actuals.engagement)} sub={`dari est. ${fmtNum(estimate.engagement)}`} icon="favorite" projected />
        {/* EMV has no measured source — see `profile.emv`. ROI is EMV over
            cost, so it goes with it rather than being shown as 0.00×. Orders
            placed before the change keep their frozen `est_emv`. */}
        <Kpi label="EMV" value={actuals.emv === null ? NOT_MEASURED : idr(actuals.emv)}
          sub={actuals.emv === null ? 'belum ada benchmark CPM' : 'earned media value'}
          icon="paid" projected />
        <Kpi label="ROI" value={actuals.roi === null ? NOT_MEASURED : `${actuals.roi.toFixed(2)}×`}
          sub="EMV / biaya" icon="trending_up" projected />
      </div>

      <div className="grid grid-cols-4 gap-3.5 mb-4">
        <Kpi label="Total biaya" value={idr(order.total)} icon="receipt_long" />
        <Kpi label="Budget terpakai"
          value={campaign.budget ? `${Math.round(data.budgetUsedPct)}%` : '—'}
          sub={campaign.budget ? `dari ${idr(campaign.budget)}` : 'budget belum diatur'} icon="account_balance_wallet" />
        <Kpi label="Cost / reach" value={estimate.costPerReach > 0 ? idr(estimate.costPerReach) : '—'} icon="query_stats" />
        <Kpi label="Progres periode" value={`${data.pacingPct}%`} icon="schedule" />
      </div>

      <div className="grid grid-cols-3 gap-3.5">
        <Card>
          <CardHead title="Predicted success" sub="Dibekukan saat checkout" />
          <div className="px-4 pb-4">
            {/* `rate` is nullable now: `predictSuccess` returns null when too
                little is measurable to predict anything. The frozen checkout
                value still wins when present. */}
            {(campaign.successRate ?? prediction.rate) === null
              ? <LimitedData />
              : <SuccessGauge
                  rate={(campaign.successRate ?? prediction.rate) as number}
                  band={prediction.band}
                  coverage={prediction.coverage}
                  confidence={prediction.confidence}
                  bandIsMeaningful={prediction.bandIsMeaningful} />}
            <div className="flex flex-col gap-1.5 mt-3">
              {(campaign.successFactors ?? prediction.factors).map(f => (
                <div key={f.key} className="flex items-center gap-2">
                  <span className="text-[10.5px] text-[#6b7280] flex-1 truncate">{f.label}</span>
                  <div className="w-20 h-1.5 rounded-full bg-[#f3f4f6] overflow-hidden">
                    <div className="h-full rounded-full bg-[#4E96AC]" style={{ width: `${f.score}%` }} />
                  </div>
                  <b style={PJ} className="text-[10.5px] tabular-nums text-[#374151] w-6 text-right">{f.score}</b>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <CardHead title="Goal achievement" sub="Realisasi proyeksi terhadap target" />
          <div className="px-4 pb-4 flex flex-col gap-3">
            {goals.every(g => g.goal === 0) ? (
              <EmptyState icon="flag" title="Belum ada goal" body="Goal reach dan engagement belum diisi saat setup." />
            ) : goals.filter(g => g.goal > 0).map(g => (
              <div key={g.label}>
                <div className="flex items-center justify-between text-[11.5px] mb-1">
                  <span className="text-[#374151]">{g.label}</span>
                  <span style={PJ} className="tabular-nums text-[#111827]">
                    {fmtNum(g.actual)} / {fmtNum(g.goal)}
                    <b className={`ml-1.5 ${g.met ? 'text-[#3d8a5f]' : 'text-[#b5761f]'}`}>{Math.round(g.pct)}%</b>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[#f3f4f6] overflow-hidden">
                  <div className={`h-full rounded-full ${g.met ? 'bg-[#5fa783]' : 'bg-[#e0a458]'}`}
                    style={{ width: `${Math.min(100, g.pct)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHead title="Kontribusi reach" sub="Bagian tiap KOL" />
          <div className="px-4 pb-4">
            {contributions.length === 0
              ? <EmptyState icon="donut_small" title="Tidak ada kontribusi" />
              : <Donut
                  // Unmeasured contributions are omitted from the chart rather
                  // than drawn as a zero-width slice, which would read as a
                  // creator who reached nobody.
                  segments={contributions
                    .filter((c): c is typeof c & { reach: number } => c.reach !== null)
                    .slice(0, 6)
                    .map((c, i) => ({
                      label: c.username, value: c.reach, color: PALETTE[i % PALETTE.length],
                    }))}
                  centerLabel={fmtNum(estimate.reach)} centerSub="est. reach" />}
          </div>
        </Card>
      </div>

      <Card className="mt-3.5 overflow-hidden">
        <CardHead title="Influencer contribution" sub="Diurutkan berdasarkan estimasi reach" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-[#e5e7eb]">
                {['KOL', 'Deliverable', 'Est. reach', 'Share', 'Est. engagement', 'Biaya'].map((h, i) => (
                  <th key={h} style={PJ}
                    className={`text-[10px] font-bold uppercase tracking-wider text-[#9ca3af] px-3 py-2 ${i >= 2 ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contributions.map(c => (
                <tr key={c.accountId} className="border-b border-[#f3f4f6] last:border-0 hover:bg-[#f9fafb]">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div style={{ ...PJ, background: gradientFor(c.username) }}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[9px] font-extrabold">
                        {initials(c.username)}
                      </div>
                      <div>
                        <div style={PJ} className="text-[12px] font-bold text-[#111827]">{c.username}</div>
                        <div className="text-[9.5px] text-[#9ca3af] capitalize">{c.platform}</div>
                      </div>
                    </div>
                  </td>
                  <Num>{c.units}</Num>
                  <Num>{c.reach === null ? NOT_MEASURED : fmtNum(c.reach)}</Num>
                  <Num>{c.reachShare === null ? NOT_MEASURED : `${c.reachShare.toFixed(1)}%`}</Num>
                  <Num>{c.engagement === null ? NOT_MEASURED : fmtNum(c.engagement)}</Num>
                  {/* A generated brand-fit column used to sit here, persisted
                      into the campaign snapshot. Phase 2A stopped the optimizer
                      reading it and Phase 2B deleted the field; nothing writes
                      or shows it now. */}
                  <Num>{idr(c.cost)}</Num>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {contributions.length > 0 && (
        <Card className="mt-3.5">
          <CardHead title="Biaya vs reach per KOL" sub="Membandingkan efisiensi belanja" />
          <div className="px-4 pb-4">
            {/* Same rule as the donut: a creator with no reach reading has no
                bar, because a zero-length bar is a claim about their reach. */}
            <HBars items={contributions
              .filter((c): c is typeof c & { reach: number } => c.reach !== null)
              .map((c, i) => ({
                label: `${c.username} · ${idr(c.cost)}`,
                value: c.reach, display: fmtNum(c.reach), color: PALETTE[i % PALETTE.length],
              }))} />
          </div>
        </Card>
      )}

      {campaign.brief && (
        <Card className="mt-3.5">
          <CardHead title="Campaign brief" />
          <div className="px-4 pb-4">
            <p className="text-[11.5px] text-[#374151] whitespace-pre-wrap leading-relaxed">{campaign.brief}</p>
            {(campaign.hashtags || campaign.mentions) && (
              <p className="text-[11px] text-[#285D6E] mt-2">
                {campaign.hashtags} {campaign.mentions}
              </p>
            )}
          </div>
        </Card>
      )}

      <p className="text-[10.5px] text-[#9ca3af] mt-3">
        Dibuat {order.createdAt ? fmtDate(order.createdAt) : '—'}
        {order.paidAt && ` · dibayar ${fmtDate(order.paidAt)}`}
      </p>
    </div>
  )
}

function Kpi({
  label, value, sub, icon, projected,
}: { label: string; value: string; sub?: string; icon: string; projected?: boolean }) {
  return (
    <Card className="p-3.5">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af]">{label}</span>
            {projected && <ConfidenceBadge confidence="estimated" basis="Proyeksi dari estimasi checkout dikali progres periode campaign" compact />}
          </div>
          <div style={PJ} className="text-[20px] font-extrabold text-[#111827] mt-1 tabular-nums truncate">{value}</div>
          {sub && <div className="text-[10.5px] text-[#9ca3af] mt-0.5 truncate">{sub}</div>}
        </div>
        <span className="w-8 h-8 rounded-lg bg-[#f0f7fa] flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-[17px] text-[#285D6E]">{icon}</span>
        </span>
      </div>
    </Card>
  )
}

function Num({ children }: { children: React.ReactNode }) {
  return <td style={PJ} className="px-3 py-2 text-[11.5px] font-bold text-[#374151] text-right tabular-nums">{children}</td>
}
