'use client'

/**
 * Order history and order detail — the source's "purchases" list, made real.
 *
 * Checkout is a redirect: pressing Pay asks the server for a hosted payment URL
 * and sends the browser there. This component never sees card data, and it never
 * marks an order paid — only the verified webhook can do that, so after a
 * redirect the page simply re-reads the order.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardHead } from '@/components/dashboard/ui'
import { Btn, EmptyState, ErrorState, PJ, Spinner, fmtDate } from './ui'
import type { OrderDetail, OrderStatus, OrderSummary } from '@/lib/discover/orders'

const idr = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID')

const STATUS: Record<OrderStatus, { label: string; bg: string; fg: string }> = {
  draft:           { label: 'Draft',        bg: '#f3f4f6', fg: '#6b7280' },
  pending_payment: { label: 'Menunggu bayar', bg: '#fdf3e7', fg: '#b5761f' },
  paid:            { label: 'Lunas',        bg: '#eaf5ef', fg: '#3d8a5f' },
  cancelled:       { label: 'Dibatalkan',   bg: '#f3f4f6', fg: '#9ca3af' },
  expired:         { label: 'Kedaluwarsa',  bg: '#f3f4f6', fg: '#9ca3af' },
  failed:          { label: 'Gagal',        bg: '#fcefec', fg: '#c2553f' },
}

export function StatusPill({ status }: { status: OrderStatus }) {
  const s = STATUS[status] ?? STATUS.draft
  return (
    <span style={{ ...PJ, background: s.bg, color: s.fg }}
      className="inline-flex items-center rounded-md text-[9.5px] font-extrabold uppercase tracking-wide px-1.5 py-0.5">
      {s.label}
    </span>
  )
}

/* ── list ─────────────────────────────────────────────────────────────────── */

export function DiscoverOrders({ orgId, orgSlug, onGoToCart }: { orgId: string; orgSlug: string; onGoToCart?: () => void }) {
  const [orders, setOrders] = useState<OrderSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/organizations/${orgId}/discover/orders`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { orders: OrderSummary[] }) => { if (!cancelled) setOrders(d.orders) })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })
    return () => { cancelled = true }
  }, [orgId])

  if (error) return <ErrorState message={error} />
  if (!orders) return <Spinner />

  return (
    <div>
      <p className="text-[11.5px] text-[#6b7280] mb-3">
        {orders.length} penawaran &amp; order pada organisasi ini.
      </p>

      {orders.length === 0 ? (
        <EmptyState icon="receipt_long" title="Belum ada order"
          body="Susun paket deliverable di tab Cart untuk membuat penawaran pertama."
          action={onGoToCart ? <Btn size="sm" onClick={onGoToCart}>Ke Cart</Btn> : undefined} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="border-b border-[#e5e7eb]">
                  {['#', 'Campaign', 'Status', 'Akun', 'Item', 'Total', 'Dibuat', ''].map((h, i) => (
                    <th key={h + i} style={PJ}
                      className={`text-[10.5px] font-bold uppercase tracking-wider text-[#9ca3af] px-3 py-2.5 ${i >= 3 && i <= 5 ? 'text-right' : 'text-left'}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} className="border-b border-[#f3f4f6] last:border-0 hover:bg-[#f9fafb]">
                    <td className="px-3 py-2.5 text-[11px] text-[#9ca3af] tabular-nums">#{o.id}</td>
                    <td className="px-3 py-2.5">
                      <Link href={`/organizations/${orgSlug}/discover/kol/orders/${o.id}`}
                        style={PJ} className="text-[12px] font-bold text-[#111827] hover:text-[#285D6E] hover:underline">
                        {o.name}
                      </Link>
                      {o.createdByName && <div className="text-[10px] text-[#9ca3af]">oleh {o.createdByName}</div>}
                    </td>
                    <td className="px-3 py-2.5"><StatusPill status={o.status} /></td>
                    <td style={PJ} className="px-3 py-2.5 text-[11.5px] font-bold text-[#374151] text-right tabular-nums">{o.accountCount}</td>
                    <td style={PJ} className="px-3 py-2.5 text-[11.5px] font-bold text-[#374151] text-right tabular-nums">{o.itemCount}</td>
                    <td style={PJ} className="px-3 py-2.5 text-[12px] font-extrabold text-[#111827] text-right tabular-nums">{idr(o.total)}</td>
                    <td className="px-3 py-2.5 text-[11px] text-[#9ca3af]">{o.createdAt ? fmtDate(o.createdAt) : '—'}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Link href={`/organizations/${orgSlug}/discover/kol/orders/${o.id}`}
                        className="material-symbols-outlined text-[17px] text-[#9ca3af] hover:text-[#285D6E]">chevron_right</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

/* ── detail ───────────────────────────────────────────────────────────────── */

export function DiscoverOrderDetail({
  orgId, orgSlug, orderId,
}: { orgId: string; orgSlug: string; orderId: number }) {
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    fetch(`/api/organizations/${orgId}/discover/orders/${orderId}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'Order tidak ditemukan.' : `HTTP ${r.status}`))))
      .then(setOrder)
      .catch(e => setError(String(e.message ?? e)))
  }, [orgId, orderId])

  useEffect(() => { load() }, [load])

  const pay = async () => {
    setBusy(true); setNotice(null); setError(null)
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/orders/${orderId}/pay`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      // Hand off to the provider's hosted page.
      window.location.href = body.redirectUrl
    } catch (e) {
      setError(String((e as Error).message ?? e))
      setBusy(false)
    }
  }

  const cancel = async () => {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      setNotice('Order dibatalkan.')
      load()
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }

  if (error && !order) return <div className="p-5"><ErrorState message={error} /></div>
  if (!order) return <div className="p-5"><Spinner /></div>

  const payable = order.status !== 'paid' && order.status !== 'cancelled'

  return (
    <div className="p-5 max-w-[1000px] mx-auto">
      <Link href={`/organizations/${orgSlug}/discover/kol?tab=orders`}>
        <Btn size="sm" variant="ghost">
          <span className="material-symbols-outlined text-[15px]">arrow_back</span>Kembali ke Orders
        </Btn>
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap mt-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 style={PJ} className="text-[19px] font-extrabold text-[#111827] tracking-[-0.02em]">{order.name}</h1>
            <StatusPill status={order.status} />
          </div>
          <p className="text-[11.5px] text-[#9ca3af] mt-1">
            Order #{order.id} · {order.accountCount} akun · {order.itemCount} item
            {order.createdAt && ` · dibuat ${fmtDate(order.createdAt)}`}
            {order.createdByName && ` oleh ${order.createdByName}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {order.status === 'paid' && (
            <Link href={`/organizations/${orgSlug}/discover/kol/campaigns/${order.id}`}>
              <Btn variant="primary">
                <span className="material-symbols-outlined text-[15px]">insights</span>
                Buka Campaign Dashboard
              </Btn>
            </Link>
          )}
          {payable && (
            <Btn variant="primary" onClick={pay} disabled={busy}>
              <span className="material-symbols-outlined text-[15px]">payments</span>
              {busy ? 'Memproses…' : 'Bayar sekarang'}
            </Btn>
          )}
          {order.status === 'draft' && (
            <Btn variant="ghost" onClick={cancel} disabled={busy}>
              <span className="material-symbols-outlined text-[15px]">close</span>Batalkan
            </Btn>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-[#fcefec] border border-[#f0c8bf] rounded-xl px-3.5 py-2.5 mb-3.5">
          <span className="material-symbols-outlined text-[16px] text-[#c2553f] mt-0.5">error</span>
          <p className="text-[11.5px] text-[#c2553f] leading-relaxed">{error}</p>
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 bg-[#eaf5ef] border border-[#bfe0cd] rounded-xl px-3.5 py-2.5 mb-3.5">
          <span className="material-symbols-outlined text-[16px] text-[#3d8a5f]">check_circle</span>
          <p className="text-[11.5px] text-[#3d8a5f]">{notice}</p>
        </div>
      )}
      {order.status === 'pending_payment' && order.paymentRedirectUrl && (
        <div className="flex items-center gap-2 bg-[#fdf3e7] border border-[#eed9bb] rounded-xl px-3.5 py-2.5 mb-3.5">
          <span className="material-symbols-outlined text-[16px] text-[#b5761f]">schedule</span>
          <p className="text-[11.5px] text-[#b5761f] flex-1">
            Pembayaran sudah dimulai. Status akan diperbarui otomatis setelah provider mengonfirmasi.
          </p>
          <a href={order.paymentRedirectUrl} target="_blank" rel="noopener noreferrer">
            <Btn size="sm" variant="secondary">Lanjutkan bayar</Btn>
          </a>
        </div>
      )}

      <Card className="overflow-hidden">
        <CardHead title="Deliverables" sub="Harga dikunci saat penawaran dibuat" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px]">
            <thead>
              <tr className="border-b border-[#e5e7eb]">
                {['Akun', 'Deliverable', 'Qty', 'Harga satuan', 'Subtotal'].map((h, i) => (
                  <th key={h} style={PJ}
                    className={`text-[10.5px] font-bold uppercase tracking-wider text-[#9ca3af] px-3 py-2.5 ${i >= 2 ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.items.map(i => (
                <tr key={`${i.socialAccountId}:${i.deliverableId}`} className="border-b border-[#f3f4f6] last:border-0">
                  <td className="px-3 py-2.5">
                    <div style={PJ} className="text-[12px] font-bold text-[#111827]">{i.accountUsername}</div>
                    <div className="text-[10px] text-[#9ca3af] capitalize">{i.platform}</div>
                  </td>
                  <td className="px-3 py-2.5 text-[11.5px] text-[#6b7280]">{i.deliverableLabel}</td>
                  <td style={PJ} className="px-3 py-2.5 text-[11.5px] font-bold text-[#374151] text-right tabular-nums">{i.qty}</td>
                  <td style={PJ} className="px-3 py-2.5 text-[11.5px] font-bold text-[#374151] text-right tabular-nums">{idr(i.unitPrice)}</td>
                  <td style={PJ} className="px-3 py-2.5 text-[11.5px] font-extrabold text-[#111827] text-right tabular-nums">{idr(i.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-[#e5e7eb] bg-[#f9fafb]">
          <div className="ml-auto max-w-[300px]">
            <Row label="Subtotal" value={idr(order.subtotal)} />
            {order.discountAmount > 0 && <Row label={`Promo ${order.promoCode ?? ''}`} value={`−${idr(order.discountAmount)}`} good />}
            <Row label={`Platform fee ${order.feePct}%`} value={idr(order.feeAmount)} />
            <Row label={`PPN ${order.taxPct}%`} value={idr(order.taxAmount)} />
            <div className="border-t border-[#e5e7eb] mt-1.5 pt-1.5">
              <Row label="Total" value={idr(order.total)} bold />
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

function Row({ label, value, bold, good }: { label: string; value: string; bold?: boolean; good?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={`text-[11.5px] ${bold ? 'font-bold text-[#111827]' : 'text-[#6b7280]'}`}>{label}</span>
      <span style={PJ} className={`tabular-nums ${bold ? 'text-[14px] font-extrabold text-[#111827]' : `text-[11.5px] font-bold ${good ? 'text-[#3d8a5f]' : 'text-[#374151]'}`}`}>
        {value}
      </span>
    </div>
  )
}
