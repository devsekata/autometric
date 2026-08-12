'use client'

/**
 * Orders workspace — My Orders and Order History.
 *
 * The split is by whether the order is still live work or finished business:
 *
 *   My Orders      draft, pending_payment, paid — things the user is planning,
 *                  paying for, or currently running.
 *   Order History  cancelled, expired, failed — closed, kept for the record.
 *
 * `paid` deliberately sits in My Orders rather than History: a paid campaign is
 * the *most* active thing in the system, and filing it under "history" the
 * moment money clears is precisely the confusion this section exists to remove.
 *
 * Each row also makes the planning-vs-purchased distinction explicit, since
 * both live in the same table.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardHead } from '@/components/dashboard/ui'
import { Btn, EmptyState, ErrorState, PJ, Spinner, fmtDate } from './ui'
import { exportPrintable } from './exportData'
import { useDiscoverCart } from './useDiscoverCart'
import type { OrderDetail, OrderStatus, OrderSummary } from '@/lib/discover/orders'

const idr = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID')

/** Orders still in play. Everything else is history. */
const ACTIVE: OrderStatus[] = ['draft', 'pending_payment', 'paid']

const PAYMENT: Record<OrderStatus, { label: string; bg: string; fg: string }> = {
  draft: { label: 'Belum dibayar', bg: '#f3f4f6', fg: '#6b7280' },
  pending_payment: { label: 'Menunggu bayar', bg: '#fdf3e7', fg: '#b5761f' },
  paid: { label: 'Lunas', bg: '#eaf5ef', fg: '#3d8a5f' },
  cancelled: { label: 'Dibatalkan', bg: '#f3f4f6', fg: '#9ca3af' },
  expired: { label: 'Kedaluwarsa', bg: '#f3f4f6', fg: '#9ca3af' },
  failed: { label: 'Gagal', bg: '#fcefec', fg: '#c2553f' },
}

/** Campaign state is a different axis from payment state. */
function campaignState(o: OrderSummary): { label: string; bg: string; fg: string } {
  if (o.status === 'paid') return { label: 'Berjalan', bg: '#eaf5ef', fg: '#3d8a5f' }
  if (o.status === 'draft') return { label: 'Perencanaan', bg: '#f0f7fa', fg: '#285D6E' }
  if (o.status === 'pending_payment') return { label: 'Menunggu pembayaran', bg: '#fdf3e7', fg: '#b5761f' }
  return { label: 'Tidak berjalan', bg: '#f3f4f6', fg: '#9ca3af' }
}

export default function OrdersWorkspace({
  orgId, orgSlug, onGoToCart,
}: { orgId: string; orgSlug: string; onGoToCart: () => void }) {
  const [orders, setOrders] = useState<OrderSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'active' | 'history'>('active')
  const [notice, setNotice] = useState<string | null>(null)
  const cart = useDiscoverCart(orgId)

  const load = useCallback(() => {
    fetch(`/api/organizations/${orgId}/discover/orders`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { orders: OrderSummary[] }) => setOrders(d.orders))
      .catch(e => setError(String(e.message ?? e)))
  }, [orgId])

  useEffect(() => { load() }, [load])

  const { active, history } = useMemo(() => ({
    active: (orders ?? []).filter(o => ACTIVE.includes(o.status)),
    history: (orders ?? []).filter(o => !ACTIVE.includes(o.status)),
  }), [orders])

  /** Reorder repopulates the cart from a past order's line items. */
  const reorder = useCallback(async (orderId: number) => {
    setNotice(null)
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/orders/${orderId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const detail: OrderDetail = await res.json()
      for (const item of detail.items) {
        cart.add({
          socialAccountId: item.socialAccountId,
          relation: item.relation,
          deliverableId: item.deliverableId,
        }, item.qty)
      }
      setNotice(`${detail.items.length} item dari order #${orderId} disalin ke keranjang.`)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    }
  }, [orgId, cart])

  /** Invoice as a printable document; the browser's dialog offers Save as PDF. */
  const invoice = useCallback(async (orderId: number) => {
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/orders/${orderId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const o: OrderDetail = await res.json()
      const rows = o.items.map(i =>
        `<tr><td>${i.accountUsername}</td><td>${i.deliverableLabel}</td><td>${i.platform}</td>
         <td class="num">${i.qty}</td><td class="num">${idr(i.unitPrice)}</td>
         <td class="num">${idr(i.lineTotal)}</td></tr>`).join('')
      exportPrintable(`Invoice #${o.id}`,
        `<h1>Invoice #${o.id}</h1>
         <div class="sub">${o.name} · dibuat ${o.createdAt ? fmtDate(o.createdAt) : '—'}
         · status ${PAYMENT[o.status].label}${o.paidAt ? ` · dibayar ${fmtDate(o.paidAt)}` : ''}</div>
         <table><thead><tr><th>KOL</th><th>Paket</th><th>Platform</th><th>Qty</th><th>Harga satuan</th><th>Subtotal</th></tr></thead>
         <tbody>${rows}</tbody></table>
         <table style="margin-top:18px;width:320px;margin-left:auto">
           <tbody>
             <tr><td>Subtotal</td><td class="num">${idr(o.subtotal)}</td></tr>
             ${o.discountAmount > 0 ? `<tr><td>Promo</td><td class="num">-${idr(o.discountAmount)}</td></tr>` : ''}
             <tr><td>Platform fee ${o.feePct}%</td><td class="num">${idr(o.feeAmount)}</td></tr>
             <tr><td>PPN ${o.taxPct}%</td><td class="num">${idr(o.taxAmount)}</td></tr>
             <tr><td><b>Total</b></td><td class="num"><b>${idr(o.total)}</b></td></tr>
           </tbody>
         </table>`)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    }
  }, [orgId])

  if (error && !orders) return <ErrorState message={error} />
  if (!orders) return <Spinner />

  const rows = tab === 'active' ? active : history

  return (
    <div>
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        {([['active', 'My Orders', active.length], ['history', 'Order History', history.length]] as const).map(([id, label, n]) => (
          <button key={id} type="button" onClick={() => setTab(id)} style={PJ}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11.5px] font-bold transition-colors border ${
              tab === id ? 'bg-[#f0f7fa] border-[#327488] text-[#285D6E]'
                         : 'bg-white border-[#e5e7eb] text-[#6b7280] hover:border-[#A7C8D4]'
            }`}>
            <span className="material-symbols-outlined text-[15px]">
              {id === 'active' ? 'pending_actions' : 'history'}
            </span>
            {label}
            <span className={`rounded-full text-[9px] px-1.5 font-extrabold ${
              tab === id ? 'bg-[#327488] text-white' : 'bg-[#e5e7eb] text-[#6b7280]'
            }`}>{n}</span>
          </button>
        ))}
        <div className="flex-1" />
        {cart.totalUnits > 0 && (
          <Btn size="sm" variant="secondary" onClick={onGoToCart}>
            <span className="material-symbols-outlined text-[14px]">shopping_cart</span>
            Keranjang ({cart.totalUnits})
          </Btn>
        )}
        <Btn size="sm" variant="ghost" onClick={load}>
          <span className="material-symbols-outlined text-[14px]">refresh</span>Muat ulang
        </Btn>
      </div>

      <p className="text-[11px] text-[#9ca3af] mb-3">
        {tab === 'active'
          ? 'Order yang sedang direncanakan, menunggu pembayaran, atau campaign-nya sedang berjalan.'
          : 'Order yang sudah dibatalkan, kedaluwarsa, atau gagal dibayar.'}
      </p>

      {notice && (
        <div className="flex items-center gap-2 bg-[#eaf5ef] border border-[#bfe0cd] rounded-xl px-3.5 py-2.5 mb-3">
          <span className="material-symbols-outlined text-[16px] text-[#3d8a5f]">check_circle</span>
          <p className="text-[11.5px] text-[#3d8a5f] flex-1">{notice}</p>
          <Btn size="sm" variant="secondary" onClick={onGoToCart}>Buka keranjang</Btn>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 bg-[#fcefec] border border-[#f0c8bf] rounded-xl px-3.5 py-2.5 mb-3">
          <span className="material-symbols-outlined text-[16px] text-[#c2553f] mt-0.5">error</span>
          <p className="text-[11.5px] text-[#c2553f]">{error}</p>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={tab === 'active' ? 'receipt_long' : 'history'}
          title={tab === 'active' ? 'Belum ada order aktif' : 'Riwayat masih kosong'}
          body={tab === 'active'
            ? 'Pilih KOL di Directory, cek Rate Card, lalu tambahkan ke keranjang untuk membuat order.'
            : 'Order yang dibatalkan atau kedaluwarsa akan muncul di sini.'}
          action={tab === 'active'
            ? <Btn size="sm" variant="primary" onClick={onGoToCart}>Buka keranjang</Btn>
            : undefined}
        />
      ) : (
        <Card className="overflow-hidden">
          <CardHead title={tab === 'active' ? 'My Orders' : 'Order History'}
            sub={`${rows.length} order`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px]">
              <thead>
                <tr className="border-b border-[#e5e7eb]">
                  {['Order ID', 'Campaign', 'KOL', 'Package', 'Date', 'Amount', 'Payment', 'Campaign Status', 'Actions'].map((h, i) => (
                    <th key={h} style={PJ}
                      className={`text-[10.5px] font-bold uppercase tracking-wider text-[#9ca3af] px-3 py-2.5 ${i === 5 ? 'text-right' : 'text-left'}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(o => {
                  const pay = PAYMENT[o.status]
                  const camp = campaignState(o)
                  const purchased = o.status === 'paid'
                  return (
                    <tr key={o.id} className="border-b border-[#f3f4f6] last:border-0 hover:bg-[#f9fafb] align-top">
                      <td className="px-3 py-2.5">
                        <span style={PJ} className="text-[11.5px] font-bold text-[#374151] tabular-nums">#{o.id}</span>
                        <div className={`text-[9.5px] font-extrabold uppercase mt-0.5 ${
                          purchased ? 'text-[#3d8a5f]' : 'text-[#9ca3af]'
                        }`}>
                          {purchased ? 'Sudah dibeli' : 'Rencana'}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <Link href={`/organizations/${orgSlug}/discover/kol/orders/${o.id}`}
                          style={PJ} className="text-[12px] font-bold text-[#111827] hover:text-[#285D6E] hover:underline">
                          {o.name}
                        </Link>
                        {o.createdByName && <div className="text-[10px] text-[#9ca3af]">oleh {o.createdByName}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-[#6b7280] max-w-[170px]">
                        {o.kols.length ? o.kols.join(', ') : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-[#6b7280] max-w-[150px]">
                        {o.packages.length ? o.packages.join(', ') : '—'}
                        <div className="text-[9.5px] text-[#9ca3af]">{o.itemCount} konten</div>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-[#9ca3af]">
                        {o.createdAt ? fmtDate(o.createdAt) : '—'}
                      </td>
                      <td style={PJ} className="px-3 py-2.5 text-[12px] font-extrabold text-[#111827] text-right tabular-nums">
                        {idr(o.total)}
                      </td>
                      <td className="px-3 py-2.5">
                        <Pill {...pay} />
                        {o.paidAt && <div className="text-[9.5px] text-[#9ca3af] mt-0.5">{fmtDate(o.paidAt)}</div>}
                      </td>
                      <td className="px-3 py-2.5"><Pill {...camp} /></td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1 flex-wrap">
                          <Link href={`/organizations/${orgSlug}/discover/kol/orders/${o.id}`}>
                            <Btn size="sm" variant="ghost" title="View Order">
                              <span className="material-symbols-outlined text-[14px]">receipt_long</span>
                            </Btn>
                          </Link>
                          {purchased && (
                            <Link href={`/organizations/${orgSlug}/discover/kol/campaigns/${o.id}`}>
                              <Btn size="sm" variant="ghost" title="View Campaign">
                                <span className="material-symbols-outlined text-[14px]">insights</span>
                              </Btn>
                            </Link>
                          )}
                          <Btn size="sm" variant="ghost" title="Download Invoice" onClick={() => invoice(o.id)}>
                            <span className="material-symbols-outlined text-[14px]">download</span>
                          </Btn>
                          <Btn size="sm" variant="ghost" title="Reorder" onClick={() => reorder(o.id)}>
                            <span className="material-symbols-outlined text-[14px]">refresh</span>
                          </Btn>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

function Pill({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span style={{ ...PJ, background: bg, color: fg }}
      className="inline-flex items-center rounded-md text-[9.5px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 whitespace-nowrap">
      {label}
    </span>
  )
}
