/**
 * Negotiation — the deal between a brand and one creator, from draft offer to
 * final settlement.
 *
 * Ported from the source platform's `pages/negotiation.js`, the one part of KOL
 * Intelligence autometric had no equivalent of. Everything before it (find,
 * analyse, compare) and everything after it (cart, order, campaign dashboard)
 * was already here; this is the middle — agreeing what will be delivered, for
 * how much, on what terms, and what happens when the numbers come in.
 *
 * The model it encodes is the reason this is worth porting rather than reducing
 * to a price field. A deal is split into two fees:
 *
 *   * a **Guaranteed Fee**, paid for the work itself. It is protected: if the
 *     creator delivers what was agreed, they are paid it in full no matter how
 *     the content performs. Only *missing deliverables* prorate it.
 *   * a **Performance Fee**, earned in tiers against agreed KPI targets. Falling
 *     short reduces this and only this — under-performance never becomes a debt.
 *
 * On top sit three symmetric rule sets, each individually switchable and priced:
 * **bonuses** (upside the brand pays for), **penalties** (the brand's recourse
 * for contract breaches — not for weak numbers), and **protections** (the
 * creator's recourse when the brand is the one who slipped: late assets, late
 * approvals, a rewritten brief, a cancellation after work started). The
 * settlement is one formula over all of it, and both sides accept the same
 * document before any of it binds.
 *
 * Pure and client-safe — no `pg` import. The store that holds these lives in
 * `@/components/discover/useNegotiations`; per the current scope it persists to
 * localStorage, so the shapes here are what a future migration will need to
 * become tables, and nothing in this file assumes otherwise.
 */

import { findDeliverable, unitPrice, type Deliverable, type RateCard } from './vocab'

/* ── money ────────────────────────────────────────────────────────────────── */

/** Rupiah, integer throughout — see `orders.ts` for why nothing here floats. */
export const idr = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID')

/** Rounds to the nearest 10.000 IDR — the granularity people actually negotiate at. */
const round10k = (n: number) => Math.round(n / 10_000) * 10_000

/* ── the deal's lifecycle ─────────────────────────────────────────────────── */

/**
 * Stages, in order. `rejected` and `closed` are terminal exits rather than
 * points on the line: the first is the creator declining an offer, the second is
 * the brand walking away.
 */
export const NEGO_STAGES = [
  'draft', 'negotiation', 'agreement-pending', 'agreed',
  'active', 'evaluation', 'payment-pending', 'paid', 'completed',
] as const

export type NegoStage = (typeof NEGO_STAGES)[number] | 'rejected' | 'closed'

export type StageTone = 'neutral' | 'live' | 'good' | 'bad'

export const STAGE_LABEL: Record<NegoStage, { label: string; tone: StageTone }> = {
  draft: { label: 'Draft Offer', tone: 'neutral' },
  negotiation: { label: 'Negosiasi', tone: 'live' },
  rejected: { label: 'Ditolak', tone: 'bad' },
  closed: { label: 'Ditutup · Tidak Sepakat', tone: 'bad' },
  'agreement-pending': { label: 'Harga Deal · Agreement Pending', tone: 'live' },
  agreed: { label: 'Final Agreement ✓', tone: 'good' },
  active: { label: 'Campaign Aktif', tone: 'live' },
  evaluation: { label: 'Evaluasi', tone: 'neutral' },
  'payment-pending': { label: 'Menunggu Pembayaran', tone: 'neutral' },
  paid: { label: 'Dibayar', tone: 'good' },
  completed: { label: 'Selesai', tone: 'good' },
}

/** The journey rail shown above a deal. Terminal exits are not on it. */
export const NEGO_FLOW: { stage: NegoStage; label: string; icon: string }[] = [
  { stage: 'negotiation', label: 'Negosiasi', icon: 'handshake' },
  { stage: 'agreement-pending', label: 'Agreement', icon: 'gavel' },
  { stage: 'agreed', label: 'Sepakat', icon: 'task_alt' },
  { stage: 'active', label: 'Campaign', icon: 'rocket_launch' },
  { stage: 'evaluation', label: 'Evaluasi', icon: 'query_stats' },
  { stage: 'payment-pending', label: 'Pembayaran', icon: 'schedule' },
  { stage: 'paid', label: 'Dibayar', icon: 'paid' },
  { stage: 'completed', label: 'Selesai', icon: 'flag_circle' },
]

export const stageIndex = (stage: NegoStage) => NEGO_FLOW.findIndex(f => f.stage === stage)

/** Where an offer sits between sent and answered. */
export type OfferState =
  | 'draft' | 'sent' | 'delivered' | 'viewed'
  | 'accepted' | 'counter' | 'rejected' | 'expired'

export const OFFER_STATE_LABEL: Record<OfferState, string> = {
  draft: 'Draft',
  sent: 'Terkirim',
  delivered: 'Sampai di inbox',
  viewed: 'Sudah dibuka',
  accepted: 'Diterima',
  counter: 'Counter Offer',
  rejected: 'Ditolak',
  expired: 'Kedaluwarsa',
}

/* ── the rule sets ────────────────────────────────────────────────────────── */

export interface RuleDef {
  id: string
  label: string
  desc: string
  /** Default share of the deal's list price, used to seed `amount`. */
  pct: number
  /** On by default — the source's opinionated starting point. */
  on: boolean
}

/** Upside the brand agrees to pay for. */
export const BONUS_DEFS: RuleDef[] = [
  { id: 'reach', label: 'Reach Bonus', desc: 'Reach aktual melewati target yang disepakati.', pct: 0.05, on: true },
  { id: 'eng', label: 'Engagement Bonus', desc: 'Engagement aktual melewati target yang disepakati.', pct: 0.05, on: false },
  { id: 'views', label: 'View Bonus', desc: 'Performa views melewati benchmark yang disepakati.', pct: 0.05, on: false },
  { id: 'conv', label: 'Conversion Bonus', desc: 'Konversi terlacak melewati benchmark yang disepakati.', pct: 0.05, on: false },
  { id: 'top', label: 'Top Content Bonus', desc: 'Konten masuk jajaran post terbaik brand.', pct: 0.05, on: false },
]

/**
 * The brand's recourse — for breaches of the agreement, never for weak numbers.
 * Performance below target reduces the Performance Fee and nothing else; that
 * separation is the whole point of splitting the fee in two.
 */
export const PENALTY_DEFS: RuleDef[] = [
  { id: 'missing', label: 'Deliverable tidak lengkap', desc: 'Deliverable yang disepakati tidak diselesaikan.', pct: 0.075, on: true },
  { id: 'deletion', label: 'Konten dihapus tanpa izin', desc: 'Konten dihapus sebelum masa tayang yang disepakati berakhir.', pct: 0.075, on: true },
  { id: 'brief', label: 'Brief tidak diikuti', desc: 'Ketentuan campaign yang disepakati tidak dijalankan.', pct: 0.075, on: false },
]

/** The creator's recourse, for when the brand is the one who slipped. */
export const PROTECTION_DEFS: RuleDef[] = [
  { id: 'materials', label: 'Materi terlambat', desc: 'Brand/agency mengirim aset melewati tenggat.', pct: 0.05, on: true },
  { id: 'approval', label: 'Approval terlambat', desc: 'Approval brand/agency melewati jendela yang disepakati.', pct: 0.05, on: false },
  { id: 'briefchange', label: 'Perubahan brief besar', desc: 'Brief berubah signifikan setelah pekerjaan dimulai.', pct: 0.05, on: false },
  { id: 'cancel', label: 'Pembatalan setelah mulai', desc: 'Campaign dibatalkan setelah pekerjaan dimulai.', pct: 0.05, on: true },
]

export interface Rule {
  id: string
  label: string
  desc: string
  on: boolean
  amount: number
}

const seedRules = (defs: RuleDef[], listPrice: number): Rule[] =>
  defs.map(d => ({
    id: d.id, label: d.label, desc: d.desc, on: d.on,
    amount: Math.max(10_000, round10k(listPrice * d.pct)),
  }))

/* ── performance tiers ────────────────────────────────────────────────────── */

/**
 * Achievement against the agreed KPI targets, and the share of the Performance
 * Fee it earns. Below 60% earns none of it — and still leaves the Guaranteed Fee
 * untouched, which is the promise the tier table exists to make legible.
 */
export const PERF_TIERS: { min: number; earns: number; note: string }[] = [
  { min: 100, earns: 100, note: 'Target tercapai penuh' },
  { min: 80, earns: 70, note: 'Hasil kuat, sedikit di bawah target' },
  { min: 60, earns: 40, note: 'Hasil sebagian' },
  { min: 0, earns: 0, note: 'Di bawah 60% — Guaranteed Fee tetap terlindungi' },
]

export const perfTierOf = (achievementPct: number) =>
  PERF_TIERS.find(t => achievementPct >= t.min)?.earns ?? 0

/* ── payment terms ────────────────────────────────────────────────────────── */

export type PayTerms = 'after' | 'split50' | 'milestone' | 'upfront'

export const PAY_TERMS_LABEL: Record<PayTerms, string> = {
  after: '100% setelah campaign',
  split50: '50% di muka + 50% setelah campaign',
  milestone: 'Termin milestone kustom',
  upfront: '100% di muka',
}

export interface Milestone {
  label: string
  pct: number
}

export interface ScheduleRow {
  label: string
  pct: number
  /** `evaluation` rows are settled by the final calculation, not by their pct. */
  payAt: 'progress' | 'evaluation'
  amount: number
  paid: boolean
}

/* ── the deal ─────────────────────────────────────────────────────────────── */

export interface KpiTargets {
  likes: number
  comments: number
  views: number
}

export interface DealTerms {
  start: string
  end: string
  dueDate: string
  /** Guaranteed Fee as a percentage of the agreed price. */
  guaranteedPct: number
  payTerms: PayTerms
  milestones: Milestone[]
  targets: { reach: number; engagement: number }
  kpi: KpiTargets
  /** Minimum sound duration for video deliverables. */
  soundDuration: string
  bonuses: Rule[]
  penalties: Rule[]
  protections: Rule[]
  respBrand: string
  respCreator: string
}

/** The terms as frozen when the price was agreed, plus who has signed. */
export interface Agreement extends DealTerms {
  guaranteed: number
  performance: number
  accept: { brand: boolean; creator: boolean }
  locked: boolean
  schedule?: ScheduleRow[]
}

export interface Offer {
  v: number
  by: 'brand' | 'creator'
  amount: number
  note: string
  at: string
  /** The terms as they stood when this version was sent. */
  snapshot: {
    selection: Record<string, number>
    guaranteed: number
    performance: number
    payTerms: PayTerms
    targets: { reach: number; engagement: number }
    kpi: KpiTargets
  }
}

export interface ChatMessage {
  by: 'brand' | 'creator' | 'system'
  text: string
  at: string
}

export interface ChangeEntry {
  field: string
  at: string
}

export type DeliverableStatus =
  | 'waiting' | 'submitted' | 'resubmitted' | 'revision'
  | 'approved' | 'scheduled' | 'published'

export const DELIVERABLE_STATUS: Record<DeliverableStatus, { label: string; tone: StageTone }> = {
  waiting: { label: 'Menunggu konten', tone: 'neutral' },
  submitted: { label: 'Dikirim', tone: 'live' },
  resubmitted: { label: 'Dikirim ulang', tone: 'live' },
  revision: { label: 'Perlu revisi', tone: 'bad' },
  approved: { label: 'Disetujui ✓', tone: 'good' },
  scheduled: { label: 'Terjadwal', tone: 'live' },
  published: { label: 'Tayang ✓', tone: 'good' },
}

export interface DeliverableItem {
  key: string
  deliverableId: string
  label: string
  icon: string
  status: DeliverableStatus
  revisions: number
  feedback: string
  url: string
  publishedAt: string
  versions: string[]
  perf: { reach: number; views: number; likes: number; comments: number; erPct: number } | null
}

export const CONTENT_STAGES = [
  'Konten pending', 'Konten dikirim', 'Konten disetujui', 'Konten tayang',
] as const

export interface Actuals {
  reach: number
  engagement: number
  /** Every agreed deliverable was completed. */
  delivered: boolean
  /** Share of deliverables completed, when not all were. */
  deliveredRatio: number
  viewsHit: boolean
  convHit: boolean
  topHit: boolean
  /** Ids of `PENALTY_DEFS` that occurred. */
  violations: string[]
  /** Ids of `PROTECTION_DEFS` that occurred. */
  brandIssues: string[]
}

export interface Payment {
  label: string
  amount: number
  at: string
  receipt: string
}

export interface Negotiation {
  id: string
  /** The tracked account this deal is with, plus enough to render it offline. */
  accountId: string
  relation: 'owned' | 'competitor'
  creatorName: string
  platform: string
  /** deliverableId → quantity. */
  selection: Record<string, number>
  /** Rate-card total for `selection` when the first offer went out. */
  listPrice: number
  stage: NegoStage
  offerState: OfferState
  offers: Offer[]
  chat: ChatMessage[]
  changes: ChangeEntry[]
  terms: DealTerms
  agreement: Agreement | null
  draft: { price: string; note: string }
  finalPrice: number | null
  paid: number
  payments: Payment[]
  deliverables: DeliverableItem[]
  contentStage: number
  actuals: Actuals | null
  amendments: number
  closeReason?: string
  sentAt?: string
  viewedAt?: string
}

/* ── pricing ──────────────────────────────────────────────────────────────── */

/** Rate-card total for a selection — the number a negotiation starts from. */
export function listPriceOf(
  selection: Record<string, number>,
  rate: RateCard | null | undefined,
  catalogue: Deliverable[] = [],
): number {
  const base = rate?.baseRate ?? 0
  return Object.entries(selection).reduce((sum, [id, qty]) => {
    const d = catalogue.find(x => x.id === id) ?? findDeliverable(id)
    return d ? sum + unitPrice(base, d.mult) * qty : sum
  }, 0)
}

export function deliverableSummary(
  selection: Record<string, number>,
  catalogue: Deliverable[] = [],
): string {
  return Object.entries(selection)
    .map(([id, qty]) => {
      const d = catalogue.find(x => x.id === id) ?? findDeliverable(id)
      return d ? `${qty}× ${d.label}` : ''
    })
    .filter(Boolean)
    .join(' · ')
}

export const totalUnits = (selection: Record<string, number>) =>
  Object.values(selection).reduce((n, q) => n + q, 0)

/* ── creating a deal ──────────────────────────────────────────────────────── */

const now = () => 'Baru saja'

export interface NewNegotiationInput {
  id: string
  accountId: string
  relation: 'owned' | 'competitor'
  creatorName: string
  platform: string
  selection: Record<string, number>
  listPrice: number
  /** Seeds the KPI targets, so the first offer argues from real numbers. */
  estimate: { reach: number; engagement: number; likes: number; comments: number }
  /** Campaign window, as ISO dates. */
  start: string
  end: string
  dueDate: string
}

export function newNegotiation(input: NewNegotiationInput): Negotiation {
  const { estimate: e, listPrice } = input
  return {
    id: input.id,
    accountId: input.accountId,
    relation: input.relation,
    creatorName: input.creatorName,
    platform: input.platform,
    selection: { ...input.selection },
    listPrice,
    stage: 'draft',
    offerState: 'draft',
    offers: [],
    chat: [{
      by: 'system',
      text: `Ruang negosiasi dibuka — chat dan setiap versi offer tetap menempel pada ${input.creatorName} dan deal ini.`,
      at: now(),
    }],
    changes: [{
      field: 'Draft offer dibuat dari rate card (titik awal, bukan harga final)',
      at: now(),
    }],
    terms: {
      start: input.start,
      end: input.end,
      dueDate: input.dueDate,
      // The source's default: most of the deal is guaranteed, the rest is at
      // risk on performance. Editable, and the split is what both sides argue
      // about most, so it is the first control on the Terms tab.
      guaranteedPct: 78,
      payTerms: 'after',
      milestones: [
        { label: 'Campaign mulai', pct: 30 },
        { label: 'Konten tayang', pct: 40 },
        { label: 'Campaign selesai', pct: 30 },
      ],
      targets: { reach: Math.round(e.reach), engagement: Math.round(e.engagement) },
      kpi: {
        likes: Math.round(e.likes),
        comments: Math.round(e.comments),
        views: Math.round(e.reach),
      },
      soundDuration: '30 detik',
      bonuses: seedRules(BONUS_DEFS, listPrice),
      penalties: seedRules(PENALTY_DEFS, listPrice),
      protections: seedRules(PROTECTION_DEFS, listPrice),
      respBrand: 'Menyediakan brief, aset brand dan approval dalam 48 jam; menyediakan tracking link; membayar sesuai tenggat yang disepakati.',
      respCreator: 'Mengirim konten sesuai jadwal, mengikuti brief dan aturan disclosure, menjaga konten tetap tayang selama periode yang disepakati, dan membagikan data performa.',
    },
    agreement: null,
    draft: { price: '', note: '' },
    finalPrice: null,
    paid: 0,
    payments: [],
    deliverables: [],
    contentStage: 0,
    actuals: null,
    amendments: 0,
  }
}

/** The live terms: the frozen agreement once there is one, the draft before. */
export const activeTerms = (n: Negotiation): DealTerms => n.agreement ?? n.terms

/** Snapshot of the terms as they stand, attached to an offer version. */
export function snapshotTerms(n: Negotiation, amount: number): Offer['snapshot'] {
  const t = activeTerms(n)
  const guaranteed = Math.round((amount * t.guaranteedPct) / 100)
  return {
    selection: { ...n.selection },
    guaranteed,
    performance: amount - guaranteed,
    payTerms: t.payTerms,
    targets: { ...t.targets },
    kpi: { ...t.kpi },
  }
}

/**
 * Freeze the agreed price into an Agreement both sides then have to accept.
 *
 * The Guaranteed Fee is rounded to 10.000 and the Performance Fee takes the
 * remainder, so the two always sum to exactly the agreed price — rounding both
 * independently is how a contract ends up not adding up to itself.
 */
export function buildAgreement(n: Negotiation, finalPrice: number): Agreement {
  const t = n.terms
  const guaranteed = round10k((finalPrice * t.guaranteedPct) / 100)
  return {
    ...t,
    milestones: t.milestones.map(m => ({ ...m })),
    targets: { ...t.targets },
    kpi: { ...t.kpi },
    bonuses: t.bonuses.map(r => ({ ...r })),
    penalties: t.penalties.map(r => ({ ...r })),
    protections: t.protections.map(r => ({ ...r })),
    guaranteed,
    performance: finalPrice - guaranteed,
    accept: { brand: false, creator: false },
    locked: false,
  }
}

/** The payment rows implied by the agreed terms, priced against `finalPrice`. */
export function buildSchedule(agreement: Agreement, finalPrice: number): ScheduleRow[] {
  const rows: Omit<ScheduleRow, 'amount' | 'paid'>[] =
    agreement.payTerms === 'split50'
      ? [
          { label: 'Di muka — campaign mulai', pct: 50, payAt: 'progress' },
          { label: 'Pelunasan — setelah evaluasi', pct: 50, payAt: 'evaluation' },
        ]
      : agreement.payTerms === 'upfront'
        ? [{ label: 'Pembayaran penuh — campaign mulai', pct: 100, payAt: 'progress' }]
        : agreement.payTerms === 'milestone'
          ? agreement.milestones.map((m, i) => ({
              label: m.label,
              pct: m.pct,
              // The last milestone absorbs the evaluation result, so the
              // settlement has somewhere to land under any terms.
              payAt: i === agreement.milestones.length - 1 ? 'evaluation' as const : 'progress' as const,
            }))
          : [{ label: 'Pelunasan — setelah evaluasi', pct: 100, payAt: 'evaluation' }]

  return rows.map(r => ({
    ...r,
    amount: Math.round((finalPrice * r.pct) / 100),
    paid: false,
  }))
}

export function scheduleRowStatus(
  n: Negotiation, index: number,
): { label: string; tone: StageTone } {
  const schedule = n.agreement?.schedule
  if (!schedule) return { label: 'Pending', tone: 'neutral' }
  const row = schedule[index]
  if (row.paid) return { label: 'Dibayar', tone: 'good' }
  const previousSettled = schedule.slice(0, index).every(r => r.paid)
  const due = previousSettled && (
    row.payAt === 'evaluation'
      ? n.stage === 'payment-pending'
      : ['active', 'evaluation', 'payment-pending'].includes(n.stage)
  )
  return due ? { label: 'Jatuh tempo', tone: 'live' } : { label: 'Pending', tone: 'neutral' }
}

/* ── settlement ───────────────────────────────────────────────────────────── */

export interface RuleOutcome {
  label: string
  amount: number
  hit: boolean
}

export interface Evaluation {
  /** Achievement against the agreed targets, as a percentage. */
  achievementPct: number
  /** Share of the Performance Fee earned, per `PERF_TIERS`. */
  tierPct: number
  performanceEarned: number
  guaranteedEarned: number
  bonus: number
  bonusRows: RuleOutcome[]
  penalty: number
  penaltyRows: RuleOutcome[]
  protection: number
  protectionRows: RuleOutcome[]
  /** Penalties owed to the brand, less protections owed to the creator. */
  adjustment: number
  final: number
  guaranteedNote: string
  performanceNote: string
}

/**
 * The settlement, as one function over the agreement and the actuals.
 *
 * Achievement averages the two agreed targets — reach and engagement — rather
 * than picking one, because a deal that hits reach and misses engagement is
 * neither a success nor a failure and the fee should say so.
 */
export function evaluate(n: Negotiation): Evaluation | null {
  const a = n.agreement
  const actual = n.actuals
  if (!a || !actual) return null

  const t = a.targets
  const reachRatio = t.reach > 0 ? actual.reach / t.reach : 0
  const engRatio = t.engagement > 0 ? actual.engagement / t.engagement : 0
  const achievementPct = Math.round(((reachRatio + engRatio) / 2) * 100)

  const tierPct = perfTierOf(achievementPct)
  const performanceEarned = Math.round((a.performance * tierPct) / 100)

  // Delivering the agreed work protects the Guaranteed Fee in full. Not
  // delivering it prorates that fee — and may also trip the missing-deliverable
  // penalty below, which is a separate, agreed consequence.
  const guaranteedEarned = actual.delivered
    ? a.guaranteed
    : Math.round(a.guaranteed * actual.deliveredRatio)

  const bonusRows: RuleOutcome[] = []
  let bonus = 0
  for (const b of a.bonuses) {
    if (!b.on) continue
    const hit =
      b.id === 'reach' ? actual.reach > t.reach
      : b.id === 'eng' ? actual.engagement > t.engagement
      : b.id === 'views' ? actual.viewsHit
      : b.id === 'conv' ? actual.convHit
      : actual.topHit
    bonusRows.push({ label: b.label, amount: b.amount, hit })
    if (hit) bonus += b.amount
  }

  const penaltyRows: RuleOutcome[] = []
  let penalty = 0
  for (const p of a.penalties) {
    if (!p.on) continue
    const hit = actual.violations.includes(p.id)
    penaltyRows.push({ label: p.label, amount: p.amount, hit })
    if (hit) penalty += p.amount
  }

  const protectionRows: RuleOutcome[] = []
  let protection = 0
  for (const p of a.protections) {
    if (!p.on) continue
    const hit = actual.brandIssues.includes(p.id)
    protectionRows.push({ label: p.label, amount: p.amount, hit })
    if (hit) protection += p.amount
  }

  const adjustment = penalty - protection
  const final = Math.max(0, guaranteedEarned + performanceEarned + bonus - adjustment)

  return {
    achievementPct, tierPct, performanceEarned, guaranteedEarned,
    bonus, bonusRows, penalty, penaltyRows, protection, protectionRows,
    adjustment, final,
    guaranteedNote: actual.delivered
      ? 'Semua deliverable yang disepakati selesai — Guaranteed Fee terlindungi penuh, terlepas dari performa.'
      : 'Sebagian deliverable tidak selesai — Guaranteed Fee diprorata sesuai pekerjaan yang dikirim, dan penalti deliverable tidak lengkap berlaku bila diaktifkan.',
    performanceNote: `Achievement ${achievementPct}% dari target KPI → ${tierPct}% Performance Fee diperoleh. Performa di bawah target hanya mengurangi Performance Fee — tidak pernah menjadi penalti.`,
  }
}

/* ── deliverables ─────────────────────────────────────────────────────────── */

/** One tracked item per unit ordered — three Reels are three things to review. */
export function buildDeliverables(
  selection: Record<string, number>,
  catalogue: Deliverable[] = [],
): DeliverableItem[] {
  const out: DeliverableItem[] = []
  for (const [id, qty] of Object.entries(selection)) {
    const d = catalogue.find(x => x.id === id) ?? findDeliverable(id)
    if (!d) continue
    for (let i = 1; i <= qty; i++) {
      out.push({
        key: `${id}-${i}`,
        deliverableId: id,
        label: d.label + (qty > 1 ? ` #${i}` : ''),
        icon: d.icon,
        status: 'waiting',
        revisions: 0,
        feedback: '',
        url: '',
        publishedAt: '',
        versions: [],
        perf: null,
      })
    }
  }
  return out
}

/** Content stage derived from the items, never set independently of them. */
export function contentStageOf(items: DeliverableItem[]): number {
  if (!items.length) return 0
  const submittedOrLater = ['submitted', 'resubmitted', 'approved', 'scheduled', 'published']
  const approvedOrLater = ['approved', 'scheduled', 'published']
  if (items.every(d => d.status === 'published')) return 3
  if (items.every(d => approvedOrLater.includes(d.status))) return 2
  if (items.some(d => submittedOrLater.includes(d.status))) return 1
  return 0
}

/** Which transitions a reviewer can make from a given status. */
export function deliverableActions(status: DeliverableStatus): {
  id: 'submit' | 'approve' | 'revise' | 'schedule' | 'publish'
  label: string
  icon: string
  primary?: boolean
}[] {
  switch (status) {
    case 'waiting':
      return [{ id: 'submit', label: 'Tandai dikirim', icon: 'upload', primary: true }]
    case 'revision':
      return [{ id: 'submit', label: 'Tandai dikirim ulang', icon: 'upload', primary: true }]
    case 'submitted':
    case 'resubmitted':
      return [
        { id: 'approve', label: 'Setujui', icon: 'check', primary: true },
        { id: 'revise', label: 'Minta revisi', icon: 'edit_note' },
      ]
    case 'approved':
      return [
        { id: 'publish', label: 'Tandai tayang', icon: 'publish', primary: true },
        { id: 'schedule', label: 'Jadwalkan', icon: 'schedule' },
      ]
    case 'scheduled':
      return [{ id: 'publish', label: 'Tandai tayang', icon: 'publish', primary: true }]
    default:
      return []
  }
}

/* ── guards ───────────────────────────────────────────────────────────────── */

/** Stages where the price and the deliverable mix can still move. */
export const isNegotiable = (n: Negotiation) =>
  n.stage === 'draft' || n.stage === 'negotiation'

/** A locked agreement is the source of truth; amending it reopens acceptance. */
export const isLocked = (n: Negotiation) => !!n.agreement?.locked

/** Checkout, campaign and payment all wait on a fully executed agreement. */
export const isExecuted = (n: Negotiation) =>
  !!n.agreement?.locked && !!n.finalPrice

/** Custom milestones have to total 100% before anyone can accept. */
export const milestoneTotal = (milestones: Milestone[]) =>
  milestones.reduce((s, m) => s + m.pct, 0)

export const CLOSE_REASONS = [
  'Harga tidak sesuai budget',
  'Deliverable tidak sesuai kebutuhan',
  'Jadwal campaign bentrok',
  'Lainnya',
] as const

/* ── glossary ─────────────────────────────────────────────────────────────── */

/**
 * Plain-language definitions, shown from the Terms tab.
 *
 * Carried over from the source deliberately. This screen asks two parties to
 * agree to a fee split, a tier table and three sets of priced rules; the terms
 * have to mean the same thing to both of them, or the agreement is theatre.
 */
export const GLOSSARY: { term: string; body: string }[] = [
  {
    term: 'Guaranteed Fee',
    body: 'Bagian harga yang dibayar untuk pekerjaannya sendiri. Selama semua deliverable yang disepakati selesai, fee ini dibayar penuh — seburuk apa pun performanya. Hanya deliverable yang tidak selesai yang memprorata fee ini.',
  },
  {
    term: 'Performance Fee',
    body: 'Bagian harga yang bergantung pada hasil. Diperoleh bertingkat sesuai achievement terhadap target KPI yang disepakati. Di bawah target, fee ini berkurang — dan tidak pernah berubah menjadi utang.',
  },
  {
    term: 'Achievement',
    body: 'Rata-rata pencapaian reach dan engagement terhadap target yang disepakati, dalam persen. Satu target tercapai dan satu tidak akan berada di tengah, bukan dianggap gagal atau berhasil sepenuhnya.',
  },
  {
    term: 'Bonus',
    body: 'Upside yang brand setuju bayar bila hasil melewati target. Tiap bonus bisa dinyalakan sendiri dan punya nilainya sendiri.',
  },
  {
    term: 'Penalti',
    body: 'Hak brand bila isi perjanjian dilanggar — deliverable tidak lengkap, konten dihapus lebih awal, brief tidak diikuti. Bukan untuk angka yang lemah.',
  },
  {
    term: 'Proteksi Influencer',
    body: 'Cermin dari penalti, untuk saat brand yang terlambat: aset terlambat, approval terlambat, brief berubah besar, atau campaign dibatalkan setelah pekerjaan dimulai. Nilainya mengurangi penalti pada perhitungan akhir.',
  },
  {
    term: 'Final Agreement',
    body: 'Dokumen yang mengikat kedua pihak. Dibuat saat harga disepakati, harus diterima influencer lalu dikonfirmasi brand. Setiap perubahan sesudahnya mereset kedua persetujuan.',
  },
  {
    term: 'Amendment',
    body: 'Membuka kembali agreement yang sudah terkunci. Perubahan tercatat dan kedua pihak harus menerima ulang.',
  },
]
