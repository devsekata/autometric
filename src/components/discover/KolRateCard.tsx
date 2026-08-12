'use client'

/**
 * Rate Card for the active KOL — pricing, packages, and the Add to Cart action.
 *
 * This is the hinge of the ordering flow: everything before it is discovery,
 * everything after it is transactional. So it shows what a buyer needs in order
 * to commit — unit price, what a package contains, which platform and format it
 * runs on, the reach that deliverable is expected to produce, and the terms —
 * rather than a bare number.
 *
 * Two things are deliberate:
 *   * Reach per package uses the same geometric-overlap model as the campaign
 *     estimate (0.65^n), so a 3-post bundle here shows the same number the cart
 *     and checkout will show. A rate card that disagrees with checkout is worse
 *     than no rate card.
 *   * Prices come from the *saved* base rate only. A half-typed edit never
 *     looks like something you can order at.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardHead } from '@/components/dashboard/ui'
import { Btn, EmptyState, PJ, PLATFORM_ICON, Spinner, fmtDate, fmtNum } from './ui'
import { ConfidenceBadge } from './credibility'
import { useDiscoverCart } from './useDiscoverCart'
import { DELIVERABLES, unitPrice, type Deliverable, type RateCard } from '@/lib/discover/vocab'
import { reachFor, engagementFor } from '@/lib/discover/campaign'
import type { KolProfile } from '@/lib/discover/profile'
import type { AccountDetailPayload } from '@/lib/discover/account'

const idr = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID')

/**
 * Bundles offered per deliverable. Multi-post bundles carry a small discount,
 * which is the normal shape of creator pricing and gives the buyer a reason to
 * commit to more than one post.
 */
const PACKAGES = [
  { id: 'single', label: 'Single', units: 1, discount: 0, note: '1 konten' },
  { id: 'duo', label: 'Duo', units: 2, discount: 0.05, note: '2 konten · hemat 5%' },
  { id: 'series', label: 'Series', units: 3, discount: 0.1, note: '3 konten · hemat 10%' },
] as const

const TERMS = [
  'Harga belum termasuk platform fee 8% dan PPN 11%, keduanya dihitung saat checkout.',
  'Brief, hashtag dan mention wajib dikirim lewat langkah Campaign Brief.',
  'Estimasi reach berasal dari performa historis akun, bukan jaminan hasil.',
  'Revisi konten mengikuti kesepakatan dengan kreator di luar sistem ini.',
  'Pembayaran diproses lewat payment gateway; data kartu tidak disimpan di sini.',
]

export default function KolRateCard({
  orgId, profile, data, onGoToCart,
}: {
  orgId: string
  orgSlug: string
  profile: KolProfile
  data: AccountDetailPayload
  onGoToCart: () => void
}) {
  const a = profile.account
  const [rate, setRate] = useState<RateCard | null>(null)
  const [draft, setDraft] = useState('')
  const [pkg, setPkg] = useState<(typeof PACKAGES)[number]['id']>('single')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)
  const cart = useDiscoverCart(orgId)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/organizations/${orgId}/discover/rates`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { rates: Record<string, RateCard> }) => {
        if (cancelled) return
        const mine = d.rates[a.id] ?? null
        setRate(mine)
        setDraft(mine && mine.baseRate > 0 ? mine.baseRate.toLocaleString('id-ID') : '')
      })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [orgId, a.id])

  const save = useCallback(async () => {
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

  const deliverables = useMemo(
    () => DELIVERABLES.filter(d => d.platform === a.platform), [a.platform])

  const saved = rate?.baseRate ?? 0
  const selectedPkg = PACKAGES.find(p => p.id === pkg)!

  const addToCart = (d: Deliverable) => {
    cart.add({ socialAccountId: a.id, relation: a.relation, deliverableId: d.id }, selectedPkg.units)
    setAdded(`${selectedPkg.units}× ${d.label} ditambahkan ke keranjang`)
    setTimeout(() => setAdded(null), 4000)
  }

  if (loading || !cart.ready) return <Spinner />

  const typed = Number(draft.replace(/[^\d]/g, '')) || 0
  const dirty = typed !== saved
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
      {added && (
        <div className="flex items-center gap-2 bg-[#eaf5ef] border border-[#bfe0cd] rounded-xl px-3.5 py-2.5">
          <span className="material-symbols-outlined text-[16px] text-[#3d8a5f]">check_circle</span>
          <p className="text-[11.5px] text-[#3d8a5f] flex-1">{added}</p>
          <Btn size="sm" variant="secondary" onClick={onGoToCart}>
            <span className="material-symbols-outlined text-[14px]">shopping_cart</span>
            Lihat keranjang ({unitsHere})
          </Btn>
        </div>
      )}

      {/* Context row: what this creator delivers, before any price is shown. */}
      <div className="grid grid-cols-4 gap-3">
        <Mini label="Platform" value={a.platform} icon={PLATFORM_ICON[a.platform] ?? 'public'} />
        <Mini label="Format utama" value={profile.topFormat.value} icon="movie" />
        <Mini label="Est. reach / konten" value={fmtNum(profile.estimatedReach.value)} icon="visibility"
          badge={<ConfidenceBadge confidence={profile.estimatedReach.confidence} basis={profile.estimatedReach.basis} compact />} />
        <Mini label="Engagement rate" value={`${profile.erPct.value.toFixed(2)}%`} icon="bolt"
          badge={<ConfidenceBadge confidence={profile.erPct.confidence} basis={profile.erPct.basis} compact />} />
      </div>

      <Card>
        <CardHead title="Base rate" sub="Semua harga paket dihitung dari angka ini" />
        <div className="px-4 pb-4 flex items-center gap-2 flex-wrap">
          <span className="text-[11.5px] text-[#9ca3af]">Rp</span>
          <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="0" inputMode="numeric"
            className="w-44 h-8 px-2.5 rounded-lg border border-[#e5e7eb] text-[12px] text-right text-[#374151] tabular-nums focus:outline-none focus:border-[#327488]" />
          <Btn variant={dirty ? 'primary' : 'secondary'} size="sm" disabled={!dirty || saving} onClick={save}>
            {saving ? 'Menyimpan…' : 'Simpan tarif'}
          </Btn>
          {dirty && typed > 0 && <span className="text-[10.5px] text-[#b5761f]">belum disimpan</span>}
          {rate?.updatedAt && !dirty && (
            <span className="text-[10.5px] text-[#9ca3af]">terakhir diubah {fmtDate(rate.updatedAt)}</span>
          )}
        </div>
      </Card>

      {saved <= 0 ? (
        <EmptyState icon="payments" title="Rate card belum diatur"
          body="Isi base rate di atas untuk melihat harga paket dan mulai memesan dari KOL ini." />
      ) : (
        <>
          <Card>
            <CardHead title="Paket konten" sub="Pilih paket, lalu tambahkan format yang diinginkan ke keranjang" />
            <div className="px-4 pb-4">
              <div className="flex flex-wrap gap-2 mb-3">
                {PACKAGES.map(p => {
                  const on = p.id === pkg
                  return (
                    <button key={p.id} type="button" onClick={() => setPkg(p.id)} style={PJ}
                      className={`flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2 min-w-[128px] transition-colors ${
                        on ? 'border-[#327488] bg-[#f0f7fa]' : 'border-[#e5e7eb] bg-white hover:border-[#A7C8D4]'
                      }`}>
                      <span className={`text-[12px] font-extrabold ${on ? 'text-[#285D6E]' : 'text-[#111827]'}`}>
                        {p.label}
                      </span>
                      <span className="text-[10px] text-[#9ca3af]">{p.note}</span>
                    </button>
                  )
                })}
              </div>

              <div className="flex flex-col gap-1.5">
                {deliverables.map(d => {
                  const unit = unitPrice(saved, d.mult)
                  const gross = unit * selectedPkg.units
                  const price = Math.round((gross * (1 - selectedPkg.discount)) / 1000) * 1000
                  const reach = reachFor(profile, selectedPkg.units)
                  const engagement = engagementFor(profile, selectedPkg.units)
                  const inCart = cart.qtyOf({ socialAccountId: a.id, relation: a.relation, deliverableId: d.id })
                  return (
                    <div key={d.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 flex-wrap ${
                      inCart > 0 ? 'border-[#327488] bg-[#f0f7fa]' : 'border-[#e5e7eb]'
                    }`}>
                      <span className="material-symbols-outlined text-[18px] text-[#9ca3af]">{d.icon}</span>
                      <div className="min-w-[150px]">
                        <div style={PJ} className="text-[12.5px] font-bold text-[#111827]">
                          {d.label} · {selectedPkg.label}
                        </div>
                        <div className="text-[10.5px] text-[#9ca3af] capitalize">
                          {a.platform} · {selectedPkg.units} konten · {idr(unit)}/konten
                        </div>
                      </div>
                      <div className="flex-1" />
                      <div className="text-right min-w-[92px]">
                        <div style={PJ} className="text-[11.5px] font-bold text-[#374151] tabular-nums">{fmtNum(reach)}</div>
                        <div className="text-[9.5px] text-[#9ca3af]">est. reach</div>
                      </div>
                      <div className="text-right min-w-[92px]">
                        <div style={PJ} className="text-[11.5px] font-bold text-[#374151] tabular-nums">{fmtNum(engagement)}</div>
                        <div className="text-[9.5px] text-[#9ca3af]">est. engagement</div>
                      </div>
                      <div className="text-right min-w-[110px]">
                        <div style={PJ} className="text-[13px] font-extrabold text-[#285D6E] tabular-nums">{idr(price)}</div>
                        {selectedPkg.discount > 0 && (
                          <div className="text-[9.5px] text-[#9ca3af] line-through tabular-nums">{idr(gross)}</div>
                        )}
                      </div>
                      <Btn size="sm" variant={inCart > 0 ? 'secondary' : 'primary'} onClick={() => addToCart(d)}>
                        <span className="material-symbols-outlined text-[14px]">add_shopping_cart</span>
                        {inCart > 0 ? `Tambah lagi (${inCart})` : 'Add to cart'}
                      </Btn>
                    </div>
                  )
                })}
              </div>

              <p className="text-[10.5px] text-[#9ca3af] mt-2.5">
                Harga paket dibulatkan ke ribuan terdekat. Reach memakai model tumpang-tindih audiens
                yang sama dengan checkout, jadi angkanya konsisten sampai pembayaran.
              </p>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3.5">
            <Card>
              <CardHead title="Syarat & ketentuan" />
              <div className="px-4 pb-4">
                <ul className="flex flex-col gap-1.5">
                  {TERMS.map((t, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11.5px] text-[#6b7280] leading-relaxed">
                      <span className="material-symbols-outlined text-[13px] text-[#9ca3af] mt-0.5">check</span>
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </Card>

            <Card>
              <CardHead title="Performa pendukung" sub="Dasar dari estimasi di atas" />
              <div className="px-4 pb-4 grid grid-cols-2 gap-3">
                <Mini label="Post tersinkron" value={String(profile.posts.value)} icon="grid_view" />
                <Mini label="Rata-rata views" value={fmtNum(profile.avgViews.value)} icon="visibility" />
                <Mini label="Rasio konten berbayar" value={`${profile.paidRatio.value.toFixed(0)}%`} icon="sell" />
                <Mini label="Brand fit" value={String(profile.brandFit.value)} icon="handshake" />
              </div>
              <div className="px-4 pb-4">
                <p className="text-[10.5px] text-[#9ca3af]">
                  Format terbaik berdasarkan ER: {
                    data.byFormat.slice().sort((x, y) => y.erPct - x.erPct)[0]?.label ?? '—'
                  }
                </p>
              </div>
            </Card>
          </div>

          {unitsHere > 0 && (
            <div className="flex items-center gap-2 bg-[#f0f7fa] border border-[#A7C8D4] rounded-xl px-3.5 py-2.5">
              <span className="material-symbols-outlined text-[16px] text-[#285D6E]">shopping_cart</span>
              <p className="text-[11.5px] text-[#285D6E] flex-1">
                <b>{unitsHere} konten</b> dari {a.username} ada di keranjang.
              </p>
              <Btn size="sm" variant="primary" onClick={onGoToCart}>
                Review keranjang
                <span className="material-symbols-outlined text-[14px]">chevron_right</span>
              </Btn>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Mini({
  label, value, icon, badge,
}: { label: string; value: string; icon: string; badge?: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#e5e7eb] rounded-xl px-3 py-2.5">
      <div className="flex items-center gap-1">
        <span className="material-symbols-outlined text-[13px] text-[#9ca3af]">{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#9ca3af]">{label}</span>
        {badge}
      </div>
      <div style={PJ} className="text-[14px] font-extrabold text-[#111827] mt-1 tabular-nums capitalize">{value}</div>
    </div>
  )
}
