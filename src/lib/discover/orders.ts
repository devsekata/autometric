import pool from '@/lib/db'
import { toIso } from './util'
import { findDeliverable, listRateCards, listRosterRateCards, unitPrice } from './rates'
import { listDirectory } from './directory'
import { getRosterIdentities } from './kolDirectory'
import type { CartRelation } from './vocab'

/**
 * Quotations and orders for the Discover cart.
 *
 * Pricing mirrors the source platform's checkout: package subtotal → promo
 * discount → platform fee → tax. The two percentages are the source's own
 * (8% fee, 11% tax); 11% also happens to be Indonesian PPN, so it carries over
 * unchanged. Both are constants here rather than per-org settings — making them
 * configurable is easy later, but guessing at an org-level pricing policy now
 * would be inventing product decisions.
 *
 * All money is integer rupiah. IDR has no minor unit in practice, and keeping
 * every intermediate value an integer means the stored total always equals the
 * sum of the stored lines — no float drift between what the customer was shown
 * and what the payment provider is asked to charge.
 */

export const FEE_PCT = 8
export const TAX_PCT = 11

/** The one promo the source shipped, kept so the field is exercised end to end. */
const PROMOS: Record<string, number> = { LAUNCH10: 0.1 }

export type OrderStatus = 'draft' | 'pending_payment' | 'paid' | 'cancelled' | 'expired' | 'failed'

export interface CartLineInput {
  socialAccountId: string
  relation: CartRelation
  deliverableId: string
  qty: number
  /**
   * Negotiated price per unit, replacing the rate-card price for this line.
   *
   * The rate card stays the default and the anchor — the list price is recorded
   * beside the override so a deviation is always visible afterwards. An account
   * still needs a rate card to be orderable at all: an override is a *deviation
   * from* a price, and allowing one without a baseline would turn "no rate card"
   * from an error into a blank cheque.
   */
  unitPriceOverride?: number | null
  /** Per-creator goal. Null on any field means "inherit the campaign's". */
  target?: CreatorTargetInput | null
}

export interface CreatorTargetInput {
  objective?: string | null
  reach?: number | null
  engagement?: number | null
}

export interface QuotationLine {
  socialAccountId: string
  relation: CartRelation
  accountUsername: string
  platform: string
  deliverableId: string
  deliverableLabel: string
  qty: number
  unitPrice: number
  lineTotal: number
  /** Rate-card price this line would have had; equals unitPrice when untouched. */
  listUnitPrice: number
  priceOverridden: boolean
  target: CreatorTargetInput | null
}

export interface Quotation {
  lines: QuotationLine[]
  subtotal: number
  discountAmount: number
  promoCode: string | null
  feePct: number
  feeAmount: number
  taxPct: number
  taxAmount: number
  total: number
  currency: string
  /** Lines the caller asked for that could not be priced, with the reason. */
  rejected: { socialAccountId: string; deliverableId: string; reason: string }[]
}

/** Drops a target that says nothing, so "no target" stays null rather than `{}`. */
function normaliseTarget(t: CreatorTargetInput | null | undefined): CreatorTargetInput | null {
  if (!t) return null
  const objective = typeof t.objective === 'string' && t.objective.trim() ? t.objective.trim().slice(0, 40) : null
  const num = (v: unknown) => {
    const n = Math.round(Number(v))
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const reach = num(t.reach)
  const engagement = num(t.engagement)
  return objective || reach || engagement ? { objective, reach, engagement } : null
}

/**
 * Prices a cart against the org's current rate cards, account list and roster
 * prices.
 *
 * Everything is validated server-side against what the org can actually see: a
 * creator the org cannot reach, a deliverable that does not belong to that
 * creator's platform, or a creator with no rate card is rejected rather than
 * priced at zero. A client that posts a hand-made payload cannot invent a line.
 *
 * Two populations can be priced, and the difference is only where the identity
 * and the price come from:
 *
 *   * `owned` / `competitor` — accounts tracked in the warehouse, priced from
 *     `discover_rate_cards`;
 *   * `roster` — creators from the commercial KOL platform's directory, whose
 *     name and platform are read from that database and whose price is whatever
 *     the org stated in `discover_roster_rate_cards`. The roster itself carries
 *     no price, so a creator nobody has priced is rejected the same way an
 *     account without a rate card is.
 *
 * Both end up as the same line: base rate × the deliverable's multiplier.
 */
export async function buildQuotation(
  orgId: string, lines: CartLineInput[], promoCode?: string | null,
): Promise<Quotation> {
  const rosterIds = lines.filter(l => l.relation === 'roster').map(l => l.socialAccountId)

  const [dir, rates, rosterRates, rosterIdentities] = await Promise.all([
    listDirectory(orgId),
    listRateCards(orgId),
    rosterIds.length
      ? listRosterRateCards(orgId)
      : Promise.resolve({} as Record<string, import('./vocab').RosterRateCard>),
    // The roster lives on another server. If it is unreachable, roster lines are
    // rejected with a reason and the rest of the cart still prices — one
    // unavailable database should not cost the customer their whole quotation.
    rosterIds.length
      ? getRosterIdentities(rosterIds).catch(e => {
          console.error('[buildQuotation] roster lookup failed:', e)
          return new Map<string, { id: string; username: string; platform: string | null }>()
        })
      : Promise.resolve(new Map<string, { id: string; username: string; platform: string | null }>()),
  ])

  const accounts = new Map(dir.accounts.map(a => [`${a.relation}:${a.id}`, a]))
  const out: QuotationLine[] = []
  const rejected: Quotation['rejected'] = []

  for (const l of lines) {
    const qty = Math.floor(Number(l.qty))
    const isRoster = l.relation === 'roster'
    const account = isRoster ? undefined : accounts.get(`${l.relation}:${l.socialAccountId}`)
    const roster = isRoster ? rosterIdentities.get(l.socialAccountId) : undefined
    const deliverable = findDeliverable(l.deliverableId)

    const username = isRoster ? roster?.username : account?.username
    const platform = isRoster ? roster?.platform : account?.platform
    const baseRate = isRoster
      ? rosterRates[l.socialAccountId]?.baseRate
      : rates[l.socialAccountId]?.baseRate

    const reason =
      isRoster && !roster ? 'creator not found in the KOL roster'
      : !isRoster && !account ? 'account not in this organization'
      : !platform ? 'creator has no platform'
      : !deliverable ? 'unknown deliverable'
      : deliverable.platform !== platform ? 'deliverable does not apply to this platform'
      : !baseRate || baseRate <= 0
        ? (isRoster ? 'no rate card set for this roster creator' : 'no rate card set for this account')
      : !Number.isFinite(qty) || qty <= 0 ? 'quantity must be at least 1'
      : null

    if (reason) {
      rejected.push({ socialAccountId: l.socialAccountId, deliverableId: l.deliverableId, reason })
      continue
    }

    const listPrice = unitPrice(baseRate!, deliverable!.mult)
    // An override is accepted only as a whole, non-negative rupiah amount. It is
    // still rounded and clamped here rather than trusted: this is the number the
    // customer will be charged.
    const raw = l.unitPriceOverride
    const overridden =
      raw !== null && raw !== undefined && Number.isFinite(Number(raw)) && Math.round(Number(raw)) !== listPrice
    const price = overridden ? Math.max(0, Math.round(Number(raw))) : listPrice

    out.push({
      socialAccountId: l.socialAccountId,
      relation: l.relation,
      accountUsername: username!,
      platform: platform!,
      deliverableId: deliverable!.id,
      deliverableLabel: deliverable!.label,
      qty,
      unitPrice: price,
      lineTotal: price * qty,
      listUnitPrice: listPrice,
      priceOverridden: overridden,
      target: normaliseTarget(l.target),
    })
  }

  const subtotal = out.reduce((n, l) => n + l.lineTotal, 0)
  const code = (promoCode ?? '').trim().toUpperCase()
  const promoRate = PROMOS[code] ?? 0
  const discountAmount = Math.round(subtotal * promoRate)
  const afterDiscount = subtotal - discountAmount
  const feeAmount = Math.round((afterDiscount * FEE_PCT) / 100)
  const taxAmount = Math.round(((afterDiscount + feeAmount) * TAX_PCT) / 100)

  return {
    lines: out,
    subtotal,
    discountAmount,
    promoCode: promoRate > 0 ? code : null,
    feePct: FEE_PCT,
    feeAmount,
    taxPct: TAX_PCT,
    taxAmount,
    total: afterDiscount + feeAmount + taxAmount,
    currency: 'IDR',
    rejected,
  }
}

export interface OrderSummary {
  id: number
  name: string
  status: OrderStatus
  /** Creator handles on the order — the Orders workspace lists KOLs per row. */
  kols: string[]
  /** Distinct deliverable labels, so a row can show what was actually bought. */
  packages: string[]
  currency: string
  subtotal: number
  discountAmount: number
  feeAmount: number
  taxAmount: number
  total: number
  promoCode: string | null
  itemCount: number
  accountCount: number
  paymentProvider: string | null
  paymentRedirectUrl: string | null
  paidAt: string | null
  createdAt: string | null
  createdByName: string | null
  /**
   * The campaign half of the row (see migration 045). An order and a campaign
   * are the same record at different points on the flow, so Campaign Management
   * can list objective, window and frozen estimates without a second query per
   * row. All null for an order created straight from the cart.
   */
  campaign: OrderCampaignSummary
}

export interface OrderCampaignSummary {
  /** Lifecycle stage — see CAMPAIGN_STAGES. Independent of payment `status`. */
  campaignStatus: string
  objective: string | null
  startDate: string | null
  endDate: string | null
  budget: number | null
  goalReach: number | null
  goalEngagement: number | null
  estReach: number | null
  estEngagement: number | null
  estEmv: number | null
  successRate: number | null
}

/** Where one creator's deliverable is in production. Recorded, never inferred. */
export type ItemProgress = 'pending' | 'briefed' | 'in_progress' | 'review' | 'published'

export interface OrderItem extends QuotationLine {
  id: number
  progressStatus: ItemProgress
  publishedUrl: string | null
  publishedAt: string | null
}

export interface OrderDetail extends OrderSummary {
  notes: string | null
  feePct: number
  taxPct: number
  items: OrderItem[]
}

/** Persists a quotation. Returns null when nothing priceable was supplied. */
export async function createOrder(
  orgId: string, userId: string, name: string,
  lines: CartLineInput[], promoCode?: string | null, notes?: string | null,
): Promise<{ id: number; quotation: Quotation } | null> {
  const q = await buildQuotation(orgId, lines, promoCode)
  if (q.lines.length === 0) return null

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO public.discover_orders
         (organization_id, created_by_user_id, name, status, currency, subtotal,
          fee_pct, fee_amount, tax_pct, tax_amount, discount_amount, promo_code, total, notes)
       VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [orgId, userId, name.trim() || 'Untitled campaign', q.currency, q.subtotal,
       q.feePct, q.feeAmount, q.taxPct, q.taxAmount, q.discountAmount, q.promoCode, q.total, notes ?? null],
    )
    const orderId = Number(rows[0].id)

    // Written one statement per line for readability; carts are a handful of
    // rows, not a bulk import.
    for (const l of q.lines) {
      await client.query(
        `INSERT INTO public.discover_order_items
           (order_id, social_account_id, relation, account_username, platform,
            deliverable_id, deliverable_label, qty, unit_price, line_total,
            list_unit_price, price_overridden,
            target_objective, target_reach, target_engagement)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [orderId, l.socialAccountId, l.relation, l.accountUsername, l.platform,
         l.deliverableId, l.deliverableLabel, l.qty, l.unitPrice, l.lineTotal,
         l.listUnitPrice, l.priceOverridden,
         l.target?.objective ?? null, l.target?.reach ?? null, l.target?.engagement ?? null],
      )
    }

    await client.query('COMMIT')
    return { id: orderId, quotation: q }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

const num = (v: unknown) => Number((v as string | number | null | undefined) ?? 0)

/** Campaign fields are all optional, so absent must stay absent — a null budget
 *  is "not set yet", which is a different statement from "Rp0". */
const numOrNull = (v: unknown) =>
  v === null || v === undefined || v === '' ? null : Number(v)

const dateOrNull = (v: unknown) =>
  toIso(v as string | Date | null)?.slice(0, 10) ?? null

function campaignOf(r: Record<string, unknown>): OrderCampaignSummary {
  return {
    campaignStatus: (r.campaign_status as string) ?? 'draft',
    objective: (r.objective as string) ?? null,
    startDate: dateOrNull(r.start_date),
    endDate: dateOrNull(r.end_date),
    budget: numOrNull(r.budget),
    goalReach: numOrNull(r.goal_reach),
    goalEngagement: numOrNull(r.goal_engagement),
    estReach: numOrNull(r.est_reach),
    estEngagement: numOrNull(r.est_engagement),
    estEmv: numOrNull(r.est_emv),
    successRate: numOrNull(r.success_rate),
  }
}

export async function listOrders(orgId: string): Promise<OrderSummary[]> {
  const { rows } = await pool.query<Record<string, string | string[] | null>>(
    `SELECT o.id, o.name, o.status, o.currency, o.subtotal, o.discount_amount,
            o.fee_amount, o.tax_amount, o.total, o.promo_code,
            o.payment_provider, o.payment_redirect_url, o.paid_at, o.created_at,
            o.campaign_status, o.objective, o.start_date, o.end_date, o.budget,
            o.goal_reach, o.goal_engagement,
            o.est_reach, o.est_engagement, o.est_emv, o.success_rate,
            u.name AS created_by_name,
            COALESCE(SUM(i.qty), 0)::text                      AS item_count,
            COUNT(DISTINCT i.social_account_id)::text          AS account_count,
            -- Snapshotted on the line, so a renamed or unlinked account still
            -- shows the handle that was actually ordered.
            COALESCE(ARRAY_AGG(DISTINCT i.account_username)
                     FILTER (WHERE i.account_username IS NOT NULL), '{}')  AS kols,
            COALESCE(ARRAY_AGG(DISTINCT i.deliverable_label)
                     FILTER (WHERE i.deliverable_label IS NOT NULL), '{}') AS packages
       FROM public.discover_orders o
       LEFT JOIN public.discover_order_items i ON i.order_id = o.id
       LEFT JOIN public.users u ON u.id = o.created_by_user_id
      WHERE o.organization_id = $1
      GROUP BY o.id, u.name
      ORDER BY o.created_at DESC`,
    [orgId],
  )
  return rows.map(r => ({
    id: Number(r.id),
    name: (r.name as string) ?? '',
    status: ((r.status as string) ?? 'draft') as OrderStatus,
    kols: (r.kols as string[]) ?? [],
    packages: (r.packages as string[]) ?? [],
    currency: (r.currency as string) ?? 'IDR',
    subtotal: num(r.subtotal),
    discountAmount: num(r.discount_amount),
    feeAmount: num(r.fee_amount),
    taxAmount: num(r.tax_amount),
    total: num(r.total),
    promoCode: (r.promo_code as string) ?? null,
    itemCount: num(r.item_count),
    accountCount: num(r.account_count),
    paymentProvider: (r.payment_provider as string) ?? null,
    paymentRedirectUrl: (r.payment_redirect_url as string) ?? null,
    paidAt: toIso(r.paid_at as string | null),
    createdAt: toIso(r.created_at as string | null),
    createdByName: (r.created_by_name as string) ?? null,
    campaign: campaignOf(r),
  }))
}

/** Scoped by org — an order id from another org resolves to null, not a leak. */
export async function getOrder(orgId: string, orderId: number): Promise<OrderDetail | null> {
  const { rows } = await pool.query<Record<string, string | null>>(
    `SELECT o.*, u.name AS created_by_name
       FROM public.discover_orders o
       LEFT JOIN public.users u ON u.id = o.created_by_user_id
      WHERE o.id = $1 AND o.organization_id = $2`,
    [orderId, orgId],
  )
  const o = rows[0]
  if (!o) return null

  // Not `string | null`: this table now carries a boolean and a timestamptz, and
  // node-pg hands those back as their JS types rather than as text.
  const { rows: items } = await pool.query<Record<string, string | number | boolean | Date | null>>(
    `SELECT * FROM public.discover_order_items WHERE order_id = $1 ORDER BY id`,
    [orderId],
  )

  return {
    id: Number(o.id),
    name: o.name ?? '',
    status: (o.status ?? 'draft') as OrderStatus,
    kols: [...new Set(items.map(i => i.account_username).filter(Boolean) as string[])],
    packages: [...new Set(items.map(i => i.deliverable_label).filter(Boolean) as string[])],
    currency: o.currency ?? 'IDR',
    subtotal: num(o.subtotal),
    discountAmount: num(o.discount_amount),
    feePct: num(o.fee_pct),
    feeAmount: num(o.fee_amount),
    taxPct: num(o.tax_pct),
    taxAmount: num(o.tax_amount),
    total: num(o.total),
    promoCode: o.promo_code,
    notes: o.notes,
    itemCount: items.reduce((n, i) => n + num(i.qty), 0),
    accountCount: new Set(items.map(i => i.social_account_id)).size,
    paymentProvider: o.payment_provider,
    paymentRedirectUrl: o.payment_redirect_url,
    paidAt: toIso(o.paid_at),
    createdAt: toIso(o.created_at),
    createdByName: o.created_by_name,
    campaign: campaignOf(o),
    items: items.map((i): OrderItem => {
      const text = (v: unknown) => (v === null || v === undefined ? null : String(v))
      return {
        id: Number(i.id),
        socialAccountId: String(i.social_account_id),
        relation: (text(i.relation) ?? 'owned') as CartRelation,
        accountUsername: text(i.account_username) ?? '—',
        platform: text(i.platform) ?? '',
        deliverableId: text(i.deliverable_id) ?? '',
        deliverableLabel: text(i.deliverable_label) ?? '',
        qty: num(i.qty),
        unitPrice: num(i.unit_price),
        lineTotal: num(i.line_total),
        // list_unit_price is null on rows written before migration 046; those
        // lines were never overridden, so the charged price is the list price.
        listUnitPrice: i.list_unit_price === null ? num(i.unit_price) : num(i.list_unit_price),
        priceOverridden: i.price_overridden === true,
        target: normaliseTarget({
          objective: text(i.target_objective),
          reach: numOrNull(i.target_reach),
          engagement: numOrNull(i.target_engagement),
        }),
        progressStatus: (text(i.progress_status) ?? 'pending') as ItemProgress,
        publishedUrl: text(i.published_url),
        publishedAt: toIso(i.published_at as string | Date | null),
      }
    }),
  }
}

export async function updateOrderStatus(
  orgId: string, orderId: number, status: OrderStatus,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    // $3 needs an explicit cast for the same reason as in payment.ts: it is both
    // assigned and compared, so Postgres cannot infer a single type for it.
    `UPDATE public.discover_orders
        SET status = $3::varchar, updated_at = now(),
            paid_at = CASE WHEN $3::varchar = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END
      WHERE id = $1 AND organization_id = $2`,
    [orderId, orgId, status],
  )
  return (rowCount ?? 0) > 0
}
