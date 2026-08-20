'use client'

/**
 * Negotiation — the Discover tab that agrees the deal.
 *
 * The source platform's largest module, and the one autometric had no port of.
 * Everything on either side of it was already here: Directory finds
 * the creator, Compare shortlists them, Cart & Order buys. What was missing was
 * the middle — settling what will be delivered, for how much, on what terms, and
 * what happens when the numbers land. Before this, the only path from a shortlist
 * to an order was "pay the rate card", which is not how any of these deals
 * actually get done.
 *
 * Two views, not two routes: a list of deals, and one deal's cockpit. The
 * selection is component state rather than a URL param, because a deal currently
 * lives in one browser's localStorage — a link to `?deal=NG-1001` would resolve
 * for nobody but the person who made it. That changes when the store does.
 *
 * The cockpit's tabs follow the deal's own order — Offer, Chat, Agreement,
 * Campaign, Settlement — and each is gated on the stage that unlocks it rather
 * than hidden, so the sequence is legible before you have been through it once.
 */

import { useEffect, useMemo, useState } from 'react'
import { Btn, EmptyState, ErrorState, PJ, PLATFORM_ICON, Spinner, TabStrip, fmtNum, gradientFor } from './ui'
import {
  FieldLabel, Modal, Panel, Stat, StatusPill, StepRail, Toast, useToast,
} from './negotiationUi'
import { useNegotiations } from './useNegotiations'
import NegotiationOffer from './NegotiationOffer'
import NegotiationChat from './NegotiationChat'
import NegotiationTerms from './NegotiationTerms'
import NegotiationCampaign from './NegotiationCampaign'
import NegotiationSettlement from './NegotiationSettlement'
import {
  CLOSE_REASONS, NEGO_FLOW, STAGE_LABEL, deliverableSummary, idr, isExecuted,
  listPriceOf, stageIndex, type Negotiation,
} from '@/lib/discover/negotiation'
import { reachFor, engagementFor } from '@/lib/discover/campaign'
import type { DirectoryAccount } from '@/lib/discover/types'
import type { Deliverable, RateCard } from '@/lib/discover/vocab'
import type { KolProfile } from '@/lib/discover/profile'
import { useDiscoverCart } from './useDiscoverCart'

type DealTab = 'offer' | 'chat' | 'terms' | 'campaign' | 'settlement'

const DEAL_TABS: { id: DealTab; label: string; icon: string }[] = [
  { id: 'offer', label: 'Offer', icon: 'local_offer' },
  { id: 'chat', label: 'Chat', icon: 'forum' },
  { id: 'terms', label: 'Agreement', icon: 'gavel' },
  { id: 'campaign', label: 'Campaign', icon: 'rocket_launch' },
  { id: 'settlement', label: 'Penyelesaian', icon: 'payments' },
]

/** Campaign window defaults: a week to brief, a month to run, a week to settle. */
function defaultWindow() {
  const iso = (offsetDays: number) => {
    const d = new Date()
    d.setDate(d.getDate() + offsetDays)
    return d.toISOString().slice(0, 10)
  }
  return { start: iso(7), end: iso(37), dueDate: iso(44) }
}

export default function NegotiationWorkspace({
  orgId, onGoToCart, onGoToDirectory,
}: {
  orgId: string
  onGoToCart?: () => void
  onGoToDirectory?: () => void
}) {
  const { message, notify } = useToast()
  const api = useNegotiations(orgId, notify)
  const cart = useDiscoverCart(orgId)

  const [accounts, setAccounts] = useState<DirectoryAccount[]>([])
  const [rates, setRates] = useState<Record<string, RateCard>>({})
  const [catalogue, setCatalogue] = useState<Deliverable[]>([])
  const [profiles, setProfiles] = useState<KolProfile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState<DealTab>('offer')
  const [picking, setPicking] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/organizations/${orgId}/discover/rates`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { rates: Record<string, RateCard>; deliverables: Deliverable[]; accounts: DirectoryAccount[] }) => {
        if (cancelled) return
        setRates(d.rates); setCatalogue(d.deliverables); setAccounts(d.accounts)
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
      // Targets fall back to the account's own totals without this; the deal
      // still works, it just opens on rougher numbers.
      .catch(() => { /* non-fatal */ })
    return () => { cancelled = true }
  }, [orgId])

  const deal = selected ? api.get(selected) : undefined

  if (error) return <ErrorState message={error} />
  if (loading || !api.ready) return <Spinner />

  return (
    <>
      <Toast message={message} />
      {deal ? (
        <DealCockpit
          deal={deal}
          api={api}
          catalogue={catalogue}
          rate={rates[deal.accountId] ?? null}
          tab={tab}
          onTab={setTab}
          onBack={() => setSelected(null)}
          onClose={() => setClosing(true)}
          inCart={cart.accountIds.includes(deal.accountId)}
          onAddToCart={() => {
            // The agreed price is not the rate-card price, so what goes into the
            // cart is the agreed deliverable mix; the order is priced server-side
            // from the rate card and the negotiated amount is carried as the
            // deal's own record until the store moves to the database.
            for (const [deliverableId, qty] of Object.entries(deal.selection)) {
              cart.setQty(
                { socialAccountId: deal.accountId, relation: deal.relation, deliverableId },
                qty,
              )
            }
            notify(`${deal.creatorName} ditambahkan ke Cart — harga deal ${idr(deal.finalPrice ?? 0)}`)
            onGoToCart?.()
          }}
        />
      ) : (
        <DealList
          api={api}
          accounts={accounts}
          rates={rates}
          catalogue={catalogue}
          onOpen={id => {
            const d = api.get(id)
            setSelected(id)
            setTab(d && d.stage !== 'draft' && d.stage !== 'negotiation' ? 'terms' : 'offer')
          }}
          onNew={() => setPicking(true)}
          onGoToDirectory={onGoToDirectory}
        />
      )}

      {picking && (
        <CreatorPicker
          accounts={accounts}
          rates={rates}
          catalogue={catalogue}
          profiles={profiles}
          api={api}
          onClose={() => setPicking(false)}
          onCreated={id => { setPicking(false); setSelected(id); setTab('offer') }}
        />
      )}

      {closing && deal && (
        <CloseDialog
          deal={deal}
          onClose={() => setClosing(false)}
          onConfirm={(reason, note) => {
            api.close(deal.id, reason, note)
            setClosing(false)
          }}
        />
      )}
    </>
  )
}

/* ── list ─────────────────────────────────────────────────────────────────── */

function DealList({
  api, accounts, rates, catalogue, onOpen, onNew, onGoToDirectory,
}: {
  api: ReturnType<typeof useNegotiations>
  accounts: DirectoryAccount[]
  rates: Record<string, RateCard>
  catalogue: Deliverable[]
  onOpen: (id: string) => void
  onNew: () => void
  onGoToDirectory?: () => void
}) {
  const counts = useMemo(() => {
    const c = { draft: 0, live: 0, agreed: 0, running: 0, done: 0, lost: 0 }
    for (const n of api.items) {
      if (n.stage === 'draft') c.draft++
      else if (n.stage === 'negotiation' || n.stage === 'agreement-pending') c.live++
      else if (n.stage === 'agreed') c.agreed++
      else if (['active', 'evaluation', 'payment-pending'].includes(n.stage)) c.running++
      else if (n.stage === 'paid' || n.stage === 'completed') c.done++
      else c.lost++
    }
    return c
  }, [api.items])

  const committed = api.items
    .filter(n => n.finalPrice)
    .reduce((s, n) => s + (n.finalPrice ?? 0), 0)
  const paid = api.items.reduce((s, n) => s + n.paid, 0)

  return (
    <div className="flex flex-col gap-4">
      {/* One summary panel rather than six count tiles above three money rows.
          The counts are chips because they are a breakdown of one number — how
          many deals — and the three figures are the ones worth a tile. */}
      {api.items.length > 0 && (
        <Panel title="Ringkasan" sub={`${api.items.length} deal · nilai dari harga yang sudah disepakati`}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-3">
            <Stat label="Total disepakati" value={idr(committed)} />
            <Stat label="Sudah dibayar" value={idr(paid)} tone="good" />
            <Stat label="Belum dibayar" value={idr(Math.max(0, committed - paid))}
              tone={committed - paid > 0 ? 'warn' : undefined} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <CountChip label="Draft" value={counts.draft} icon="edit_note" />
            <CountChip label="Negosiasi" value={counts.live} icon="handshake" tone="live" />
            <CountChip label="Sepakat" value={counts.agreed} icon="task_alt" tone="good" />
            <CountChip label="Berjalan" value={counts.running} icon="rocket_launch" tone="live" />
            <CountChip label="Selesai" value={counts.done} icon="flag_circle" tone="good" />
            <CountChip label="Tidak jadi" value={counts.lost} icon="close" tone="bad" />
          </div>
        </Panel>
      )}

          <Panel
            title="Negosiasi"
            sub={api.items.length ? `${api.items.length} deal` : undefined}
            action={
            <Btn size="sm" variant="primary" onClick={onNew}
          >
            <span className="material-symbols-outlined text-[15px]">add</span>
            Mulai negosiasi
          </Btn>
        }
      >
        {api.items.length === 0 ? (
          <EmptyState
            icon="handshake"
            title="Belum ada negosiasi"
            body="Negosiasi dimulai dari satu creator: pilih deliverable-nya, ajukan harga, lalu sepakati Guaranteed dan Performance Fee sebelum masuk ke Cart."
            action={
              <div className="flex items-center gap-2 flex-wrap justify-center">
                <Btn variant="primary" onClick={onNew}>
                  <span className="material-symbols-outlined text-[15px]">add</span>
                  Mulai negosiasi
                </Btn>
                {onGoToDirectory && (
                  <Btn variant="secondary" onClick={onGoToDirectory}>
                    <span className="material-symbols-outlined text-[15px]">grid_view</span>
                    Cari creator dulu
                  </Btn>
                )}
              </div>
            }
          />
        ) : (
          <div className="flex flex-col gap-2">
            {api.items.map(n => {
              const st = STAGE_LABEL[n.stage]
              const account = accounts.find(a => a.id === n.accountId)
              const price = n.finalPrice
                ?? n.offers[n.offers.length - 1]?.amount
                ?? listPriceOf(n.selection, rates[n.accountId], catalogue)
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onOpen(n.id)}
                  className="text-left rounded-xl border border-[#e5e7eb] px-3 py-2.5 hover:border-[#A7C8D4] hover:bg-[#f9fafb] transition-colors"
                >
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span
                      className="w-8 h-8 rounded-full flex-shrink-0 bg-cover"
                      style={{ background: gradientFor(n.accountId) }}
                      aria-hidden
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span style={PJ} className="text-[12.5px] font-extrabold text-[#111827] truncate">
                          {n.creatorName}
                        </span>
                        <span className="material-symbols-outlined text-[13px] text-[#9ca3af]">
                          {PLATFORM_ICON[n.platform] ?? 'public'}
                        </span>
                      </div>
                      <span className="block text-[10px] text-[#9ca3af] truncate">
                        {n.id} · {deliverableSummary(n.selection, catalogue) || 'belum ada deliverable'}
                        {account ? '' : ' · akun tidak lagi di-track'}
                      </span>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span style={PJ} className="block text-[12.5px] font-extrabold tabular-nums text-[#285D6E]">
                        {idr(price)}
                      </span>
                      <span className="block text-[9.5px] text-[#9ca3af]">
                        {n.finalPrice ? 'disepakati' : n.offers.length ? `offer v${n.offers.length}` : 'rate card'}
                      </span>
                    </div>
                    <StatusPill label={st.label} tone={st.tone} />
                  </div>
                  {n.stage !== 'draft' && !['rejected', 'closed'].includes(n.stage) && (
                    <div className="mt-2">
                      <StepRail
                        steps={NEGO_FLOW.map(f => ({ label: f.label, icon: f.icon }))}
                        activeIndex={Math.max(0, stageIndex(n.stage))}
                      />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}

        <p className="text-[9.5px] text-[#9ca3af] leading-relaxed mt-3 pt-3 border-t border-[#f3f4f6]">
          Negosiasi tersimpan di browser ini saja — belum ada tabel di database, jadi deal tidak
          ikut ke perangkat lain dan hilang bila data situs dibersihkan. Sisi creator (membuka
          offer, counter, kirim konten) dijalankan manual dari panel simulasi yang ditandai di
          tiap layar.
        </p>
      </Panel>
    </div>
  )
}

/** A count and what it counts — a breakdown, so a chip rather than a tile. */
function CountChip({
  label, value, icon, tone,
}: { label: string; value: number; icon: string; tone?: 'live' | 'good' | 'bad' }) {
  const colour = tone === 'good' ? '#2f7d63' : tone === 'bad' ? '#c2553f' : tone === 'live' ? '#285D6E' : '#6b7280'
  const empty = value === 0
  return (
    <span
      style={PJ}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 h-[26px] text-[10.5px] font-bold ${
        empty ? 'border-[#f3f4f6] bg-white text-[#c8ced6]' : 'border-[#e5e7eb] bg-white text-[#6b7280]'
      }`}
    >
      <span className="material-symbols-outlined text-[13px]" style={{ color: empty ? '#d8dde3' : colour }}>
        {icon}
      </span>
      {label}
      <span style={{ color: empty ? '#c8ced6' : colour }} className="text-[11px] font-extrabold tabular-nums">
        {value}
      </span>
    </span>
  )
}

/* ── cockpit ──────────────────────────────────────────────────────────────── */

function DealCockpit({
  deal, api, catalogue, rate, tab, onTab, onBack, onClose, onAddToCart, inCart,
}: {
  deal: Negotiation
  api: ReturnType<typeof useNegotiations>
  catalogue: Deliverable[]
  rate: RateCard | null
  tab: DealTab
  onTab: (t: DealTab) => void
  onBack: () => void
  onClose: () => void
  onAddToCart: () => void
  inCart: boolean
}) {
  const st = STAGE_LABEL[deal.stage]
  const executed = isExecuted(deal)
  const ended = deal.stage === 'rejected' || deal.stage === 'closed'

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <button type="button" onClick={onBack} aria-label="Kembali ke daftar"
              className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-[#e5e7eb] text-[#6b7280] hover:border-[#A7C8D4] hover:text-[#285D6E] flex-shrink-0">
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            </button>
            <span className="w-9 h-9 rounded-full flex-shrink-0"
              style={{ background: gradientFor(deal.accountId) }} aria-hidden />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span style={PJ} className="text-[15px] font-extrabold text-[#111827] truncate">
                  {deal.creatorName}
                </span>
                <span className="material-symbols-outlined text-[14px] text-[#9ca3af]">
                  {PLATFORM_ICON[deal.platform] ?? 'public'}
                </span>
                <StatusPill label={st.label} tone={st.tone} />
              </div>
              <span className="block text-[10.5px] text-[#9ca3af]">
                {deal.id} · {deliverableSummary(deal.selection, catalogue) || 'belum ada deliverable'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {deal.finalPrice ? (
              <div className="text-right">
                <span style={PJ} className="block text-[15px] font-extrabold tabular-nums text-[#285D6E]">
                  {idr(deal.finalPrice)}
                </span>
                <span className="block text-[9.5px] text-[#9ca3af]">harga disepakati</span>
              </div>
            ) : null}
            {executed && !inCart && (
              <Btn variant="primary" onClick={onAddToCart}>
                <span className="material-symbols-outlined text-[15px]">shopping_cart</span>
                Kirim ke Cart
              </Btn>
            )}
            {executed && inCart && (
              <StatusPill label="Sudah di Cart" tone="good" />
            )}
            {!ended && (
              <Btn variant="ghost" onClick={onClose}>
                <span className="material-symbols-outlined text-[15px]">block</span>
                Tutup negosiasi
              </Btn>
            )}
          </div>
        </div>

        {!ended && deal.stage !== 'draft' && (
          <div className="mt-3">
            <StepRail
              steps={NEGO_FLOW.map(f => ({ label: f.label, icon: f.icon }))}
              activeIndex={Math.max(0, stageIndex(deal.stage))}
            />
          </div>
        )}
      </Panel>

      <TabStrip tabs={DEAL_TABS} value={tab} onChange={onTab} />

      {tab === 'offer' && (
        <NegotiationOffer key={deal.id} deal={deal} api={api} catalogue={catalogue} rate={rate} />
      )}
      {tab === 'chat' && <NegotiationChat key={deal.id} deal={deal} api={api} />}
      {tab === 'terms' && (
        <NegotiationTerms key={deal.id} deal={deal} api={api} catalogue={catalogue} />
      )}
      {tab === 'campaign' && <NegotiationCampaign key={deal.id} deal={deal} api={api} />}
      {tab === 'settlement' && <NegotiationSettlement key={deal.id} deal={deal} api={api} />}
    </div>
  )
}

/* ── starting a deal ──────────────────────────────────────────────────────── */

/**
 * Pick the creator, and the deal opens on their rate card.
 *
 * Only tracked accounts are offered: the deliverable mix has to be priced against
 * a rate card, and the KPI targets have to be seeded from real post history.
 * Roster creators from the commercial Directory have neither, so negotiating with
 * one would mean inventing both numbers.
 */
function CreatorPicker({
  accounts, rates, catalogue, profiles, api, onClose, onCreated,
}: {
  accounts: DirectoryAccount[]
  rates: Record<string, RateCard>
  catalogue: Deliverable[]
  profiles: KolProfile[]
  api: ReturnType<typeof useNegotiations>
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return accounts
      .filter(a => !q || a.username.toLowerCase().includes(q))
      .map(a => ({
        account: a,
        rate: rates[a.id] ?? null,
        existing: api.activeFor(a.id),
      }))
      .sort((x, y) => (y.rate?.baseRate ?? 0) - (x.rate?.baseRate ?? 0))
  }, [accounts, rates, query, api])

  const start = (account: DirectoryAccount) => {
    const existing = api.activeFor(account.id)
    if (existing) { onCreated(existing.id); return }

    const platformDelivs = catalogue.filter(d => d.platform === account.platform)
    if (!platformDelivs.length) return
    // Open on one unit of the platform's headline deliverable — the cheapest
    // honest starting point, and the thing the composer expects to adjust.
    const first = platformDelivs[0]
    const selection = { [first.id]: 1 }
    const rate = rates[account.id] ?? null

    const profile = profiles.find(p => p.account.id === account.id)
    const estimate = profile
      ? {
          reach: reachFor(profile, 1),
          engagement: engagementFor(profile, 1),
          likes: Math.round(engagementFor(profile, 1) * 0.94),
          comments: Math.round(engagementFor(profile, 1) * 0.06),
        }
      : {
          // No profile: fall back to the account's own measured totals per post.
          reach: Math.round(account.totalViews / Math.max(1, account.postCount)),
          engagement: Math.round((account.totalLikes + account.totalComments) / Math.max(1, account.postCount)),
          likes: Math.round(account.totalLikes / Math.max(1, account.postCount)),
          comments: Math.round(account.totalComments / Math.max(1, account.postCount)),
        }

    const id = api.create({
      accountId: account.id,
      relation: account.relation,
      creatorName: account.username,
      platform: account.platform,
      selection,
      listPrice: listPriceOf(selection, rate, catalogue),
      estimate,
      ...defaultWindow(),
    })
    onCreated(id)
  }

  return (
    <Modal title="Mulai negosiasi" wide onClose={onClose}>
      <FieldLabel>Cari akun yang di-track</FieldLabel>
      <input
        value={query}
        autoFocus
        onChange={e => setQuery(e.target.value)}
        placeholder="Nama akun…"
        className="w-full h-9 px-2.5 rounded-lg border border-[#e5e7eb] text-[12px] text-[#374151] bg-white focus:outline-none focus:border-[#327488] mb-3"
      />

      {rows.length === 0 ? (
        <EmptyState
          icon="person_search"
          title="Tidak ada akun cocok"
          body="Negosiasi hanya bisa dimulai dengan akun yang di-track organisasi ini, karena harga dan target KPI-nya diambil dari rate card dan riwayat post."
        />
      ) : (
        <div className="flex flex-col gap-1.5 max-h-[420px] overflow-y-auto">
          {rows.map(({ account, rate, existing }) => (
            <button
              key={`${account.relation}:${account.id}`}
              type="button"
              onClick={() => start(account)}
              className="text-left flex items-center gap-2.5 rounded-xl border border-[#e5e7eb] px-3 py-2 hover:border-[#A7C8D4] hover:bg-[#f9fafb] transition-colors"
            >
              <span className="w-7 h-7 rounded-full flex-shrink-0"
                style={{ background: gradientFor(account.id) }} aria-hidden />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span style={PJ} className="text-[12px] font-bold text-[#111827] truncate">
                    {account.username}
                  </span>
                  <span className="material-symbols-outlined text-[13px] text-[#9ca3af]">
                    {PLATFORM_ICON[account.platform] ?? 'public'}
                  </span>
                </div>
                <span className="block text-[10px] text-[#9ca3af] tabular-nums">
                  {account.postCount} post · ER {account.avgErPct.toFixed(1)}% ·{' '}
                  {fmtNum(account.totalViews)} views
                </span>
              </div>
              <div className="text-right flex-shrink-0">
                {rate?.baseRate ? (
                  <>
                    <span style={PJ} className="block text-[11.5px] font-extrabold tabular-nums text-[#285D6E]">
                      {idr(rate.baseRate)}
                    </span>
                    <span className="block text-[9.5px] text-[#9ca3af]">base rate</span>
                  </>
                ) : (
                  <span className="block text-[9.5px] text-[#a4713a]">rate card kosong</span>
                )}
              </div>
              {existing && <StatusPill label="Sudah ada deal" tone="live" size="sm" />}
            </button>
          ))}
        </div>
      )}

      <p className="text-[10.5px] text-[#9ca3af] mt-3">
        Rate card diatur di <span className="font-bold">Ordering → Rate Cards</span>. Tanpa base
        rate, negosiasi tetap bisa dibuka tetapi total rate card-nya nol dan angka offer
        sepenuhnya manual. Creator dari tab Directory belum bisa dinegosiasikan di sini: mereka
        tidak punya rate card maupun riwayat post di warehouse, jadi harga dan target KPI-nya
        tidak ada dasarnya.
      </p>
    </Modal>
  )
}

function CloseDialog({
  deal, onClose, onConfirm,
}: {
  deal: Negotiation
  onClose: () => void
  onConfirm: (reason: string, note: string) => void
}) {
  const [reason, setReason] = useState<string>(CLOSE_REASONS[0])
  const [note, setNote] = useState('')
  return (
    <Modal
      title={`Tutup negosiasi dengan ${deal.creatorName}`}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Batal</Btn>
          <Btn variant="primary" onClick={() => onConfirm(reason, note)}>Tutup negosiasi</Btn>
        </>
      }
    >
      <FieldLabel>Alasan</FieldLabel>
      <div className="flex flex-col gap-1 mb-3">
        {CLOSE_REASONS.map(r => (
          <label key={r} className="flex items-center gap-2 py-1 cursor-pointer">
            <input type="radio" name="close-reason" checked={reason === r}
              onChange={() => setReason(r)} className="w-3.5 h-3.5 accent-[#327488]" />
            <span className="text-[11.5px] text-[#374151]">{r}</span>
          </label>
        ))}
      </div>
      <FieldLabel>Catatan (opsional)</FieldLabel>
      <textarea
        value={note}
        rows={3}
        onChange={e => setNote(e.target.value)}
        className="w-full px-2.5 py-2 rounded-lg border border-[#e5e7eb] text-[11.5px] text-[#374151] bg-white resize-y focus:outline-none focus:border-[#327488]"
      />
      <p className="text-[10.5px] text-[#9ca3af] mt-2">
        Riwayat offer dan chat tetap tersimpan, dan negosiasi bisa dibuka kembali.
      </p>
    </Modal>
  )
}
