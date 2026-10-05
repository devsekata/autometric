'use client'

/**
 * Payment — step 6 of the campaign flow, in the flow rather than on its own page.
 *
 * The order already exists by the time this renders: Checkout created it. This
 * step settles it and moves on to the Campaign Dashboard, so the chain
 * Setup → Brief → Budget → Review → Checkout → Payment → Dashboard happens in
 * one place instead of bouncing to the order screen halfway through.
 *
 * Card details are never collected here — pressing Pay asks the server for a
 * hosted payment URL and hands the browser to the provider. On return the order
 * is re-read; only the signature-verified webhook can mark it paid, so this
 * component reports status rather than deciding it.
 *
 * When no provider is configured it says so plainly and still offers the way
 * forward. A missing API key should not strand a finished campaign at the last
 * step — the order is saved either way and can be paid later.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardHead } from '@/components/dashboard/ui'
import { Btn, PJ, Spinner } from './ui'
import type { OrderDetail } from '@/lib/discover/orders'

const idr = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID')

export default function PaymentStep({
  orgId, orgSlug, orderId, onDone,
}: { orgId: string; orgSlug: string; orderId: number; onDone: () => void }) {
  const router = useRouter()
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unconfigured, setUnconfigured] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    fetch(`/api/organizations/${orgId}/discover/orders/${orderId}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setOrder)
      .catch(e => setError(String(e.message ?? e)))
  }, [orgId, orderId])

  useEffect(() => { load() }, [load])

  const goToDashboard = () => {
    onDone()
    router.push(`/organizations/${orgSlug}/discover/kol/campaigns/${orderId}`)
  }

  /** Continue to the confirmation step — the next link in the flow. */
  const goToSuccess = () => {
    onDone()
    router.push(`/organizations/${orgSlug}/discover/kol/orders/${orderId}/success`)
  }

  const pay = async () => {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/orders/${orderId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Land back on the confirmation step for this order, not the org list.
        body: JSON.stringify({
          returnPath: `/organizations/${orgSlug}/discover/kol/orders/${orderId}/success`,
        }),
      })
      const body = await res.json()
      if (res.status === 503) { setUnconfigured(true); setBusy(false); return }
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      // The draft has served its purpose; clear it before leaving the app.
      onDone()
      window.location.href = body.redirectUrl
    } catch (e) {
      setError(String((e as Error).message ?? e))
      setBusy(false)
    }
  }

  if (!order) return <Spinner />

  const paid = order.status === 'paid'
  const pending = order.status === 'pending_payment'

  return (
    <>
      <Card>
        <CardHead
          title={paid ? 'Pembayaran selesai' : 'Payment'}
          sub={paid
            ? 'Campaign siap dijalankan'
            : `Order #${order.id} sudah dibuat dan menunggu pembayaran`}
        />
        <div className="px-4 pb-4">
          <div className="flex items-center gap-3 mb-3">
            <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              paid ? 'bg-[#eaf5ef]' : 'bg-[#f0f7fa]'
            }`}>
              <span className={`material-symbols-outlined text-[20px] ${paid ? 'text-[#3d8a5f]' : 'text-[#285D6E]'}`}>
                {paid ? 'check_circle' : 'receipt_long'}
              </span>
            </span>
            <div className="flex-1 min-w-0">
              <div style={PJ} className="text-[13px] font-extrabold text-[#111827] truncate">{order.name}</div>
              <div className="text-[10.5px] text-[#9ca3af]">
                {order.accountCount} KOL · {order.itemCount} deliverable
              </div>
            </div>
            <div className="text-right">
              <div style={PJ} className="text-[18px] font-extrabold text-[#111827] tabular-nums">{idr(order.total)}</div>
              <div className="text-[10px] text-[#9ca3af]">termasuk fee &amp; PPN</div>
            </div>
          </div>

          <div className="border-t border-[#e5e7eb] pt-2.5 flex flex-col gap-1">
            <Row label="Subtotal" value={idr(order.subtotal)} />
            {order.discountAmount > 0 && <Row label="Promo" value={`−${idr(order.discountAmount)}`} />}
            <Row label={`Platform fee ${order.feePct}%`} value={idr(order.feeAmount)} />
            <Row label={`PPN ${order.taxPct}%`} value={idr(order.taxAmount)} />
            <div className="border-t border-[#e5e7eb] mt-1.5 pt-1.5">
              <Row label="Total" value={idr(order.total)} bold />
            </div>
          </div>
        </div>
      </Card>

      {error && (
        <div className="flex items-start gap-2 bg-[#fcefec] border border-[#f0c8bf] rounded-xl px-3.5 py-2.5">
          <span className="material-symbols-outlined text-[16px] text-[#c2553f] mt-0.5">error</span>
          <p className="text-[11.5px] text-[#c2553f]">{error}</p>
        </div>
      )}

      {unconfigured && (
        <div className="flex items-start gap-2 bg-[#fdf3e7] border border-[#eed9bb] rounded-xl px-3.5 py-2.5">
          <span className="material-symbols-outlined text-[16px] text-[#b5761f] mt-0.5">info</span>
          <p className="text-[11.5px] text-[#b5761f] leading-relaxed">
            <b>Payment gateway belum dikonfigurasi.</b> Set <code>MIDTRANS_SERVER_KEY</code> di
            environment untuk mengaktifkan pembayaran. Campaign tetap tersimpan sebagai order —
            kamu bisa lanjut ke dashboard sekarang dan membayarnya nanti dari halaman order.
          </p>
        </div>
      )}

      {pending && order.paymentRedirectUrl && (
        <div className="flex items-center gap-2 flex-wrap bg-[#fdf3e7] border border-[#eed9bb] rounded-xl px-3.5 py-2.5">
          <span className="material-symbols-outlined text-[16px] text-[#b5761f]">schedule</span>
          <p className="text-[11.5px] text-[#b5761f] flex-1">
            Pembayaran sudah dimulai. Status diperbarui otomatis setelah provider mengonfirmasi.
          </p>
          <a href={order.paymentRedirectUrl} target="_blank" rel="noopener noreferrer">
            <Btn size="sm" variant="secondary">Lanjutkan bayar</Btn>
          </a>
          <Btn size="sm" variant="ghost" onClick={load}>
            <span className="material-symbols-outlined text-[14px]">refresh</span>Cek status
          </Btn>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {!paid && (
          <Btn variant="primary" disabled={busy} onClick={pay}>
            <span className="material-symbols-outlined text-[15px]">payments</span>
            {busy ? 'Menyiapkan pembayaran…' : 'Bayar sekarang'}
          </Btn>
        )}
        {paid ? (
          <Btn variant="primary" onClick={goToSuccess}>
            <span className="material-symbols-outlined text-[15px]">check_circle</span>
            Lihat konfirmasi
          </Btn>
        ) : (
          <Btn variant="secondary" onClick={goToSuccess}>
            <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
            Lanjut tanpa bayar
          </Btn>
        )}
        <Btn variant="ghost" onClick={goToDashboard}>
          <span className="material-symbols-outlined text-[15px]">insights</span>
          Campaign Dashboard
        </Btn>
        <span className="text-[10.5px] text-[#9ca3af]">
          Data kartu diproses di halaman provider, tidak pernah masuk ke sistem ini.
        </span>
      </div>
    </>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={`text-[11.5px] ${bold ? 'font-bold text-[#111827]' : 'text-[#6b7280]'}`}>{label}</span>
      <span style={PJ} className={`tabular-nums ${bold ? 'text-[14px] font-extrabold text-[#111827]' : 'text-[11.5px] font-bold text-[#374151]'}`}>
        {value}
      </span>
    </div>
  )
}
