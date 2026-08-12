'use client'

/**
 * Payment Success — the confirmation step between Payment and Orders.
 *
 * This is where the provider drops the user after checkout, so it has to cope
 * with the fact that *arriving here does not mean the order is paid*. Midtrans
 * redirects the browser as soon as the customer finishes at their end, while
 * the authoritative signal is the signature-verified webhook, which may land a
 * moment later or (for bank transfer / e-wallet) much later.
 *
 * So the page reads the order and reports what it actually finds:
 *   paid              confirmed — show the receipt and the onward steps
 *   pending_payment   provider still settling — poll a few times, then explain
 *   anything else     say so plainly rather than implying success
 *
 * Claiming success on arrival would be the easy version and the wrong one: it
 * would tell someone their campaign is live when the money has not moved.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Card, CardHead } from '@/components/dashboard/ui'
import { Btn, ErrorState, PJ, fmtDate } from './ui'
import type { OrderDetail } from '@/lib/discover/orders'

const idr = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID')

/** A few short polls covers the usual webhook lag without hammering the API. */
const POLL_MS = 3000
const MAX_POLLS = 5

export default function PaymentSuccess({
  orgId, orgSlug, orderId, initialOrder,
}: { orgId: string; orgSlug: string; orderId: number; initialOrder: OrderDetail }) {
  // Seeded from the server render; polling only refreshes it.
  const [order, setOrder] = useState<OrderDetail>(initialOrder)
  const [error, setError] = useState<string | null>(null)
  const [polls, setPolls] = useState(0)
  const timer = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/orders/${orderId}`)
      if (!res.ok) throw new Error(res.status === 404 ? 'Order tidak ditemukan.' : `HTTP ${res.status}`)
      const d: OrderDetail = await res.json()
      setOrder(d)
      return d
    } catch (e) {
      setError(String((e as Error).message ?? e))
      return null
    }
  }, [orgId, orderId])

  // Keep checking only while the provider has not settled yet.
  useEffect(() => {
    if (!order || order.status === 'paid' || polls >= MAX_POLLS) return
    if (order.status !== 'pending_payment' && order.status !== 'draft') return
    timer.current = window.setTimeout(async () => {
      await load()
      setPolls(p => p + 1)
    }, POLL_MS)
    return () => { if (timer.current) window.clearTimeout(timer.current) }
  }, [order, polls, load])

  if (error && !order) return <div className="p-5"><ErrorState message={error} /></div>

  const paid = order.status === 'paid'
  const settling = order.status === 'pending_payment' || order.status === 'draft'

  const tone = paid
    ? { bg: '#eaf5ef', fg: '#3d8a5f', icon: 'check_circle', title: 'Pembayaran berhasil' }
    : settling
      ? { bg: '#fdf3e7', fg: '#b5761f', icon: 'schedule', title: 'Menunggu konfirmasi pembayaran' }
      : { bg: '#fcefec', fg: '#c2553f', icon: 'error', title: 'Pembayaran belum selesai' }

  return (
    <div className="p-5 max-w-[880px] mx-auto">
      <Card className="overflow-hidden">
        <div className="px-5 py-6 text-center border-b" style={{ borderColor: '#e5e7eb' }}>
          <span className="w-14 h-14 rounded-2xl inline-flex items-center justify-center"
            style={{ background: tone.bg }}>
            <span className="material-symbols-outlined text-[28px]" style={{ color: tone.fg }}>
              {tone.icon}
            </span>
          </span>
          <h1 style={{ ...PJ, color: '#111827' }} className="text-[20px] font-extrabold mt-3">
            {tone.title}
          </h1>
          <p className="text-[12.5px] mt-1" style={{ color: '#6b7280' }}>
            {paid
              ? `Campaign "${order.name}" sudah aktif dan siap dijalankan.`
              : settling
                ? 'Provider belum mengonfirmasi. Status akan diperbarui otomatis begitu konfirmasi masuk.'
                : `Status order saat ini: ${order.status}.`}
          </p>

          {settling && polls < MAX_POLLS && (
            <p className="text-[11px] mt-2 inline-flex items-center gap-1" style={{ color: '#9ca3af' }}>
              <span className="material-symbols-outlined text-[13px] animate-spin">progress_activity</span>
              Mengecek status… ({polls + 1}/{MAX_POLLS})
            </p>
          )}
          {settling && polls >= MAX_POLLS && (
            <div className="mt-2">
              <Btn size="sm" variant="secondary" onClick={() => { setPolls(0); load() }}>
                <span className="material-symbols-outlined text-[14px]">refresh</span>Cek lagi
              </Btn>
            </div>
          )}
        </div>

        <CardHead title="Order Confirmation" sub={`Order ID #${order.id}`} />
        <div className="px-4 pb-4">
          <div className="flex flex-col gap-1">
            <Row label="Campaign" value={order.name} />
            <Row label="KOL" value={order.kols.length ? order.kols.join(', ') : '—'} />
            <Row label="Paket" value={order.packages.length ? order.packages.join(', ') : '—'} />
            <Row label="Jumlah konten" value={String(order.itemCount)} />
            <Row label="Dibuat" value={order.createdAt ? fmtDate(order.createdAt) : '—'} />
            {order.paidAt && <Row label="Dibayar" value={fmtDate(order.paidAt)} />}
          </div>

          <div className="border-t mt-2.5 pt-2.5 flex flex-col gap-1" style={{ borderColor: '#e5e7eb' }}>
            <Row label="Subtotal" value={idr(order.subtotal)} />
            {order.discountAmount > 0 && <Row label="Promo" value={`−${idr(order.discountAmount)}`} />}
            <Row label={`Platform fee ${order.feePct}%`} value={idr(order.feeAmount)} />
            <Row label={`PPN ${order.taxPct}%`} value={idr(order.taxAmount)} />
            <div className="border-t mt-1.5 pt-1.5" style={{ borderColor: '#e5e7eb' }}>
              <Row label="Total dibayar" value={idr(order.total)} bold />
            </div>
          </div>
        </div>
      </Card>

      {/* onward steps — the flow continues rather than dead-ending here */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
        <NextStep
          href={`/organizations/${orgSlug}/discover/campaign-management`}
          icon="monitoring" title="Track Progress"
          body="Jalankan campaign ini: atur statusnya dan progres tiap creator." />
        <NextStep
          href={`/organizations/${orgSlug}/discover/kol?tab=orders`}
          icon="receipt_long" title="View Purchase History"
          body="Lihat order ini bersama seluruh riwayat pembelian." />
        <NextStep
          href={`/organizations/${orgSlug}/discover/kol/campaigns/${order.id}`}
          icon="insights" title="Campaign Dashboard"
          body="Pantau reach, engagement, ROI dan kontribusi tiap creator."
          disabled={!paid}
          disabledHint="Tersedia setelah pembayaran dikonfirmasi" />
      </div>

      <div className="flex items-center justify-center gap-2 mt-4">
        <Link href={`/organizations/${orgSlug}/discover/kol/orders/${order.id}`}>
          <Btn variant="secondary">
            <span className="material-symbols-outlined text-[15px]">description</span>Detail order
          </Btn>
        </Link>
        <Link href={`/organizations/${orgSlug}/dashboard`}>
          <Btn variant="ghost">
            <span className="material-symbols-outlined text-[15px]">space_dashboard</span>Back to Dashboard
          </Btn>
        </Link>
      </div>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className={`text-[11.5px] ${bold ? 'font-bold' : ''}`}
        style={{ color: bold ? '#111827' : '#6b7280' }}>{label}</span>
      <span style={{ ...PJ, color: '#111827' }}
        className={`tabular-nums text-right ${bold ? 'text-[14px] font-extrabold' : 'text-[11.5px] font-bold'}`}>
        {value}
      </span>
    </div>
  )
}

function NextStep({
  href, icon, title, body, disabled, disabledHint,
}: {
  href: string; icon: string; title: string; body: string
  disabled?: boolean; disabledHint?: string
}) {
  const inner = (
    <div className={`h-full rounded-xl border bg-white p-3.5 transition-all ${
      disabled ? 'opacity-60' : 'hover:shadow-md hover:border-[#A7C8D4]'
    }`} style={{ borderColor: '#e5e7eb' }}>
      <span className="w-8 h-8 rounded-lg inline-flex items-center justify-center" style={{ background: '#f0f7fa' }}>
        <span className="material-symbols-outlined text-[17px]" style={{ color: '#285D6E' }}>{icon}</span>
      </span>
      <div style={{ ...PJ, color: '#111827' }} className="text-[12.5px] font-extrabold mt-2">{title}</div>
      <p className="text-[11px] leading-relaxed mt-0.5" style={{ color: '#6b7280' }}>
        {disabled ? disabledHint ?? body : body}
      </p>
    </div>
  )
  return disabled ? <div>{inner}</div> : <Link href={href} className="block h-full">{inner}</Link>
}
