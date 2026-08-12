'use client'

/**
 * "Rate & Order" — the per-account half of the commercial flow.
 *
 * This is the connection the source platform had through its detail-page
 * header ("Add to Cart · from $X" / "Checkout"): ordering starts from the
 * creator you are already looking at, not from a separate screen. Set the
 * account's base rate here, then add deliverables straight to the shared cart;
 * because the cart is persisted per org (useDiscoverCart), what is added lands
 * in the workspace's Cart tab.
 *
 * Prices shown are derived from the *saved* rate, never the unsaved input — a
 * half-typed number must not look like a price you can order at.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardHead } from '@/components/dashboard/ui'
import { Btn, EmptyState, PJ, Spinner, fmtDate } from './ui'
import { useDiscoverCart } from './useDiscoverCart'
import type { AccountDetailPayload } from '@/lib/discover/account'
import type { Deliverable, RateCard } from '@/lib/discover/vocab'

const idr = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID')

export default function RateOrderSection({
  orgId, orgSlug, data,
}: { orgId: string; orgSlug: string; data: AccountDetailPayload }) {
  const a = data.account
  const [rate, setRate] = useState<RateCard | null>(null)
  const [deliverables, setDeliverables] = useState<Deliverable[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cart = useDiscoverCart(orgId)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/organizations/${orgId}/discover/rates`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { rates: Record<string, RateCard>; deliverables: Deliverable[] }) => {
        if (cancelled) return
        const mine = d.rates[a.id] ?? null
        setRate(mine)
        setDraft(mine && mine.baseRate > 0 ? mine.baseRate.toLocaleString('id-ID') : '')
        setDeliverables(d.deliverables.filter(x => x.platform === a.platform))
      })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [orgId, a.id, a.platform])

  const save = useCallback(async () => {
    // Accept "10.000.000" as readily as "10000000".
    const baseRate = Number(draft.replace(/[^\d]/g, ''))
    if (!Number.isFinite(baseRate) || baseRate < 0) { setError('Tarif harus angka positif.'); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/rates`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socialAccountId: a.id, baseRate }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      setRate(body.rates[a.id] ?? null)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setSaving(false)
    }
  }, [orgId, a.id, draft])

  if (loading || !cart.ready) return <Spinner />

  const typed = Number(draft.replace(/[^\d]/g, '')) || 0
  const saved = rate?.baseRate ?? 0
  const dirty = typed !== saved
  const price = (mult: number) => (saved > 0 ? Math.round((saved * mult) / 1000) * 1000 : 0)
  const unitsHere = cart.lines
    .filter(l => l.socialAccountId === a.id)
    .reduce((n, l) => n + l.qty, 0)

  return (
    <div className="flex flex-col gap-3.5">
      {error && (
        <div className="flex items-start gap-2 bg-[#fcefec] border border-[#f0c8bf] rounded-xl px-3.5 py-2.5">
          <span className="material-symbols-outlined text-[16px] text-[#c2553f] mt-0.5">error</span>
          <p className="text-[11.5px] text-[#c2553f]">{error}</p>
        </div>
      )}

      <Card>
        <CardHead title="Rate card" sub="Base rate akun ini — harga tiap deliverable dihitung dari angka ini" />
        <div className="px-4 pb-4 flex items-center gap-2 flex-wrap">
          <span className="text-[11.5px] text-[#9ca3af]">Rp</span>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="0"
            inputMode="numeric"
            className="w-44 h-8 px-2.5 rounded-lg border border-[#e5e7eb] text-[12px] text-right text-[#374151] tabular-nums focus:outline-none focus:border-[#327488]"
          />
          <Btn variant={dirty ? 'primary' : 'secondary'} size="sm" disabled={!dirty || saving} onClick={save}>
            {saving ? 'Menyimpan…' : 'Simpan tarif'}
          </Btn>
          {dirty && typed > 0 && (
            <span className="text-[10.5px] text-[#b5761f]">belum disimpan</span>
          )}
          {rate?.updatedAt && !dirty && (
            <span className="text-[10.5px] text-[#9ca3af]">terakhir diubah {fmtDate(rate.updatedAt)}</span>
          )}
        </div>
      </Card>

      <Card>
        <CardHead
          title="Tambah ke keranjang"
          sub={saved > 0
            ? 'Pilih deliverable dan jumlahnya — langsung masuk ke tab Cart'
            : 'Simpan base rate dulu supaya harganya bisa dihitung'}
          action={unitsHere > 0
            ? (
              <Link href={`/organizations/${orgSlug}/discover/kol?tab=cart`}>
                <Btn size="sm" variant="secondary">
                  <span className="material-symbols-outlined text-[14px]">shopping_cart</span>
                  Lihat keranjang ({unitsHere})
                </Btn>
              </Link>
            )
            : undefined}
        />
        <div className="px-4 pb-4">
          {saved <= 0 ? (
            <EmptyState icon="payments" title="Belum ada tarif"
              body="Isi base rate di atas untuk mulai memesan deliverable dari akun ini." />
          ) : deliverables.length === 0 ? (
            <p className="text-[11.5px] text-[#9ca3af]">Tidak ada deliverable untuk platform ini.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {deliverables.map(d => {
                const entry = { socialAccountId: a.id, relation: a.relation, deliverableId: d.id }
                const qty = cart.qtyOf(entry)
                return (
                  <div key={d.id} className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 ${
                    qty > 0 ? 'border-[#327488] bg-[#f0f7fa]' : 'border-[#e5e7eb]'
                  }`}>
                    <span className="material-symbols-outlined text-[16px] text-[#9ca3af]">{d.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div style={PJ} className="text-[12px] font-bold text-[#111827]">{d.label}</div>
                      <div className="text-[10.5px] text-[#9ca3af]">
                        {idr(price(d.mult))} / post <span className="text-[#d1d5db]">·</span> pengali x{d.mult}
                      </div>
                    </div>
                    {qty > 0 ? (
                      <div className="flex items-center gap-1">
                        <StepButton icon="remove" onClick={() => cart.setQty(entry, qty - 1)} />
                        <span style={PJ} className="w-6 text-center text-[12px] font-extrabold text-[#111827] tabular-nums">{qty}</span>
                        <StepButton icon="add" onClick={() => cart.setQty(entry, qty + 1)} />
                      </div>
                    ) : (
                      <Btn size="sm" variant="secondary" onClick={() => cart.add(entry)}>
                        <span className="material-symbols-outlined text-[14px]">add_shopping_cart</span>
                        Add to cart
                      </Btn>
                    )}
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
    </div>
  )
}

function StepButton({ icon, onClick }: { icon: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="w-6 h-6 rounded-md border border-[#e5e7eb] text-[#6b7280] hover:border-[#327488] hover:text-[#285D6E] flex items-center justify-center">
      <span className="material-symbols-outlined text-[13px]">{icon}</span>
    </button>
  )
}
