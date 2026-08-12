'use client'

/**
 * Cart tab of the KOL workspace — port of the source's Cart & Checkout.
 *
 * Kept from the original: deliverables with quantities per creator, a rate-card
 * panel showing unit prices, a promo field, and a running summary
 * (subtotal → discount → platform fee → tax → total).
 *
 * Changed on purpose:
 *   * The summary is priced by the server on every change, not in the browser.
 *     A cart that computes its own total is a cart the user can edit.
 *   * Selection comes from useDiscoverCart, so "Add to Cart" pressed on an
 *     account's detail page lands here.
 *   * Rupiah, not dollars, and no card form — checkout redirects to the
 *     provider's hosted page (see lib/discover/payment.ts).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardHead } from '@/components/dashboard/ui'
import { Btn, EmptyState, PJ, PLATFORM_ICON, Spinner, gradientFor } from './ui'
import { useDiscoverCart } from './useDiscoverCart'
import type { DirectoryAccount } from '@/lib/discover/types'
import type { Deliverable, RateCard } from '@/lib/discover/vocab'
import type { Quotation } from '@/lib/discover/orders'
import type { KolProfile } from '@/lib/discover/profile'
import { estimateCampaign, type SelectedKol } from '@/lib/discover/campaign'
import { fmtNum } from './ui'

const OBJECTIVES = ['Awareness', 'Consideration', 'Conversion', 'Engagement', 'Loyalty'] as const

const idr = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID')

export default function DiscoverCart({
  orgId, onGoToRates, onCheckout,
}: {
  orgId: string
  onGoToRates?: () => void
  /**
   * Continue to Campaign Planning, handing over everything the cart just asked
   * for. The promo code matters most: the cart previews a discounted total, but
   * the order is created one screen later — without carrying the code the
   * customer saw a discount that never reached the order.
   */
  onCheckout?: (ctx: { objective: string; name: string; promoCode: string }) => void
}) {
  const [accounts, setAccounts] = useState<DirectoryAccount[]>([])
  const [rates, setRates] = useState<Record<string, RateCard>>({})
  const [deliverables, setDeliverables] = useState<Deliverable[]>([])
  const [promo, setPromo] = useState('')
  const [name, setName] = useState('Campaign baru')
  const [objective, setObjective] = useState<string>('Awareness')
  const [profiles, setProfiles] = useState<KolProfile[]>([])
  const [quotation, setQuotation] = useState<Quotation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const cart = useDiscoverCart(orgId)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/organizations/${orgId}/discover/rates`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { rates: Record<string, RateCard>; deliverables: Deliverable[]; accounts: DirectoryAccount[] }) => {
        if (cancelled) return
        setRates(d.rates); setDeliverables(d.deliverables); setAccounts(d.accounts)
      })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [orgId])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/organizations/${orgId}/discover/profiles`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { profiles: KolProfile[] }) => { if (!cancelled) setProfiles(d.profiles) })
      .catch(() => { /* totals still render without the reach model */ })
    return () => { cancelled = true }
  }, [orgId])

  const chosen = useMemo(() => {
    const ids = new Set(cart.accountIds)
    return accounts.filter(a => ids.has(a.id))
  }, [accounts, cart.accountIds])

  const lines = useMemo(
    () => cart.lines.map(l => ({
      socialAccountId: l.socialAccountId, relation: l.relation,
      deliverableId: l.deliverableId, qty: l.qty,
    })),
    [cart.lines])

  // Server prices the cart on every change, debounced so stepping a quantity
  // does not fire a request per click.
  useEffect(() => {
    if (!cart.ready) return
    if (lines.length === 0) { setQuotation(null); return }
    const t = setTimeout(() => {
      fetch(`/api/organizations/${orgId}/discover/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: true, lines, promoCode: promo }),
      })
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d: { quotation: Quotation }) => setQuotation(d.quotation))
        .catch(() => setQuotation(null))
    }, 250)
    return () => clearTimeout(t)
  }, [orgId, lines, promo, cart.ready])

  /** Same model the campaign estimate uses, so the cart never disagrees with checkout. */
  const estimate = useMemo(() => {
    const byAccount = new Map<string, SelectedKol>()
    for (const l of cart.lines) {
      const profile = profiles.find(p => p.account.id === l.socialAccountId)
      if (!profile) continue
      const cur = byAccount.get(l.socialAccountId)
      byAccount.set(l.socialAccountId, {
        profile, units: (cur?.units ?? 0) + l.qty, cost: cur?.cost ?? 0,
      })
    }
    return estimateCampaign([...byAccount.values()])
  }, [cart.lines, profiles])

  if (loading || !cart.ready) return <Spinner />

  const unpriced = chosen.filter(a => !rates[a.id] || rates[a.id].baseRate <= 0)

  return (
    <div>
      {error && (
        <div className="flex items-start gap-2 bg-[#fcefec] border border-[#f0c8bf] rounded-xl px-3.5 py-2.5 mb-3.5">
          <span className="material-symbols-outlined text-[16px] text-[#c2553f] mt-0.5">error</span>
          <p className="text-[11.5px] text-[#c2553f] leading-relaxed">{error}</p>
        </div>
      )}

      {chosen.length === 0 ? (
        <EmptyState
          icon="shopping_cart"
          title="Keranjang masih kosong"
          body="Buka salah satu akun di tab Directory, lalu tekan Add to Cart. Deliverable yang dipilih akan muncul di sini."
        />
      ) : (
        <div className="grid gap-4 items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) 300px' }}>
          <div className="min-w-0 flex flex-col gap-3.5">
            {unpriced.length > 0 && (
              <div className="flex items-start gap-2 bg-[#fdf3e7] border border-[#eed9bb] rounded-xl px-3.5 py-2.5">
                <span className="material-symbols-outlined text-[16px] text-[#b5761f] mt-0.5">info</span>
                <p className="text-[11.5px] text-[#b5761f] leading-relaxed flex-1">
                  {unpriced.length} akun belum punya rate card jadi belum bisa dihitung:{' '}
                  <b>{unpriced.map(a => a.username).join(', ')}</b>.
                </p>
                {onGoToRates && <Btn size="sm" variant="secondary" onClick={onGoToRates}>Atur tarif</Btn>}
              </div>
            )}

            {chosen.map(a => (
              <AccountPackage
                key={`${a.relation}:${a.id}`}
                account={a}
                rate={rates[a.id]}
                deliverables={deliverables.filter(d => d.platform === a.platform)}
                qtyOf={did => cart.qtyOf({ socialAccountId: a.id, relation: a.relation, deliverableId: did })}
                onQty={(did, qty) => cart.setQty(
                  { socialAccountId: a.id, relation: a.relation, deliverableId: did }, qty)}
                onRemove={() => cart.removeAccount(a.id)}
              />
            ))}
          </div>

          <aside className="sticky top-4">
            <Card>
              <CardHead
                title="Ringkasan penawaran"
                sub={quotation ? `${quotation.lines.length} baris · ${cart.totalUnits} item` : 'Belum ada deliverable'}
              />
              <div className="px-4 pb-4">
                {!quotation ? (
                  <p className="text-[11.5px] text-[#9ca3af]">Pilih deliverable untuk melihat perhitungan.</p>
                ) : (
                  <>
                    <SumRow label="Subtotal" value={idr(quotation.subtotal)} />
                    {quotation.discountAmount > 0 && (
                      <SumRow label={`Promo ${quotation.promoCode}`} value={`−${idr(quotation.discountAmount)}`} good />
                    )}
                    <SumRow label={`Platform fee ${quotation.feePct}%`} value={idr(quotation.feeAmount)} />
                    <SumRow label={`PPN ${quotation.taxPct}%`} value={idr(quotation.taxAmount)} />
                    <div className="border-t border-[#e5e7eb] mt-2 pt-2">
                      <SumRow label="Total" value={idr(quotation.total)} bold />
                    </div>
                    {quotation.rejected.length > 0 && (
                      <p className="text-[10.5px] text-[#b5761f] mt-2">
                        {quotation.rejected.length} baris dilewati: {quotation.rejected[0].reason}
                      </p>
                    )}
                  </>
                )}

                <div className="border-t border-[#e5e7eb] mt-2 pt-2 flex flex-col gap-1">
                  <SumRow label="Est. reach" value={fmtNum(estimate.reach)} />
                  <SumRow label="Est. engagement" value={fmtNum(estimate.engagement)} />
                </div>

                <div className="mt-3 flex flex-col gap-2">
                  <label className="flex flex-col gap-1">
                    <span style={PJ} className="text-[10px] font-bold uppercase tracking-widest text-[#9ca3af]">
                      Campaign objective
                    </span>
                    <select value={objective} onChange={e => setObjective(e.target.value)}
                      className="h-8 px-2.5 rounded-lg border border-[#e5e7eb] text-[12px] text-[#374151] focus:outline-none focus:border-[#327488]">
                      {OBJECTIVES.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="Nama campaign"
                    className="h-8 px-2.5 rounded-lg border border-[#e5e7eb] text-[12px] text-[#374151] focus:outline-none focus:border-[#327488]" />
                  <input value={promo} onChange={e => setPromo(e.target.value)} placeholder="Kode promo (opsional)"
                    className="h-8 px-2.5 rounded-lg border border-[#e5e7eb] text-[12px] text-[#374151] uppercase focus:outline-none focus:border-[#327488]" />
                  <Btn variant="primary" disabled={!quotation || quotation.lines.length === 0}
                    onClick={() => onCheckout?.({ objective, name, promoCode: promo.trim() })}>
                    <span className="material-symbols-outlined text-[15px]">shopping_cart_checkout</span>
                    Lanjut ke Checkout
                  </Btn>
                  <Btn variant="ghost" size="sm" onClick={cart.clear}>
                    <span className="material-symbols-outlined text-[14px]">delete</span>Kosongkan keranjang
                  </Btn>
                  <p className="text-[10px] text-[#9ca3af] leading-relaxed">
                    Checkout membawa isi keranjang ini ke langkah Review, Payment, lalu Order.
                  </p>
                </div>
              </div>
            </Card>
          </aside>
        </div>
      )}
    </div>
  )
}

function SumRow({ label, value, bold, good }: { label: string; value: string; bold?: boolean; good?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className={`text-[11.5px] ${bold ? 'font-bold text-[#111827]' : 'text-[#6b7280]'}`}>{label}</span>
      <span style={PJ} className={`tabular-nums ${bold ? 'text-[14px] font-extrabold text-[#111827]' : `text-[11.5px] font-bold ${good ? 'text-[#3d8a5f]' : 'text-[#374151]'}`}`}>
        {value}
      </span>
    </div>
  )
}

function AccountPackage({
  account: a, rate, deliverables, qtyOf, onQty, onRemove,
}: {
  account: DirectoryAccount; rate: RateCard | undefined; deliverables: Deliverable[]
  qtyOf: (deliverableId: string) => number
  onQty: (deliverableId: string, qty: number) => void
  onRemove: () => void
}) {
  const base = rate?.baseRate ?? 0
  const price = (mult: number) => (base > 0 ? Math.round((base * mult) / 1000) * 1000 : 0)
  const subtotal = deliverables.reduce((n, d) => n + price(d.mult) * qtyOf(d.id), 0)

  return (
    <Card>
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
        <div style={{ ...PJ, background: gradientFor(a.username) }}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-[11px] font-extrabold">
          {a.username.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '??'}
        </div>
        <div className="flex-1 min-w-0">
          <div style={PJ} className="text-[12.5px] font-extrabold text-[#111827] truncate">{a.username}</div>
          <div className="flex items-center gap-1 text-[10.5px] text-[#9ca3af]">
            <span className="material-symbols-outlined text-[12px]">{PLATFORM_ICON[a.platform]}</span>
            <span className="capitalize">{a.platform}</span>
            <span className="text-[#d1d5db]">·</span>
            <span>base {base > 0 ? idr(base) : 'belum diatur'}</span>
          </div>
        </div>
        <div style={PJ} className="text-[13px] font-extrabold text-[#285D6E] tabular-nums">
          {subtotal > 0 ? idr(subtotal) : '—'}
        </div>
        <button type="button" onClick={onRemove} title="Hapus akun dari keranjang"
          className="material-symbols-outlined text-[16px] text-[#9ca3af] hover:text-[#c2553f] cursor-pointer">
          close
        </button>
      </div>

      <div className="px-4 pb-4">
        {base <= 0 ? (
          <p className="text-[11.5px] text-[#b5761f]">Rate card belum diatur — isi dulu di tab Rate Cards.</p>
        ) : deliverables.length === 0 ? (
          <p className="text-[11.5px] text-[#9ca3af]">Tidak ada deliverable untuk platform ini.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {deliverables.map(d => {
              const qty = qtyOf(d.id)
              return (
                <div key={d.id} className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 ${
                  qty > 0 ? 'border-[#327488] bg-[#f0f7fa]' : 'border-[#e5e7eb]'
                }`}>
                  <span className="material-symbols-outlined text-[16px] text-[#9ca3af]">{d.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div style={PJ} className="text-[12px] font-bold text-[#111827]">{d.label}</div>
                    <div className="text-[10.5px] text-[#9ca3af]">{idr(price(d.mult))} / post</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <StepBtn icon="remove" onClick={() => onQty(d.id, qty - 1)} disabled={qty <= 0} />
                    <span style={PJ} className="w-6 text-center text-[12px] font-extrabold text-[#111827] tabular-nums">{qty}</span>
                    <StepBtn icon="add" onClick={() => onQty(d.id, qty + 1)} />
                  </div>
                  <span style={PJ} className="w-24 text-right text-[11.5px] font-bold text-[#374151] tabular-nums">
                    {qty > 0 ? idr(price(d.mult) * qty) : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Card>
  )
}

function StepBtn({ icon, onClick, disabled }: { icon: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`w-6 h-6 rounded-md border flex items-center justify-center ${
        disabled ? 'border-[#f3f4f6] text-[#d1d5db] cursor-not-allowed'
                 : 'border-[#e5e7eb] text-[#6b7280] hover:border-[#327488] hover:text-[#285D6E]'
      }`}>
      <span className="material-symbols-outlined text-[13px]">{icon}</span>
    </button>
  )
}
