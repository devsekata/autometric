'use client'

/**
 * The negotiation store.
 *
 * Client-side and persisted to localStorage per org, which is a deliberate first
 * step rather than the destination: the shapes in `@/lib/discover/negotiation`
 * are written to become tables, and every write goes through one `update` here,
 * so swapping this for a server store is a change to this file and not to the
 * eleven screens above it.
 *
 * What that costs today, stated plainly because the UI has to say it too: a deal
 * lives in one browser. It does not follow the user to another device, the
 * counterparty cannot actually see it, and clearing site data ends it. The
 * screens that depend on a second party acting — an offer being viewed, a
 * counter arriving, content being submitted — carry explicit simulation controls
 * rather than pretending a creator is on the other end.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  type Actuals, type DeliverableItem, type DeliverableStatus, type DealTerms,
  type Milestone, type Negotiation, type NewNegotiationInput, type PayTerms,
  type Rule, type StageTone,
  activeTerms, buildAgreement, buildDeliverables, buildSchedule, contentStageOf,
  deliverableSummary, evaluate, idr, milestoneTotal, newNegotiation,
  snapshotTerms,
} from '@/lib/discover/negotiation'
import type { Deliverable } from '@/lib/discover/vocab'

const NOW = 'Baru saja'

type RuleGroup = 'bonuses' | 'penalties' | 'protections'

export interface NegotiationsApi {
  ready: boolean
  items: Negotiation[]
  get: (id: string) => Negotiation | undefined
  /** An open deal with this account, if there is one. */
  activeFor: (accountId: string) => Negotiation | undefined
  create: (input: Omit<NewNegotiationInput, 'id'>) => string
  remove: (id: string) => void

  setQty: (id: string, deliverableId: string, qty: number) => void
  saveDraft: (id: string, draft: { price: string; note: string }) => void

  sendOffer: (id: string, amount: number, note: string, catalogue: Deliverable[]) => boolean
  counter: (id: string, by: 'brand' | 'creator', amount: number, note: string) => boolean
  creatorAccept: (id: string) => void
  creatorReject: (id: string) => void
  markViewed: (id: string) => void
  expireOffer: (id: string) => void
  newOfferDraft: (id: string) => void
  withdrawOffer: (id: string) => void

  send: (id: string, by: 'brand' | 'creator', text: string) => void

  patchTerms: (id: string, patch: Partial<DealTerms>) => void
  toggleRule: (id: string, group: RuleGroup, ruleId: string) => void
  setRuleAmount: (id: string, group: RuleGroup, ruleId: string, amount: number) => void
  setPayTerms: (id: string, terms: PayTerms) => void
  setMilestones: (id: string, milestones: Milestone[]) => void
  setKpi: (id: string, key: 'likes' | 'comments' | 'views', value: number) => void

  accept: (id: string, party: 'brand' | 'creator', catalogue: Deliverable[]) => string | null
  amend: (id: string) => void
  close: (id: string, reason: string, note: string) => void
  reopen: (id: string) => void

  payMilestone: (id: string, index: number) => void
  startCampaign: (id: string) => void
  deliverableAction: (
    id: string, key: string, action: 'submit' | 'approve' | 'revise' | 'schedule' | 'publish',
    feedback?: string,
  ) => void
  completeCampaign: (id: string, actuals: Actuals) => void
  confirmEvaluation: (id: string) => void
  payFinal: (id: string) => void
  finish: (id: string) => void
}

/* ── persistence ──────────────────────────────────────────────────────────── */

const STORAGE_VERSION = 1

function read(key: string): Negotiation[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    // A version bump drops old data rather than trying to migrate a shape that
    // never left one browser. Cheap now; the real migration is to the database.
    if (!parsed || parsed.v !== STORAGE_VERSION || !Array.isArray(parsed.items)) return []
    return parsed.items as Negotiation[]
  } catch {
    return []
  }
}

function write(key: string, items: Negotiation[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify({ v: STORAGE_VERSION, items }))
  } catch {
    /* quota / privacy mode — the session still works, it just will not survive */
  }
}

/* ── the hook ─────────────────────────────────────────────────────────────── */

export function useNegotiations(
  orgId: string,
  notify?: (message: string) => void,
): NegotiationsApi {
  const storageKey = `autometric:discover:negotiations:${orgId}`
  // Starts empty so server and first client render agree; the stored value is
  // adopted in the effect below to avoid a hydration mismatch.
  const [items, setItems] = useState<Negotiation[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setItems(read(storageKey))
    setReady(true)
  }, [storageKey])

  // Persisting in an effect rather than inside the state updaters keeps those
  // updaters pure — React is allowed to call them twice, and a write is a side
  // effect. Gated on `ready` so the initial empty array never overwrites what is
  // in storage before the load effect above has run.
  useEffect(() => {
    if (!ready) return
    write(storageKey, items)
  }, [ready, storageKey, items])

  const commit = useCallback((next: Negotiation[]) => setItems(next), [])

  const toast = useCallback((m: string) => notify?.(m), [notify])

  /**
   * Every mutation goes through here. The target is cloned rather than mutated
   * in place so React sees a new object and re-renders; the rest of the array
   * keeps its identity.
   */
  const update = useCallback((id: string, fn: (n: Negotiation) => void) => {
    setItems(prev => prev.map(n => {
      if (n.id !== id) return n
      const copy = structuredClone(n)
      fn(copy)
      return copy
    }))
  }, [])

  const api = useMemo<NegotiationsApi>(() => {
    const log = (n: Negotiation, field: string) => {
      n.changes.push({ field, at: NOW })
      // Any change to a drafted agreement invalidates both signatures — the
      // document people accepted is not the document any more.
      if (n.agreement && !n.agreement.locked
          && (n.agreement.accept.brand || n.agreement.accept.creator)) {
        n.agreement.accept = { brand: false, creator: false }
        n.changes.push({
          field: 'Persetujuan direset — kedua pihak harus menerima ulang setelah perubahan',
          at: NOW,
        })
      }
    }
    const say = (n: Negotiation, text: string) =>
      n.chat.push({ by: 'system', text, at: NOW })

    return {
      ready,
      items,
      get: id => items.find(n => n.id === id),
      activeFor: accountId => items.find(
        n => n.accountId === accountId && !['rejected', 'closed', 'completed'].includes(n.stage)),

      create: input => {
        // Numbered from the highest id in use, not from the count — deleting a
        // draft and starting another would otherwise reuse its number, and two
        // deals with one id is the kind of thing that only shows up later.
        const highest = items.reduce((max, n) => {
          const num = Number(n.id.replace(/\D/g, ''))
          return Number.isFinite(num) ? Math.max(max, num) : max
        }, 1000)
        const id = `NG-${highest + 1}`
        const created = newNegotiation({ ...input, id })
        commit([created, ...items])
        toast('Ruang negosiasi dibuka — susun offer pertama')
        return id
      },

      remove: id => {
        commit(items.filter(n => n.id !== id))
        toast('Draft offer dibuang')
      },

      setQty: (id, deliverableId, qty) => update(id, n => {
        if (n.stage !== 'draft' && n.stage !== 'negotiation') return
        if (qty <= 0) delete n.selection[deliverableId]
        else n.selection[deliverableId] = Math.min(99, Math.floor(qty))
      }),

      saveDraft: (id, draft) => update(id, n => { n.draft = draft }),

      sendOffer: (id, amount, note, catalogue) => {
        const n = items.find(x => x.id === id)
        if (!n) return false
        if (!Number.isFinite(amount) || amount <= 0) {
          toast('Masukkan nominal offer yang valid'); return false
        }
        if (!Object.keys(n.selection).length) {
          toast('Pilih minimal satu deliverable'); return false
        }
        update(id, d => {
          const v = d.offers.length + 1
          d.offers.push({
            v, by: 'brand', amount, note: note || 'Offer awal', at: NOW,
            snapshot: snapshotTerms(d, amount),
          })
          d.stage = 'negotiation'
          d.offerState = 'sent'
          d.sentAt = NOW
          say(d, `Offer v${v} dikirim — ${idr(amount)} (${deliverableSummary(d.selection, catalogue)})`)
          d.changes.push({ field: `Offer v${v} dikirim senilai ${idr(amount)}`, at: NOW })
        })
        toast(`Offer dikirim ke ${n.creatorName}`)
        return true
      },

      counter: (id, by, amount, note) => {
        if (!Number.isFinite(amount) || amount <= 0) {
          toast('Masukkan nominal counter'); return false
        }
        update(id, n => {
          const v = n.offers.length + 1
          n.offers.push({
            v, by, amount, note: note || 'Counter offer', at: NOW,
            snapshot: snapshotTerms(n, amount),
          })
          if (by === 'brand') {
            n.offerState = 'sent'
            n.sentAt = NOW
            say(n, `Counter dari brand — Offer v${v} senilai ${idr(amount)}`)
          } else {
            n.offerState = 'counter'
            say(n, `${n.creatorName} counter — Offer v${v} senilai ${idr(amount)}`)
          }
        })
        toast('Counter offer terkirim')
        return true
      },

      creatorAccept: id => update(id, n => {
        const last = n.offers[n.offers.length - 1]
        if (!last) return
        n.offerState = 'accepted'
        n.finalPrice = last.amount
        n.stage = 'agreement-pending'
        n.agreement = buildAgreement(n, last.amount)
        n.changes.push({
          field: `Harga disepakati di ${idr(last.amount)} (Offer v${last.v}) — Final Agreement disusun`,
          at: NOW,
        })
        say(n, `Harga disepakati di ${idr(last.amount)} — tinjau Final Agreement di tab Agreement.`)
      }),

      creatorReject: id => update(id, n => {
        n.offerState = 'rejected'
        n.stage = 'rejected'
        say(n, `${n.creatorName} menolak offer.`)
      }),

      markViewed: id => update(id, n => {
        if (n.offerState !== 'sent' && n.offerState !== 'delivered') return
        n.offerState = 'viewed'
        n.viewedAt = NOW
        say(n, `${n.creatorName} membuka Offer v${n.offers.length}.`)
      }),

      expireOffer: id => update(id, n => {
        if (n.stage !== 'negotiation') return
        n.offerState = 'expired'
        say(n, `Offer v${n.offers.length} kedaluwarsa tanpa jawaban.`)
      }),

      newOfferDraft: id => update(id, n => {
        n.stage = 'draft'
        n.offerState = 'draft'
        n.draft = { price: '', note: '' }
        say(n, 'Menyusun offer baru — versi sebelumnya tetap tersimpan di riwayat.')
      }),

      withdrawOffer: id => update(id, n => {
        if (n.offers.some(o => o.by === 'creator')) {
          return
        }
        n.offers.pop()
        n.stage = 'draft'
        n.offerState = 'draft'
        say(n, 'Offer ditarik kembali sebelum dijawab.')
      }),

      send: (id, by, text) => update(id, n => {
        const t = text.trim()
        if (!t) return
        n.chat.push({ by, text: t, at: NOW })
      }),

      patchTerms: (id, patch) => update(id, n => {
        const t = activeTerms(n)
        Object.assign(t, patch)
        log(n, 'Ketentuan diperbarui')
      }),

      toggleRule: (id, group, ruleId) => update(id, n => {
        const t = activeTerms(n)
        const rule = (t[group] as Rule[]).find(r => r.id === ruleId)
        if (!rule) return
        rule.on = !rule.on
        log(n, `${rule.label} ${rule.on ? 'diaktifkan' : 'dinonaktifkan'}`)
      }),

      setRuleAmount: (id, group, ruleId, amount) => update(id, n => {
        const t = activeTerms(n)
        const rule = (t[group] as Rule[]).find(r => r.id === ruleId)
        if (!rule) return
        rule.amount = Math.max(0, Math.round(amount) || 0)
        log(n, `${rule.label} → ${idr(rule.amount)}`)
      }),

      setPayTerms: (id, terms) => update(id, n => {
        activeTerms(n).payTerms = terms
        log(n, `Termin pembayaran diusulkan: ${terms}`)
      }),

      setMilestones: (id, milestones) => update(id, n => {
        activeTerms(n).milestones = milestones
        log(n, 'Milestone pembayaran diperbarui')
      }),

      setKpi: (id, key, value) => update(id, n => {
        const t = activeTerms(n)
        t.kpi[key] = Math.max(0, Math.round(value) || 0)
        // Reach and engagement targets are the KPI matrix, aggregated. Keeping
        // them derived means the settlement can never disagree with the table
        // the two parties were looking at.
        t.targets.reach = t.kpi.views
        t.targets.engagement = t.kpi.likes + t.kpi.comments
        log(n, `KPI ${key} → ${t.kpi[key].toLocaleString('id-ID')}`)
      }),

      accept: (id, party, catalogue) => {
        const n = items.find(x => x.id === id)
        const a = n?.agreement
        if (!n || !a) return null
        if (a.payTerms === 'milestone') {
          const total = milestoneTotal(a.milestones)
          if (total !== 100) {
            return `Milestone kustom harus berjumlah 100% (sekarang ${total}%) sebelum agreement bisa diterima`
          }
        }
        if (party === 'brand' && !a.accept.creator) {
          return 'Influencer menerima lebih dulu — brand lalu mengonfirmasi dan mengunci agreement'
        }
        update(id, d => {
          const ag = d.agreement!
          ag.accept[party] = true
          d.changes.push({
            field: party === 'brand'
              ? 'Brand/agency mengonfirmasi Final Agreement'
              : 'Influencer menerima Final Agreement',
            at: NOW,
          })
          if (ag.accept.brand && ag.accept.creator) {
            ag.locked = true
            d.stage = 'agreed'
            ag.schedule = buildSchedule(ag, d.finalPrice ?? 0)
            d.deliverables = buildDeliverables(d.selection, catalogue)
            d.changes.push({ field: 'Final Agreement terkunci — jadi acuan campaign dan perhitungan pembayaran', at: NOW })
            say(d, 'Final Agreement terkunci — checkout dan campaign terbuka.')
          }
        })
        toast(party === 'creator'
          ? 'Influencer menerima — menunggu konfirmasi brand'
          : 'Final Agreement terkunci')
        return null
      },

      amend: id => update(id, n => {
        if (!n.agreement?.locked) return
        n.agreement.locked = false
        n.agreement.accept = { brand: false, creator: false }
        n.stage = 'agreement-pending'
        n.amendments += 1
        n.changes.push({
          field: `Amendment #${n.amendments} diajukan — perubahan tercatat dan kedua pihak harus menerima ulang`,
          at: NOW,
        })
        say(n, `Amendment #${n.amendments} dibuka — agreement terbuka untuk perubahan tercatat.`)
      }),

      close: (id, reason, note) => update(id, n => {
        n.stage = 'closed'
        n.closeReason = reason
        say(n, `Negosiasi ditutup — ${reason}${note ? `: ${note}` : ''}`)
      }),

      reopen: id => update(id, n => {
        n.stage = 'negotiation'
        const last = n.offers[n.offers.length - 1]
        n.offerState = last?.by === 'creator' ? 'counter' : 'viewed'
        n.closeReason = undefined
        say(n, 'Negosiasi dibuka kembali — riwayat offer tetap utuh.')
      }),

      payMilestone: (id, index) => update(id, n => {
        const row = n.agreement?.schedule?.[index]
        if (!row || row.paid) return
        row.paid = true
        n.paid += row.amount
        n.payments.push({
          label: `${row.label} (${row.pct}%)`,
          amount: row.amount,
          at: NOW,
          receipt: `PAY-${6000 + n.payments.length}`,
        })
      }),

      startCampaign: id => update(id, n => {
        if (n.stage !== 'agreed') return
        n.stage = 'active'
        if (!n.deliverables.length) n.deliverables = buildDeliverables(n.selection)
        say(n, 'Campaign dimulai — pelacakan deliverable aktif.')
      }),

      deliverableAction: (id, key, action, feedback) => update(id, n => {
        const d = n.deliverables.find(x => x.key === key)
        if (!d) return
        const applied = applyDeliverableAction(d, action, feedback)
        if (!applied) return
        say(n, applied)
        n.contentStage = contentStageOf(n.deliverables)
      }),

      completeCampaign: (id, actuals) => update(id, n => {
        n.actuals = actuals
        n.stage = 'evaluation'
        say(n, 'Campaign selesai — hasil akhir dihitung dari aturan yang disepakati.')
      }),

      confirmEvaluation: id => update(id, n => {
        n.stage = 'payment-pending'
        n.changes.push({ field: 'Evaluasi dikonfirmasi — pembayaran akhir jatuh tempo', at: NOW })
      }),

      payFinal: id => update(id, n => {
        const ev = evaluate(n)
        if (!ev) return
        const due = Math.max(0, ev.final - n.paid)
        n.paid += due
        n.payments.push({
          label: 'Pelunasan (Guaranteed + Performance + Bonus − Penyesuaian, dikurangi milestone terbayar)',
          amount: due,
          at: NOW,
          receipt: `PAY-${6000 + n.payments.length}`,
        })
        const finalRow = n.agreement?.schedule?.find(r => r.payAt === 'evaluation')
        if (finalRow) { finalRow.paid = true; finalRow.amount = due }
        n.stage = 'paid'
        say(n, `Pelunasan ${idr(due)} dibayarkan ke ${n.creatorName}.`)
      }),

      finish: id => update(id, n => {
        n.stage = 'completed'
        say(n, 'Campaign ditutup — laporan akhir tersedia.')
      }),
    }
  }, [items, ready, commit, update, toast])

  return api
}

/**
 * The deliverable state machine, as one function so the legal transitions live
 * in one place. Returns the log line for the transition, or null if the action
 * is not available from the current status.
 */
function applyDeliverableAction(
  d: DeliverableItem,
  action: 'submit' | 'approve' | 'revise' | 'schedule' | 'publish',
  feedback?: string,
): string | null {
  const next = (status: DeliverableStatus) => { d.status = status }

  if (action === 'submit' && (d.status === 'waiting' || d.status === 'revision')) {
    const isRedo = d.status === 'revision'
    next(isRedo ? 'resubmitted' : 'submitted')
    d.versions.push(`v${d.versions.length + 1}${isRedo ? ` dikirim ulang setelah Revisi #${d.revisions}` : ' dikirim'}`)
    return `${d.label} ${isRedo ? 'dikirim ulang' : 'dikirim'} untuk direview.`
  }
  if (action === 'approve' && (d.status === 'submitted' || d.status === 'resubmitted')) {
    next('approved')
    return `${d.label} disetujui brand/agency.`
  }
  if (action === 'revise' && (d.status === 'submitted' || d.status === 'resubmitted')) {
    d.revisions += 1
    d.feedback = feedback?.trim() || 'Mohon sesuaikan CTA dan penempatan produk.'
    next('revision')
    return `${d.label} — Revisi #${d.revisions} diminta: "${d.feedback}"`
  }
  if (action === 'schedule' && d.status === 'approved') {
    next('scheduled')
    return `${d.label} dijadwalkan sesuai jadwal posting yang disepakati.`
  }
  if (action === 'publish' && ['approved', 'scheduled'].includes(d.status)) {
    next('published')
    d.publishedAt = NOW
    return `${d.label} tayang.`
  }
  return null
}

/** Tone → the palette used by status pills across Discover. */
export const TONE_CLASS: Record<StageTone, string> = {
  neutral: 'bg-[#f3f4f6] text-[#6b7280] border-[#e5e7eb]',
  live: 'bg-[#f0f7fa] text-[#285D6E] border-[#A7C8D4]',
  good: 'bg-[#eaf6f1] text-[#2f7d63] border-[#b6e0cd]',
  bad: 'bg-[#fcefec] text-[#c2553f] border-[#f0c8bf]',
}
