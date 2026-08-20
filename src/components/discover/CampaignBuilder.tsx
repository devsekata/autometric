'use client'

/**
 * Ordering Flow — three steps, in the order the buyer actually decides things:
 *
 *   1  Creator Selection & Rate Card   who, on which platform, what deliverables,
 *                                      how many, at what price, for what estimate
 *   2  Campaign Information & Brief    name, objective, window, brief, key message,
 *                                      deadline, hashtags, mentions, inspirations,
 *                                      and a per-creator target
 *   3  Order Summary & Payment         the full breakdown, payment method, pay
 *
 * It used to be six steps (Setup → Brief → Budget → Review → Checkout → Payment),
 * which split one decision across two screens twice over: creators were chosen in
 * "Setup" but priced in "Budget", and the order was summarised in "Review" and
 * then again in "Checkout". Three steps is not a cosmetic merge — it is one screen
 * per decision the buyer has to make.
 *
 * One component holding one draft, because the steps share a single object and
 * splitting them across routes would mean serialising a half-built campaign
 * between every screen. The draft persists per org in localStorage, so leaving to
 * check a KOL's profile mid-build and coming back does not lose the work.
 *
 * Budget is not decorative: it drives `optimiseSelection`, which picks
 * deliverables under the cap, and every downstream figure — reach, engagement,
 * cost per reach, cost per engagement, predicted success — recomputes from the
 * resulting selection.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardHead } from '@/components/dashboard/ui'
import { Btn, Chip, EmptyState, PJ, PLATFORM_ICON, Spinner, fmtNum, gradientFor } from './ui'
import { ConfidenceBadge } from './credibility'
import { useDiscoverSelection } from './useDiscoverSelection'
import type { KolDirectoryRow } from '@/lib/discover/kolDirectory'
import { useDiscoverCart } from './useDiscoverCart'
import { AGE_BANDS } from '@/lib/discover/vocab'
import type { KolProfile } from '@/lib/discover/profile'
import type { DiscoverContentPayload, DiscoverPost } from '@/lib/discover/types'
import {
  estimateCampaign, optimiseSelection, predictSuccess, reachFor, engagementFor,
  type SelectedKol,
} from '@/lib/discover/campaign'
import { DELIVERABLES, type Deliverable } from '@/lib/discover/vocab'
import PaymentStep from './PaymentStep'

const idr = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID')
const initials = (s: string) => s.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '??'

const STEPS = [
  { id: 1, label: 'Creator Selection & Rate Card', icon: 'groups' },
  { id: 2, label: 'Campaign Information & Brief', icon: 'description' },
  { id: 3, label: 'Order Summary & Payment', icon: 'shopping_cart_checkout' },
] as const

const LAST_STEP = 3

const OBJECTIVES = ['Awareness', 'Consideration', 'Conversion', 'Engagement', 'Loyalty'] as const

/**
 * Payment rails offered at Step 3.
 *
 * Card and bank transfer both hand off to the gateway's hosted page — the choice
 * here is recorded and passed along, but the provider still presents its own
 * final list. Invoice is genuinely different: it creates the order unpaid and
 * settles outside the system, which is how agency billing usually works.
 */
const PAYMENT_METHODS = [
  { id: 'card', label: 'Credit Card', icon: 'credit_card',
    note: 'Bayar sekarang lewat payment gateway. Data kartu tidak melewati Autometric.' },
  { id: 'bank_transfer', label: 'Bank Transfer', icon: 'account_balance',
    note: 'Virtual account dari payment gateway. Order aktif setelah dana dikonfirmasi.' },
  { id: 'invoice', label: 'Invoice', icon: 'receipt_long',
    note: 'Order dibuat tanpa pembayaran online. Tagihan ditagihkan terpisah sesuai term.' },
] as const

type PaymentMethodId = (typeof PAYMENT_METHODS)[number]['id']

/** Per-creator goal. Empty fields inherit the campaign-level objective. */
export interface CreatorTarget {
  objective: string
  reach: number
  engagement: number
}

interface Draft {
  step: number
  name: string
  objective: string
  brief: string
  keyMessage: string
  deadline: string
  hashtags: string
  mentions: string
  startDate: string
  endDate: string
  budget: number
  goalReach: number
  goalEngagement: number
  targetAges: string[]
  targetGender: 'all' | 'female' | 'male'
  /** `${accountId}:${deliverableId}` -> qty */
  units: Record<string, number>
  /**
   * `${accountId}:${deliverableId}` -> negotiated unit price. Absent means "use
   * the rate card", which is why this is a sparse map rather than a full copy of
   * every price: a rate card that later changes should move the untouched lines
   * with it, and only the deliberately-negotiated ones should stay put.
   */
  customPrices: Record<string, number>
  /** accountId -> its own objective and KPI. Absent means "same as campaign". */
  targets: Record<string, CreatorTarget>
  /** Discovery posts attached to the brief as reference. */
  inspirations: { source: string; postRowId: number; platform: string }[]
  paymentMethod: PaymentMethodId
  /** Carried from the Cart; applied by the server when the order is created. */
  promoCode: string
  /** Set once Checkout creates the order; the flow then continues to Payment. */
  orderId: number | null
  /**
   * Whether this draft has already taken the cart's contents. Adoption happens
   * exactly once per draft: re-adopting on every visit would silently undo a
   * deliberate removal, and never adopting is what made Cart → Checkout arrive
   * at an empty plan.
   */
  cartAdopted: boolean
}

const EMPTY: Draft = {
  step: 1, name: 'Campaign baru', objective: 'Awareness', brief: '', keyMessage: '',
  deadline: '', hashtags: '', mentions: '',
  startDate: '', endDate: '', budget: 0, goalReach: 0, goalEngagement: 0,
  targetAges: [], targetGender: 'all', units: {}, customPrices: {}, targets: {},
  inspirations: [], paymentMethod: 'card', promoCode: '',
  orderId: null, cartAdopted: false,
}

function useDraft(orgId: string) {
  const key = `autometric:discover:campaigndraft:${orgId}`
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw) setDraft({ ...EMPTY, ...JSON.parse(raw) })
    } catch { /* ignore */ }
    setReady(true)
  }, [key])

  const update = useCallback((patch: Partial<Draft>) => {
    setDraft(prev => {
      const next = { ...prev, ...patch }
      try { window.localStorage.setItem(key, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [key])

  const clear = useCallback(() => {
    setDraft(EMPTY)
    try { window.localStorage.removeItem(key) } catch { /* ignore */ }
  }, [key])

  return { draft, update, clear, ready }
}

export default function CampaignBuilder({
  orgId, orgSlug, onGoToRates, onGoToCart, onGoToDirectory, seed,
}: {
  orgId: string
  orgSlug: string
  onGoToRates?: () => void
  onGoToCart?: () => void
  onGoToDirectory?: () => void
  /**
   * Campaign context chosen in the Cart before pressing Checkout. The cart asks
   * for an objective and a name; without carrying them here the user was asked
   * the same two questions again one screen later.
   */
  seed?: { objective?: string; name?: string; promoCode?: string }
}) {
  const [profiles, setProfiles] = useState<KolProfile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { draft, update, clear, ready } = useDraft(orgId)
  const shortlist = useDiscoverSelection(orgId, 'compare')
  const cart = useDiscoverCart(orgId)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/organizations/${orgId}/discover/profiles`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { profiles: KolProfile[] }) => { if (!cancelled) setProfiles(d.profiles) })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })
    return () => { cancelled = true }
  }, [orgId])

  /**
   * The candidate pool is the shortlist *plus* whatever is in the cart.
   *
   * Those are two different ways of saying "I want this creator in the
   * campaign", and the flow offers both: Compare shortlists a creator, the Rate
   * Card puts a priced package in the cart. Reading only the shortlist meant a
   * user who went Directory → Rate Card → Cart → Checkout — the path the cart's
   * own button recommends — landed on "shortlist a KOL first" with an empty
   * plan and no way to see why.
   */
  /**
   * Roster creators sitting in the cart.
   *
   * They cannot join `pool`: that is `KolProfile[]`, built from collected posts,
   * and a roster creator has none — inventing one to fit the type is exactly the
   * fabrication this codebase refuses. So they travel alongside it, priced by
   * the server like every other line, shown read-only here and edited back in
   * the Cart tab where their quantities came from.
   *
   * Without this they were priced in the cart, previewed in the cart, and then
   * silently dropped from the order the flow actually creates.
   */
  const rosterCartIds = useMemo(
    () => [...new Set(Object.values(cart.items)
      .filter(l => l.relation === 'roster')
      .map(l => l.socialAccountId))].sort().join(','),
    [cart.items])

  const [rosterPool, setRosterPool] = useState<KolDirectoryRow[]>([])

  useEffect(() => {
    if (!rosterCartIds) { setRosterPool([]); return }
    let cancelled = false
    fetch(`/api/organizations/${orgId}/discover/kol-directory?ids=${rosterCartIds}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { rows: KolDirectoryRow[] }) => { if (!cancelled) setRosterPool(d.rows) })
      .catch(() => { /* the order still carries them; only the preview row is lost */ })
    return () => { cancelled = true }
  }, [orgId, rosterCartIds])

  /** Cart lines for roster creators, exactly as they will be ordered. */
  const rosterLines = useMemo(
    () => Object.values(cart.items).filter(l => l.relation === 'roster'),
    [cart.items])

  const pool = useMemo(() => {
    // `cart.items` rather than `cart.accountIds`: the latter is rebuilt on every
    // render, which would defeat this memo and every one downstream of it.
    const wanted = new Set([
      ...shortlist.ids,
      ...Object.values(cart.items).map(l => l.socialAccountId),
    ])
    return (profiles ?? []).filter(p => wanted.has(p.account.id))
  }, [profiles, shortlist.ids, cart.items])

  /**
   * Adopt the cart into a fresh draft: its lines become the plan's deliverables
   * and the objective/name chosen at checkout become the campaign's. Runs once
   * per draft (guarded by `cartAdopted`) and never after an order exists, so an
   * intentional edit is not overwritten on the next visit.
   */
  useEffect(() => {
    if (!ready || !cart.ready || draft.cartAdopted || draft.orderId !== null) return
    const lines = Object.values(cart.items)
    if (lines.length === 0 && !seed) return

    const units = { ...draft.units }
    for (const line of lines) {
      const key = `${line.socialAccountId}:${line.deliverableId}`
      // Keep the larger of the two: a draft quantity the user already set is a
      // more recent statement of intent than the cart's.
      units[key] = Math.max(units[key] ?? 0, line.qty)
    }
    update({
      units,
      cartAdopted: true,
      ...(seed?.objective ? { objective: seed.objective } : {}),
      ...(seed?.name?.trim() ? { name: seed.name.trim() } : {}),
      ...(seed?.promoCode?.trim() ? { promoCode: seed.promoCode.trim() } : {}),
    })
  }, [ready, cart.ready, cart.items, draft.cartAdopted, draft.orderId, draft.units, seed, update])

  /** The rate-card price, before any negotiation. */
  const listPriceOf = useCallback((p: KolProfile, d: Deliverable) =>
    (p.hasRate ? Math.round((p.baseRate * d.mult) / 1000) * 1000 : 0), [])

  /**
   * The price this line will actually be charged at. Everything downstream —
   * the estimate, the optimiser, the summary, the order — reads this one
   * function, so a negotiated rate cannot show up in some totals and not others.
   */
  const unitPriceOf = useCallback((p: KolProfile, d: Deliverable) => {
    const custom = draft.customPrices[`${p.account.id}:${d.id}`]
    return Number.isFinite(custom) && custom >= 0 ? custom : listPriceOf(p, d)
  }, [draft.customPrices, listPriceOf])

  /** Draft units resolved into priced selections. */
  const selected: SelectedKol[] = useMemo(() => {
    const byAccount = new Map<string, SelectedKol>()
    for (const [key, qty] of Object.entries(draft.units)) {
      if (qty <= 0) continue
      const [accountId, deliverableId] = key.split(':')
      const profile = pool.find(p => p.account.id === accountId)
      const deliverable = DELIVERABLES.find(d => d.id === deliverableId)
      if (!profile || !deliverable) continue
      const cost = unitPriceOf(profile, deliverable) * qty
      const cur = byAccount.get(accountId)
      byAccount.set(accountId, {
        profile,
        units: (cur?.units ?? 0) + qty,
        cost: (cur?.cost ?? 0) + cost,
      })
    }
    return [...byAccount.values()]
  }, [draft.units, pool, unitPriceOf])

  const estimate = useMemo(() => estimateCampaign(selected), [selected])
  const prediction = useMemo(
    () => predictSuccess(selected, { targetAges: draft.targetAges, targetGender: draft.targetGender }),
    [selected, draft.targetAges, draft.targetGender])

  /** Let the budget choose the mix — the whole point of asking for a number. */
  const runOptimiser = useCallback(() => {
    if (draft.budget <= 0 || pool.length === 0) return
    const candidates = pool.flatMap(p => {
      // Cheapest deliverable per creator keeps the optimiser comparing like for like.
      const options = DELIVERABLES
        .filter(d => d.platform === p.account.platform)
        .map(d => ({ d, price: unitPriceOf(p, d) }))
        .filter(x => x.price > 0)
        .sort((a, b) => a.price - b.price)
      return options.length ? [{ profile: p, unitCost: options[0].price, deliverable: options[0].d }] : []
    })
    const result = optimiseSelection(
      candidates.map(c => ({ profile: c.profile, unitCost: c.unitCost })), draft.budget)

    const units: Record<string, number> = {}
    for (const picked of result.picked) {
      const c = candidates.find(x => x.profile.account.id === picked.profile.account.id)
      if (c) units[`${picked.profile.account.id}:${c.deliverable.id}`] = picked.units
    }
    update({ units })
  }, [draft.budget, pool, unitPriceOf, update])

  const submit = async () => {
    setSaving(true); setError(null)
    try {
      const lines = Object.entries(draft.units)
        .filter(([, qty]) => qty > 0)
        .flatMap(([key, qty]) => {
          const [accountId, deliverableId] = key.split(':')
          const profile = pool.find(p => p.account.id === accountId)
          if (!profile) return []
          const custom = draft.customPrices[key]
          const t = draft.targets[accountId]
          return [{
            socialAccountId: accountId, relation: profile.account.relation,
            deliverableId, qty,
            unitPriceOverride: Number.isFinite(custom) && custom >= 0 ? custom : null,
            // The per-creator target rides on every line of that creator; the
            // server stores it per item, which is the grain the campaign
            // dashboard reports progress at.
            target: t ? { objective: t.objective || null, reach: t.reach || null, engagement: t.engagement || null } : null,
          }]
        })

      // Roster lines go in untouched: quantity comes from the cart, and the
      // server prices them from the roster rate card the same way it prices an
      // account from its rate card.
      const allLines = [
        ...lines,
        ...rosterLines.map(l => ({
          socialAccountId: l.socialAccountId,
          relation: l.relation,
          deliverableId: l.deliverableId,
          qty: l.qty,
          unitPriceOverride: null,
          target: null,
        })),
      ]

      const res = await fetch(`/api/organizations/${orgId}/discover/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name, lines: allLines,
          promoCode: draft.promoCode.trim() || null,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)

      // Freeze the campaign context and the estimate that justified the spend.
      await fetch(`/api/organizations/${orgId}/discover/orders/${body.id}/campaign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective: draft.objective, brief: draft.brief,
          keyMessage: draft.keyMessage || null, deadline: draft.deadline || null,
          paymentMethod: draft.paymentMethod,
          inspirations: draft.inspirations,
          hashtags: draft.hashtags, mentions: draft.mentions,
          startDate: draft.startDate || null, endDate: draft.endDate || null,
          budget: draft.budget || null,
          goalReach: draft.goalReach || null, goalEngagement: draft.goalEngagement || null,
          targetAges: draft.targetAges, targetGender: draft.targetGender,
          estReach: estimate.reach, estEngagement: estimate.engagement, estEmv: estimate.emv,
          successRate: prediction.rate, successFactors: prediction.factors,
          // The order exists, so the campaign has left "draft" — it is now a
          // plan waiting on money rather than a document being edited.
          campaignStatus: 'planning',
        }),
      })

      // Checkout consumes the cart. Leaving it full would re-adopt the same
      // lines into the next campaign the user starts.
      cart.clear()

      // Stay on Step 3: the draft keeps the orderId, so the step swaps its
      // summary for the payment panel instead of bouncing to another page.
      update({ orderId: body.id })
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setSaving(false)
    }
  }

  if (error && !profiles) return <div className="text-[12px] text-[#c2553f]">{error}</div>
  if (!profiles || !ready || !shortlist.ready) return <Spinner />

  const step = Math.min(LAST_STEP, Math.max(1, draft.step))
  // Once the order exists the earlier steps are history — editing them would
  // silently diverge from what was actually ordered.
  const locked = draft.orderId !== null
  const canAdvance = step === 1 ? selected.length > 0 : true

  return (
    <div>
      {/* stepper */}
      <div className="flex items-center gap-1 mb-4 flex-wrap">
        {STEPS.map((s, i) => {
          const done = step > s.id
          const on = step === s.id
          // With an order created only the final step is live; the two before it
          // describe decisions already committed to the order.
          const reachable = !locked || s.id === LAST_STEP
          return (
            <div key={s.id} className="flex items-center">
              <button type="button" disabled={!reachable}
                onClick={() => { if (reachable) update({ step: s.id }) }} style={PJ}
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11.5px] font-bold transition-colors ${
                  on ? 'bg-[#327488] text-white'
                    : done ? 'bg-[#f0f7fa] text-[#285D6E]'
                    : 'bg-white border border-[#e5e7eb] text-[#9ca3af]'
                } ${reachable ? '' : 'opacity-60 cursor-not-allowed'}`}>
                <span style={PJ} className={`w-4 h-4 rounded-full inline-flex items-center justify-center text-[9px] ${
                  on ? 'bg-white/25' : done ? 'bg-[#285D6E] text-white' : 'bg-[#f3f4f6]'
                }`}>
                  {done ? <span className="material-symbols-outlined text-[11px]">check</span> : s.id}
                </span>
                {s.label}
              </button>
              {i < STEPS.length - 1 && <span className="w-4 h-px bg-[#e5e7eb]" />}
            </div>
          )
        })}
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-[#fcefec] border border-[#f0c8bf] rounded-xl px-3.5 py-2.5 mb-3.5">
          <span className="material-symbols-outlined text-[16px] text-[#c2553f] mt-0.5">error</span>
          <p className="text-[11.5px] text-[#c2553f]">{error}</p>
        </div>
      )}

      <div className="grid gap-4 items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) 300px' }}>
        <div className="min-w-0 flex flex-col gap-3.5">
          {step === 1 && (
            <>
              <CreatorSelectionStep draft={draft} update={update} pool={pool} selected={selected}
                estimate={estimate} unitPriceOf={unitPriceOf} listPriceOf={listPriceOf}
                onOptimise={runOptimiser} onGoToRates={onGoToRates} />
              <RosterFromCart rows={rosterPool} lines={rosterLines} onGoToCart={onGoToCart} />
            </>
          )}
          {step === 3 && draft.orderId === null && (
            <RosterFromCart rows={rosterPool} lines={rosterLines} onGoToCart={onGoToCart} />
          )}
          {step === 2 && (
            <CampaignInfoStep orgId={orgId} draft={draft} update={update} selected={selected} />
          )}
          {step === 3 && draft.orderId === null && (
            <OrderSummaryStep draft={draft} selected={selected} estimate={estimate}
              prediction={prediction} saving={saving} onSubmit={submit}
              onPromoChange={v => update({ promoCode: v })}
              onMethodChange={m => update({ paymentMethod: m })} />
          )}
          {step === 3 && draft.orderId !== null && (
            <PaymentStep orgId={orgId} orgSlug={orgSlug} orderId={draft.orderId}
              onDone={clear} />
          )}
        </div>

        <aside className="sticky top-4 flex flex-col gap-3.5">
          <Card>
            <CardHead title="Ringkasan" sub={`${selected.length} KOL · ${estimate.totalUnits} deliverable`} />
            <div className="px-4 pb-4 flex flex-col gap-1">
              <Row label="Est. reach" value={fmtNum(estimate.reach)} />
              <Row label="Est. engagement" value={fmtNum(estimate.engagement)} />
              <Row label="Cost / reach" value={estimate.costPerReach > 0 ? idr(estimate.costPerReach) : '—'} />
              <Row label="Cost / engagement" value={estimate.costPerEngagement > 0 ? idr(estimate.costPerEngagement) : '—'} />
              <div className="border-t border-[#e5e7eb] mt-1.5 pt-1.5">
                <Row label="Total biaya" value={idr(estimate.totalCost)} bold />
              </div>
              {draft.budget > 0 && (
                <p className={`text-[10.5px] mt-1 ${
                  estimate.totalCost > draft.budget ? 'text-[#c2553f]' : 'text-[#3d8a5f]'
                }`}>
                  {estimate.totalCost > draft.budget
                    ? `Melebihi budget ${idr(estimate.totalCost - draft.budget)}`
                    : `Sisa budget ${idr(draft.budget - estimate.totalCost)}`}
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHead title="Predicted success" sub="Diperbarui otomatis dari pilihan KOL" />
            <div className="px-4 pb-4">
              <SuccessGauge rate={prediction.rate} band={prediction.band} />
            </div>
          </Card>

          <div className={`flex items-center gap-2 ${locked ? 'hidden' : ''}`}>
            <Btn variant="secondary" disabled={step <= 1} onClick={() => update({ step: step - 1 })}>
              <span className="material-symbols-outlined text-[15px]">chevron_left</span>Kembali
            </Btn>
            {step < LAST_STEP && (
              <Btn variant="primary" disabled={!canAdvance} onClick={() => update({ step: step + 1 })}>
                Lanjut<span className="material-symbols-outlined text-[15px]">chevron_right</span>
              </Btn>
            )}
          </div>
          {!canAdvance && !locked && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[10.5px] text-[#b5761f]">
                {pool.length === 0
                  ? 'Belum ada KOL di order ini. Shortlist KOL lewat Compare, atau masukkan paketnya ke Cart dari Rate Card.'
                  : 'Pilih minimal satu deliverable untuk salah satu creator.'}
              </p>
              {pool.length === 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {onGoToDirectory && (
                    <Btn size="sm" variant="secondary" onClick={onGoToDirectory}>
                      <span className="material-symbols-outlined text-[14px]">person_search</span>Buka Discovery
                    </Btn>
                  )}
                  {onGoToCart && (
                    <Btn size="sm" variant="ghost" onClick={onGoToCart}>
                      <span className="material-symbols-outlined text-[14px]">shopping_cart</span>Lihat Cart
                    </Btn>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
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

export function SuccessGauge({ rate, band }: { rate: number; band: string }) {
  const color = rate >= 80 ? '#3d8a5f' : rate >= 65 ? '#4E96AC' : rate >= 50 ? '#e0a458' : '#c2553f'
  return (
    <div className="flex items-center gap-3">
      <div className="relative w-16 h-16 flex-shrink-0">
        <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f3f4f6" strokeWidth="3.4" />
          <circle cx="18" cy="18" r="15.9" fill="none" stroke={color} strokeWidth="3.4"
            strokeDasharray={`${Math.max(0, Math.min(100, rate))} 100`} strokeLinecap="round" />
        </svg>
        <span style={PJ}
          className="absolute inset-0 flex items-center justify-center text-[15px] font-extrabold text-[#111827]">
          {rate}%
        </span>
      </div>
      <div>
        <div style={{ ...PJ, color }} className="text-[13px] font-extrabold">{band}</div>
        <div className="text-[10.5px] text-[#9ca3af]">Predicted success rate</div>
      </div>
    </div>
  )
}

/* ── steps ────────────────────────────────────────────────────────────────── */

/* ── step 1: Creator Selection & Rate Card ────────────────────────────────── */

/**
 * Who is in the order, on what platform, with which deliverables, at what price.
 *
 * The creator's rate card is shown inline and each line's price is editable,
 * because negotiated rates are the norm in this business and a flow that can
 * only order at list price sends people back to a spreadsheet. An edited price
 * keeps the list price visible next to it — the deviation is the interesting
 * number, not the new one on its own.
 */
function CreatorSelectionStep({
  draft, update, pool, selected, estimate, unitPriceOf, listPriceOf, onOptimise, onGoToRates,
}: {
  draft: Draft; update: (p: Partial<Draft>) => void; pool: KolProfile[]
  selected: SelectedKol[]; estimate: ReturnType<typeof estimateCampaign>
  unitPriceOf: (p: KolProfile, d: Deliverable) => number
  listPriceOf: (p: KolProfile, d: Deliverable) => number
  onOptimise: () => void; onGoToRates?: () => void
}) {
  const unrated = pool.filter(p => !p.hasRate)
  const rated = pool.filter(p => p.hasRate)

  const setQty = (key: string, qty: number) =>
    update({ units: { ...draft.units, [key]: Math.max(0, qty) } })

  const setPrice = (key: string, value: number | null) => {
    const next = { ...draft.customPrices }
    if (value === null) delete next[key]
    else next[key] = Math.max(0, Math.round(value))
    update({ customPrices: next })
  }

  return (
    <>
      <Card>
        <CardHead title="Budget & optimasi"
          sub="Budget bukan catatan: ia dipakai untuk menyusun kombinasi deliverable" />
        <div className="px-4 pb-4 flex items-end gap-2 flex-wrap">
          <Field label="Budget campaign (Rp)">
            <input type="number" min={0} step={1_000_000} value={draft.budget || ''} placeholder="0"
              onChange={e => update({ budget: Number(e.target.value) || 0 })} className={`${INPUT} w-52`} />
          </Field>
          <Btn variant="primary" disabled={draft.budget <= 0 || rated.length === 0} onClick={onOptimise}>
            <span className="material-symbols-outlined text-[15px]">auto_awesome</span>
            Optimalkan pilihan
          </Btn>
          <Btn variant="ghost" onClick={() => update({ units: {} })}>
            <span className="material-symbols-outlined text-[15px]">restart_alt</span>Kosongkan
          </Btn>
        </div>
        <div className="px-4 pb-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          <Mini label="Creator" value={String(estimate.creators)} />
          <Mini label="Est. reach" value={fmtNum(estimate.reach)} />
          <Mini label="Est. engagement" value={fmtNum(estimate.engagement)} />
          <Mini label="Cost / reach" value={estimate.costPerReach > 0 ? idr(estimate.costPerReach) : '—'} />
          <Mini label="Total biaya" value={idr(estimate.totalCost)} strong />
        </div>
      </Card>

      {unrated.length > 0 && (
        <div className="flex items-start gap-2 bg-[#fdf3e7] border border-[#eed9bb] rounded-xl px-3.5 py-2.5">
          <span className="material-symbols-outlined text-[16px] text-[#b5761f] mt-0.5">info</span>
          <p className="text-[11.5px] text-[#b5761f] flex-1">
            {unrated.length} KOL belum punya rate card jadi belum bisa dipesan:{' '}
            <b>{unrated.map(p => p.account.username).join(', ')}</b>
          </p>
          {onGoToRates && <Btn size="sm" variant="secondary" onClick={onGoToRates}>Atur tarif</Btn>}
        </div>
      )}

      {rated.length === 0 && unrated.length === 0 && (
        <EmptyState icon="group_add" title="Belum ada creator"
          body="Shortlist creator lewat Compare, atau tambahkan paketnya ke Cart dari Rate Card." />
      )}

      {rated.map(p => {
        const opts = DELIVERABLES.filter(d => d.platform === p.account.platform)
        const mine = selected.find(s => s.profile.account.id === p.account.id)
        const inOrder = !!mine
        return (
          <Card key={p.account.id} className={inOrder ? 'border-[#A7C8D4]' : ''}>
            <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
              <div style={{ ...PJ, background: gradientFor(p.account.username) }}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-[11px] font-extrabold">
                {initials(p.account.username)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span style={PJ} className="text-[12.5px] font-extrabold text-[#111827] truncate">
                    {p.account.username}
                  </span>
                  {inOrder && (
                    <span style={PJ} className="text-[9px] font-extrabold uppercase tracking-wide rounded px-1.5 py-0.5 bg-[#eaf5ef] text-[#3d8a5f]">
                      Di order
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 text-[10.5px] text-[#9ca3af] flex-wrap">
                  <span className="material-symbols-outlined text-[12px]">{PLATFORM_ICON[p.account.platform]}</span>
                  <span className="capitalize">{p.account.platform}</span>
                  <span className="text-[#d1d5db]">·</span>
                  <span>fit {p.brandFit.value}</span>
                  <span className="text-[#d1d5db]">·</span>
                  <span>reach/post {fmtNum(p.estimatedReach.value)}</span>
                  <span className="text-[#d1d5db]">·</span>
                  <span>rate {idr(p.baseRate)}</span>
                </div>
              </div>
              {mine && (
                <div className="text-right">
                  <div style={PJ} className="text-[13px] font-extrabold text-[#285D6E] tabular-nums">{idr(mine.cost)}</div>
                  <div className="text-[9.5px] text-[#9ca3af]">
                    {fmtNum(reachFor(p, mine.units))} reach · {fmtNum(engagementFor(p, mine.units))} eng
                  </div>
                </div>
              )}
            </div>

            <div className="px-4 pb-4 flex flex-col gap-1.5">
              {opts.map(d => {
                const key = `${p.account.id}:${d.id}`
                const qty = draft.units[key] ?? 0
                const list = listPriceOf(p, d)
                const price = unitPriceOf(p, d)
                const custom = draft.customPrices[key] !== undefined
                return (
                  <div key={d.id} className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 flex-wrap ${
                    qty > 0 ? 'border-[#327488] bg-[#f0f7fa]' : 'border-[#e5e7eb]'
                  }`}>
                    <span className="material-symbols-outlined text-[16px] text-[#9ca3af]">{d.icon}</span>
                    <div className="flex-1 min-w-[120px]">
                      <div style={PJ} className="text-[12px] font-bold text-[#111827]">{d.label}</div>
                      <div className="text-[10.5px] text-[#9ca3af]">
                        Rate card {idr(list)} · x{d.mult}
                      </div>
                    </div>

                    {/* Custom pricing. The rate card stays on screen beside it so
                        a negotiated number is always read as a deviation. */}
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-[#9ca3af]">Rp</span>
                      <input
                        type="number" min={0} step={100_000}
                        value={custom ? draft.customPrices[key] : list}
                        onChange={e => {
                          const v = Number(e.target.value)
                          setPrice(key, Number.isFinite(v) ? v : null)
                        }}
                        className={`w-28 h-7 px-2 rounded-lg border text-[11.5px] tabular-nums focus:outline-none focus:border-[#327488] ${
                          custom ? 'border-[#e0a458] bg-[#fdf9f3] text-[#b5761f] font-bold' : 'border-[#e5e7eb] text-[#374151]'
                        }`}
                      />
                      {custom && (
                        <button type="button" onClick={() => setPrice(key, null)} title="Kembali ke rate card"
                          className="w-6 h-6 flex items-center justify-center rounded text-[#b5761f] hover:bg-[#fdf3e7]">
                          <span className="material-symbols-outlined text-[14px]">undo</span>
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <Step icon="remove" onClick={() => setQty(key, qty - 1)} />
                      <span style={PJ} className="w-6 text-center text-[12px] font-extrabold text-[#111827] tabular-nums">{qty}</span>
                      <Step icon="add" onClick={() => setQty(key, qty + 1)} />
                    </div>
                    <span style={PJ} className="w-28 text-right text-[11.5px] font-bold text-[#374151] tabular-nums">
                      {qty > 0 ? idr(price * qty) : '—'}
                    </span>
                  </div>
                )
              })}
            </div>
          </Card>
        )
      })}
    </>
  )
}

/* ── step 2: Campaign Information & Brief ─────────────────────────────────── */

function CampaignInfoStep({
  orgId, draft, update, selected,
}: {
  orgId: string
  draft: Draft
  update: (p: Partial<Draft>) => void
  selected: SelectedKol[]
}) {
  return (
    <>
      <Card>
        <CardHead title="Campaign information" sub="Nama, tujuan, jadwal dan target audiens" />
        <div className="px-4 pb-4 grid grid-cols-2 gap-3">
          <Field label="Nama campaign">
            <input value={draft.name} onChange={e => update({ name: e.target.value })} className={INPUT} />
          </Field>
          <Field label="Campaign objective">
            <select value={draft.objective} onChange={e => update({ objective: e.target.value })} className={INPUT}>
              {OBJECTIVES.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Mulai">
            <input type="date" value={draft.startDate} onChange={e => update({ startDate: e.target.value })} className={INPUT} />
          </Field>
          <Field label="Selesai">
            <input type="date" value={draft.endDate} min={draft.startDate || undefined}
              onChange={e => update({ endDate: e.target.value })} className={INPUT} />
          </Field>
          <Field label="Deadline konten">
            <input type="date" value={draft.deadline} onChange={e => update({ deadline: e.target.value })} className={INPUT} />
          </Field>
          <Field label="Goal reach">
            <input type="number" min={0} value={draft.goalReach || ''} placeholder="0"
              onChange={e => update({ goalReach: Number(e.target.value) || 0 })} className={INPUT} />
          </Field>
          <Field label="Goal engagement">
            <input type="number" min={0} value={draft.goalEngagement || ''} placeholder="0"
              onChange={e => update({ goalEngagement: Number(e.target.value) || 0 })} className={INPUT} />
          </Field>
        </div>

        <div className="px-4 pb-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span style={PJ} className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af]">Target umur</span>
            <ConfidenceBadge confidence="estimated" basis="Demografi audiens dimodelkan — dipakai untuk faktor demographic match" compact />
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {AGE_BANDS.map(b => (
              <Chip key={b} label={b} on={draft.targetAges.includes(b)}
                onClick={() => update({
                  targetAges: draft.targetAges.includes(b)
                    ? draft.targetAges.filter(x => x !== b)
                    : [...draft.targetAges, b],
                })} />
            ))}
          </div>
          <span style={PJ} className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af]">Target gender</span>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {([['all', 'Semua'], ['female', 'Perempuan'], ['male', 'Laki-laki']] as const).map(([v, l]) => (
              <Chip key={v} label={l} on={draft.targetGender === v} onClick={() => update({ targetGender: v })} />
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <CardHead title="Campaign brief" sub="Arahan konten yang dikirim ke creator" />
        <div className="px-4 pb-4 flex flex-col gap-3">
          <Field label="Key message">
            <input value={draft.keyMessage} onChange={e => update({ keyMessage: e.target.value })}
              placeholder="Satu kalimat yang harus tersampaikan di setiap konten" className={INPUT} />
          </Field>
          <Field label="Brief">
            <textarea value={draft.brief} onChange={e => update({ brief: e.target.value })} rows={7}
              placeholder="Pesan utama, do &amp; don't, referensi visual, call to action…"
              className={`${INPUT} h-auto py-2 resize-y`} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hashtag wajib">
              <input value={draft.hashtags} onChange={e => update({ hashtags: e.target.value })}
                placeholder="#brandkamu #campaign" className={INPUT} />
            </Field>
            <Field label="Mention wajib">
              <input value={draft.mentions} onChange={e => update({ mentions: e.target.value })}
                placeholder="@brandkamu" className={INPUT} />
            </Field>
          </div>
          <p className="text-[10.5px] text-[#9ca3af]">
            Brief tersimpan bersama campaign dan ikut tampil di halaman order.
          </p>
        </div>
      </Card>

      <InspirationPicker orgId={orgId} picked={draft.inspirations}
        onChange={v => update({ inspirations: v })} />

      <CampaignTargets draft={draft} update={update} selected={selected} />
    </>
  )
}

/**
 * Campaign inspiration — reference posts pulled from the Discovery shortlist.
 *
 * Reads the org's saved Inspirations rather than offering a free content search:
 * saving a post is already a deliberate act performed in Discovery, so the brief
 * builds on a curated set instead of re-running discovery inside a form.
 */
function InspirationPicker({
  orgId, picked, onChange,
}: {
  orgId: string
  picked: Draft['inspirations']
  onChange: (v: Draft['inspirations']) => void
}) {
  const [posts, setPosts] = useState<DiscoverPost[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    // `saved=1` restricts the corpus to the org's Inspirations shortlist.
    fetch(`/api/organizations/${orgId}/discover/content?saved=1&pageSize=24&sort=new`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: DiscoverContentPayload) => { if (!cancelled) setPosts(d.posts ?? []) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [orgId])

  const keyOf = (p: { source: string; postRowId: number }) => `${p.source}:${p.postRowId}`
  const chosen = new Set(picked.map(keyOf))

  const toggle = (p: DiscoverPost) => {
    const ref = { source: p.source, postRowId: p.rowId, platform: p.platform }
    onChange(chosen.has(keyOf(ref))
      ? picked.filter(x => keyOf(x) !== keyOf(ref))
      : [...picked, ref])
  }

  return (
    <Card>
      <CardHead title="Campaign inspiration"
        sub={`Konten referensi dari Discovery${picked.length ? ` · ${picked.length} dipilih` : ''}`} />
      <div className="px-4 pb-4">
        {failed ? (
          <p className="text-[11.5px] text-[#9ca3af]">Daftar inspirasi tidak bisa dimuat. Brief tetap bisa dilanjutkan.</p>
        ) : !posts ? (
          <Spinner />
        ) : posts.length === 0 ? (
          <p className="text-[11.5px] text-[#9ca3af]">
            Belum ada konten tersimpan. Buka Discover → Content dan simpan post yang mau dijadikan referensi.
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {posts.slice(0, 12).map(p => {
              const on = chosen.has(keyOf({ source: p.source, postRowId: p.rowId }))
              return (
                <button key={p.key} type="button"
                  onClick={() => toggle(p)}
                  className={`text-left rounded-lg border p-2 transition-colors ${
                    on ? 'border-[#327488] bg-[#f0f7fa]' : 'border-[#e5e7eb] hover:border-[#A7C8D4]'
                  }`}>
                  <div className="flex items-center gap-1 mb-1">
                    <span className={`material-symbols-outlined text-[14px] ${on ? 'text-[#285D6E]' : 'text-[#d1d5db]'}`}>
                      {on ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                    <span className="text-[10px] text-[#9ca3af] capitalize truncate">{p.platform}</span>
                  </div>
                  <div style={PJ} className="text-[11px] font-bold text-[#111827] truncate">{p.author || '—'}</div>
                  <p className="text-[10px] text-[#9ca3af] line-clamp-2 leading-snug">{p.caption || 'Tanpa caption'}</p>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </Card>
  )
}

/**
 * Per-creator targets.
 *
 * One campaign routinely asks different things of different creators — a macro
 * account carries awareness, a tight-niche micro account carries conversions.
 * Leaving a field blank inherits the campaign-level objective, so this stays
 * invisible for the common case where every creator has the same job.
 */
function CampaignTargets({
  draft, update, selected,
}: { draft: Draft; update: (p: Partial<Draft>) => void; selected: SelectedKol[] }) {
  const setTarget = (accountId: string, patch: Partial<CreatorTarget>) => {
    const cur = draft.targets[accountId] ?? { objective: '', reach: 0, engagement: 0 }
    const next = { ...cur, ...patch }
    const targets = { ...draft.targets }
    // An all-empty target is no target: keep the map sparse so "inherits the
    // campaign objective" stays the stored meaning rather than three zeroes.
    if (!next.objective && !next.reach && !next.engagement) delete targets[accountId]
    else targets[accountId] = next
    update({ targets })
  }

  return (
    <Card className="overflow-hidden">
      <CardHead title="Campaign target per creator"
        sub="Kosongkan untuk mengikuti objective campaign" />
      {selected.length === 0 ? (
        <div className="px-4 pb-4">
          <p className="text-[11.5px] text-[#9ca3af]">
            Belum ada creator di order. Kembali ke Step 1 untuk memilih deliverable.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-[#e5e7eb]">
                {['Creator', 'Objective', 'Target reach', 'Target engagement'].map((h, i) => (
                  <th key={h} style={PJ}
                    className={`text-[10px] font-bold uppercase tracking-wider text-[#9ca3af] px-3 py-2 ${i ? 'text-left' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {selected.map(s => {
                const id = s.profile.account.id
                const t = draft.targets[id]
                return (
                  <tr key={id} className="border-b border-[#f3f4f6] last:border-0">
                    <td className="px-3 py-2">
                      <div style={PJ} className="text-[11.5px] font-bold text-[#111827] truncate max-w-[160px]">
                        {s.profile.account.username}
                      </div>
                      <div className="text-[10px] text-[#9ca3af]">{s.units} deliverable</div>
                    </td>
                    <td className="px-3 py-2">
                      <select value={t?.objective ?? ''} onChange={e => setTarget(id, { objective: e.target.value })}
                        className="h-7 px-2 rounded-lg border border-[#e5e7eb] text-[11.5px] text-[#374151] focus:outline-none focus:border-[#327488]">
                        <option value="">Ikut campaign ({draft.objective})</option>
                        {OBJECTIVES.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min={0} value={t?.reach || ''} placeholder={fmtNum(reachFor(s.profile, s.units))}
                        onChange={e => setTarget(id, { reach: Number(e.target.value) || 0 })}
                        className="w-32 h-7 px-2 rounded-lg border border-[#e5e7eb] text-[11.5px] tabular-nums text-[#374151] focus:outline-none focus:border-[#327488]" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min={0} value={t?.engagement || ''} placeholder={fmtNum(engagementFor(s.profile, s.units))}
                        onChange={e => setTarget(id, { engagement: Number(e.target.value) || 0 })}
                        className="w-32 h-7 px-2 rounded-lg border border-[#e5e7eb] text-[11.5px] tabular-nums text-[#374151] focus:outline-none focus:border-[#327488]" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="text-[10px] text-[#9ca3af] px-3 py-2">
            Placeholder menunjukkan estimasi dari model reach; isi hanya kalau targetmu berbeda.
          </p>
        </div>
      )}
    </Card>
  )
}

/* ── step 3: Order Summary & Payment ──────────────────────────────────────── */

/**
 * Everything that is about to be charged, then how to pay for it.
 *
 * The money breakdown is shown line by line — package subtotal, target
 * adjustment, platform fee, promo, tax — rather than as one total, because a
 * buyer approving a spend needs to see which part of it is the creators and
 * which part is the platform. The figures here are the client-side estimate; the
 * server reprices the whole cart when the order is created, which is what
 * actually gets charged, and the note under the total says so.
 */
function OrderSummaryStep({
  draft, selected, estimate, prediction, saving, onSubmit, onPromoChange, onMethodChange,
}: {
  draft: Draft; selected: SelectedKol[]
  estimate: ReturnType<typeof estimateCampaign>; prediction: ReturnType<typeof predictSuccess>
  saving: boolean; onSubmit: () => void
  onPromoChange: (v: string) => void
  onMethodChange: (v: PaymentMethodId) => void
}) {
  // Mirrors lib/discover/orders.ts. Kept in sync by the note above: this is a
  // preview, and the server's numbers are the ones that bind.
  const FEE_PCT = 8, TAX_PCT = 11
  const PROMOS: Record<string, number> = { LAUNCH10: 0.1 }

  const subtotal = estimate.totalCost
  // A per-creator target above what the selection is modelled to deliver is a
  // stretch the buyer is asking for, not a surcharge — shown as information so
  // "target adjustment" never silently becomes money.
  const targetDelta = selected.reduce((n, s) => {
    const t = draft.targets[s.profile.account.id]
    return n + (t?.reach ? Math.max(0, t.reach - reachFor(s.profile, s.units)) : 0)
  }, 0)

  const promoRate = PROMOS[draft.promoCode.trim().toUpperCase()] ?? 0
  const discount = Math.round(subtotal * promoRate)
  const afterDiscount = subtotal - discount
  const fee = Math.round((afterDiscount * FEE_PCT) / 100)
  const tax = Math.round(((afterDiscount + fee) * TAX_PCT) / 100)
  const total = afterDiscount + fee + tax

  const overrides = selected.length > 0
    ? Object.keys(draft.customPrices).filter(k => draft.units[k] > 0).length
    : 0

  return (
    <>
      <Card>
        <CardHead title="Campaign" sub="Konteks yang ikut tersimpan bersama order" />
        <div className="px-4 pb-4 grid grid-cols-2 gap-x-6 gap-y-1">
          <Row label="Nama" value={draft.name} />
          <Row label="Objective" value={draft.objective} />
          <Row label="Periode" value={draft.startDate && draft.endDate ? `${draft.startDate} → ${draft.endDate}` : 'belum diatur'} />
          <Row label="Deadline konten" value={draft.deadline || 'belum diatur'} />
          <Row label="Target umur" value={draft.targetAges.length ? draft.targetAges.join(', ') : 'semua'} />
          <Row label="Target gender" value={draft.targetGender === 'all' ? 'semua' : draft.targetGender} />
          <Row label="Goal reach" value={draft.goalReach ? fmtNum(draft.goalReach) : '—'} />
          <Row label="Goal engagement" value={draft.goalEngagement ? fmtNum(draft.goalEngagement) : '—'} />
          <Row label="Inspirasi" value={draft.inspirations.length ? `${draft.inspirations.length} konten` : '—'} />
          <Row label="Target per creator" value={Object.keys(draft.targets).length ? `${Object.keys(draft.targets).length} creator` : 'ikut campaign'} />
        </div>
        {draft.keyMessage && (
          <div className="px-4 pb-3">
            <div style={PJ} className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af] mb-1">Key message</div>
            <p className="text-[11.5px] text-[#374151]">{draft.keyMessage}</p>
          </div>
        )}
        {draft.brief && (
          <div className="px-4 pb-4">
            <div style={PJ} className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af] mb-1">Brief</div>
            <p className="text-[11.5px] text-[#374151] whitespace-pre-wrap leading-relaxed">{draft.brief}</p>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHead title="Creator & deliverables" sub={`${selected.length} creator · ${estimate.totalUnits} deliverable`} />
        <SelectedTable selected={selected} />
      </Card>

      <Card>
        <CardHead title="Rincian biaya" sub="Estimasi; server menghitung ulang saat order dibuat" />
        <div className="px-4 pb-4 flex flex-col gap-1">
          <Row label="Package subtotal" value={idr(subtotal)} />
          {overrides > 0 && (
            <Row label={`Custom pricing (${overrides} baris)`} value="sudah termasuk" />
          )}
          {targetDelta > 0 && (
            <Row label="Target adjustment" value={`+${fmtNum(targetDelta)} reach di atas estimasi`} />
          )}
          {discount > 0 && <Row label={`Promo ${draft.promoCode.trim().toUpperCase()}`} value={`−${idr(discount)}`} />}
          <Row label={`Platform fee ${FEE_PCT}%`} value={idr(fee)} />
          <Row label={`PPN ${TAX_PCT}%`} value={idr(tax)} />
          <div className="border-t border-[#e5e7eb] mt-1.5 pt-1.5">
            <Row label="Total pembayaran" value={idr(total)} bold />
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <input value={draft.promoCode} onChange={e => onPromoChange(e.target.value.toUpperCase())}
              placeholder="Kode promo (opsional)"
              className="h-8 w-[200px] px-2.5 rounded-lg border border-[#e5e7eb] text-[12px] text-[#374151] uppercase placeholder:normal-case placeholder:text-[#9ca3af] focus:outline-none focus:border-[#327488]" />
            {draft.promoCode.trim() && promoRate === 0 && (
              <span className="text-[10.5px] text-[#b5761f]">Kode tidak dikenali — server akan memeriksa ulang.</span>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardHead title="Metode pembayaran" sub="Dicatat pada order dan menentukan cara penyelesaiannya" />
        <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-3 gap-2">
          {PAYMENT_METHODS.map(m => {
            const on = draft.paymentMethod === m.id
            return (
              <button key={m.id} type="button" onClick={() => onMethodChange(m.id)}
                className={`text-left rounded-xl border p-3 transition-colors ${
                  on ? 'border-[#327488] bg-[#f0f7fa]' : 'border-[#e5e7eb] hover:border-[#A7C8D4]'
                }`}>
                <div className="flex items-center gap-1.5">
                  <span className={`material-symbols-outlined text-[17px] ${on ? 'text-[#285D6E]' : 'text-[#9ca3af]'}`}>
                    {m.icon}
                  </span>
                  <span style={PJ} className="text-[12px] font-extrabold text-[#111827]">{m.label}</span>
                  {on && <span className="material-symbols-outlined text-[15px] text-[#285D6E] ml-auto">check_circle</span>}
                </div>
                <p className="text-[10.5px] text-[#9ca3af] leading-relaxed mt-1">{m.note}</p>
              </button>
            )
          })}
        </div>
      </Card>

      <Card>
        <CardHead title="Predicted campaign success rate"
          sub="Brand fit, audience quality, engagement, riwayat, demografi, performa konten berbayar" />
        <div className="px-4 pb-4 flex items-center gap-6 flex-wrap">
          <SuccessGauge rate={prediction.rate} band={prediction.band} />
          <div className="flex-1 min-w-[220px] flex flex-col gap-1.5">
            {prediction.factors.map(f => (
              <div key={f.key} className="flex items-center gap-2">
                <span className="text-[10.5px] text-[#6b7280] w-44">{f.label}</span>
                <div className="flex-1 h-1.5 rounded-full bg-[#f3f4f6] overflow-hidden">
                  <div className="h-full rounded-full bg-[#4E96AC]" style={{ width: `${f.score}%` }} />
                </div>
                <b style={PJ} className="text-[10.5px] tabular-nums text-[#374151] w-7 text-right">{f.score}</b>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="flex items-center gap-2 flex-wrap">
        <Btn variant="primary" disabled={selected.length === 0 || saving} onClick={onSubmit}>
          <span className="material-symbols-outlined text-[15px]">check_circle</span>
          {saving ? 'Membuat order…' : 'Confirm & Pay'}
        </Btn>
        <span className="text-[10.5px] text-[#9ca3af]">
          Order dibuat dulu, lalu pembayaran diselesaikan di langkah ini juga.
        </span>
      </div>
    </>
  )
}


function SelectedTable({ selected }: { selected: SelectedKol[] }) {
  if (selected.length === 0) return <EmptyState icon="inbox" title="Belum ada KOL dipilih" />
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead>
          <tr className="border-b border-[#e5e7eb]">
            {['KOL', 'Deliverable', 'Est. reach', 'Est. engagement', 'Brand fit', 'Biaya'].map((h, i) => (
              <th key={h} style={PJ}
                className={`text-[10px] font-bold uppercase tracking-wider text-[#9ca3af] px-3 py-2 ${i >= 2 ? 'text-right' : 'text-left'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {selected.map(s => (
            <tr key={s.profile.account.id} className="border-b border-[#f3f4f6] last:border-0">
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <div style={{ ...PJ, background: gradientFor(s.profile.account.username) }}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[9px] font-extrabold">
                    {initials(s.profile.account.username)}
                  </div>
                  <span style={PJ} className="text-[12px] font-bold text-[#111827]">{s.profile.account.username}</span>
                </div>
              </td>
              <td style={PJ} className="px-3 py-2 text-[11.5px] font-bold text-[#374151]">{s.units}</td>
              <td style={PJ} className="px-3 py-2 text-[11.5px] font-bold text-[#374151] text-right tabular-nums">{fmtNum(reachFor(s.profile, s.units))}</td>
              <td style={PJ} className="px-3 py-2 text-[11.5px] font-bold text-[#374151] text-right tabular-nums">{fmtNum(engagementFor(s.profile, s.units))}</td>
              <td style={PJ} className="px-3 py-2 text-[11.5px] font-bold text-[#374151] text-right tabular-nums">{s.profile.brandFit.value}</td>
              <td style={PJ} className="px-3 py-2 text-[11.5px] font-extrabold text-[#111827] text-right tabular-nums">{idr(s.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const INPUT = 'w-full h-8 px-2.5 rounded-lg border border-[#e5e7eb] text-[12px] text-[#374151] focus:outline-none focus:border-[#327488]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span style={PJ} className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af]">{label}</span>
      {children}
    </label>
  )
}

function Mini({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2.5 ${strong ? 'bg-[#f0f7fa]' : 'bg-[#f9fafb]'}`}>
      <div style={PJ} className={`text-[14px] font-extrabold tabular-nums ${strong ? 'text-[#285D6E]' : 'text-[#111827]'}`}>{value}</div>
      <div className="text-[10px] text-[#9ca3af] mt-0.5">{label}</div>
    </div>
  )
}

function Step({ icon, onClick }: { icon: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="w-6 h-6 rounded-md border border-[#e5e7eb] text-[#6b7280] hover:border-[#327488] hover:text-[#285D6E] flex items-center justify-center">
      <span className="material-symbols-outlined text-[13px]">{icon}</span>
    </button>
  )
}

/**
 * Roster creators carried in from the Cart.
 *
 * Read-only on purpose. Everything in the step above is driven by a `KolProfile`
 * — reach model, optimiser, per-creator targets — and a roster creator has none
 * of that behind them, so offering the same controls would promise numbers that
 * do not exist. Their quantities are set in the Cart, which is where they were
 * chosen; this block exists so the flow *shows* them before it orders them.
 */
function RosterFromCart({
  rows, lines, onGoToCart,
}: {
  rows: KolDirectoryRow[]
  lines: { socialAccountId: string; deliverableId: string; qty: number }[]
  onGoToCart?: () => void
}) {
  if (!lines.length) return null

  const byCreator = new Map<string, { qty: number; labels: string[] }>()
  for (const l of lines) {
    const d = DELIVERABLES.find(x => x.id === l.deliverableId)
    const cur = byCreator.get(l.socialAccountId) ?? { qty: 0, labels: [] }
    cur.qty += l.qty
    if (d) cur.labels.push(`${l.qty}× ${d.label}`)
    byCreator.set(l.socialAccountId, cur)
  }

  return (
    <Card>
      <CardHead
        title="Dari Directory"
        sub={`${byCreator.size} creator roster · ikut dipesan, diatur di tab Cart`}
        action={onGoToCart && (
          <Btn size="sm" variant="secondary" onClick={onGoToCart}>
            <span className="material-symbols-outlined text-[15px]">shopping_cart</span>
            Ubah di Cart
          </Btn>
        )}
      />
      <div className="px-4 pb-4 flex flex-col gap-1.5">
        {[...byCreator.entries()].map(([id, info]) => {
          const row = rows.find(r => r.id === id)
          return (
            <div key={id} className="flex items-center gap-2.5 rounded-lg border border-[#e5e7eb] px-3 py-2">
              <div style={{ ...PJ, background: gradientFor(id) }}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[9px] font-extrabold">
                {(row?.username ?? '?').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '??'}
              </div>
              <div className="flex-1 min-w-0">
                <span style={PJ} className="block text-[12px] font-bold text-[#111827] truncate">
                  {row?.username ?? 'Creator roster'}
                </span>
                <span className="block text-[10px] text-[#9ca3af] truncate">
                  {info.labels.join(' · ')}
                </span>
              </div>
              <span style={PJ} className="text-[11.5px] font-extrabold tabular-nums text-[#285D6E]">
                {info.qty} item
              </span>
            </div>
          )
        })}
        <p className="text-[10px] text-[#9ca3af] leading-relaxed mt-1">
          Estimasi reach dan prediksi di panel kanan tidak mencakup creator ini — platform KOL
          tidak menyimpan post mereka, jadi tidak ada yang bisa dihitung. Harga dan totalnya tetap
          dihitung server bersama baris lain.
        </p>
      </div>
    </Card>
  )
}
