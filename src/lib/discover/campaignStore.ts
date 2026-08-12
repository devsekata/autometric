import pool from '@/lib/db'
import { toIso } from './util'
import { getOrder, type OrderDetail } from './orders'
import { listKolProfiles, type KolProfile } from './profile'
import {
  estimateCampaign, predictSuccess, reachFor, engagementFor,
  type CampaignEstimate, type SuccessPrediction,
} from './campaign'

/**
 * Reads and writes the campaign half of a Discover order, and computes the
 * performance view the Campaign Dashboard renders.
 *
 * Live campaign delivery is not something autometric ingests — nobody reports
 * back "this sponsored post got X reach" per order. So dashboard actuals are
 * *pacing projections*: the frozen checkout estimate scaled by how far through
 * the campaign window today is. That is stated in the payload as
 * `actualsAreProjected`, and the UI says so on screen, because a projected
 * number presented as measured is the single most damaging thing a reporting
 * tool can do.
 */

/**
 * The campaign lifecycle, in order. Distinct from payment status: an order can
 * be paid while the campaign is still being briefed. Advanced by a person —
 * autometric ingests no per-order delivery signal, so anything else would be
 * a guess wearing a status badge (see migration 046).
 */
export const CAMPAIGN_STAGES = [
  'draft', 'planning', 'briefed', 'in_progress',
  'content_review', 'published', 'monitoring', 'completed',
] as const

export type CampaignStage = (typeof CAMPAIGN_STAGES)[number]

export interface InspirationPick {
  source: string
  postRowId: number
  platform: string
}

export interface CampaignFields {
  campaignStatus: CampaignStage
  objective: string | null
  brief: string | null
  keyMessage: string | null
  deadline: string | null
  paymentMethod: string | null
  inspirations: InspirationPick[]
  hashtags: string | null
  mentions: string | null
  startDate: string | null
  endDate: string | null
  budget: number | null
  goalReach: number | null
  goalEngagement: number | null
  targetAges: string[]
  targetGender: 'all' | 'female' | 'male'
  estReach: number | null
  estEngagement: number | null
  estEmv: number | null
  successRate: number | null
  successFactors: SuccessPrediction['factors'] | null
}

export type CampaignPatch = Partial<Omit<CampaignFields, 'successFactors'>> & {
  successFactors?: SuccessPrediction['factors'] | null
}

/**
 * Advances (or rewinds) the lifecycle.
 *
 * Separate from `saveCampaignFields` because that one refuses to touch a paid
 * order — correctly, since a paid brief is a record of what was agreed. The
 * lifecycle is the opposite case: it only starts moving *after* payment, so it
 * needs a writer that a paid order does not lock out.
 */
export async function setCampaignStage(
  orgId: string, orderId: number, stage: CampaignStage,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE public.discover_orders SET campaign_status = $3, updated_at = now()
      WHERE id = $1 AND organization_id = $2`,
    [orderId, orgId, stage],
  )
  return (rowCount ?? 0) > 0
}

/** Per-deliverable production status, shown as each creator's progress. */
export async function setItemProgress(
  orgId: string, orderId: number, itemId: number,
  progress: string, publishedUrl?: string | null,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    // The join to discover_orders is the authorization: an item id from another
    // org matches no row, so it updates nothing rather than leaking or writing.
    // $4 is cast explicitly: without it Postgres deduces varchar from the
    // assignment and text from the comparison, and rejects the statement with
    // "inconsistent types deduced for parameter $4".
    `UPDATE public.discover_order_items i
        SET progress_status = $4::text,
            published_url   = COALESCE($5, i.published_url),
            published_at    = CASE WHEN $4::text = 'published' AND i.published_at IS NULL
                                   THEN now() ELSE i.published_at END
       FROM public.discover_orders o
      WHERE i.order_id = o.id
        AND i.id = $3 AND o.id = $1 AND o.organization_id = $2`,
    [orderId, orgId, itemId, progress, publishedUrl ?? null],
  )
  return (rowCount ?? 0) > 0
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export async function getCampaignFields(
  orgId: string, orderId: number,
): Promise<CampaignFields | null> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT campaign_status, objective, brief, key_message, deadline, payment_method,
            inspirations, hashtags, mentions, start_date, end_date, budget,
            goal_reach, goal_engagement, target_ages, target_gender,
            est_reach, est_engagement, est_emv, success_rate, success_factors
       FROM public.discover_orders WHERE id = $1 AND organization_id = $2`,
    [orderId, orgId],
  )
  const r = rows[0]
  if (!r) return null
  return {
    campaignStatus: ((r.campaign_status as string) ?? 'draft') as CampaignStage,
    objective: (r.objective as string) ?? null,
    brief: (r.brief as string) ?? null,
    keyMessage: (r.key_message as string) ?? null,
    deadline: toIso(r.deadline as string | Date | null)?.slice(0, 10) ?? null,
    paymentMethod: (r.payment_method as string) ?? null,
    inspirations: Array.isArray(r.inspirations) ? (r.inspirations as InspirationPick[]) : [],
    hashtags: (r.hashtags as string) ?? null,
    mentions: (r.mentions as string) ?? null,
    startDate: toIso(r.start_date as string | Date | null)?.slice(0, 10) ?? null,
    endDate: toIso(r.end_date as string | Date | null)?.slice(0, 10) ?? null,
    budget: num(r.budget),
    goalReach: num(r.goal_reach),
    goalEngagement: num(r.goal_engagement),
    targetAges: r.target_ages ? String(r.target_ages).split(',').filter(Boolean) : [],
    targetGender: ((r.target_gender as string) ?? 'all') as CampaignFields['targetGender'],
    estReach: num(r.est_reach),
    estEngagement: num(r.est_engagement),
    estEmv: num(r.est_emv),
    successRate: num(r.success_rate),
    successFactors: (r.success_factors as SuccessPrediction['factors']) ?? null,
  }
}

/** Partial update — only the keys present in `patch` are written. */
export async function saveCampaignFields(
  orgId: string, orderId: number, patch: CampaignPatch,
): Promise<boolean> {
  const cols: Record<string, unknown> = {}
  const map: Record<keyof CampaignPatch, string> = {
    campaignStatus: 'campaign_status',
    objective: 'objective', brief: 'brief', hashtags: 'hashtags', mentions: 'mentions',
    keyMessage: 'key_message', deadline: 'deadline', paymentMethod: 'payment_method',
    inspirations: 'inspirations',
    startDate: 'start_date', endDate: 'end_date', budget: 'budget',
    goalReach: 'goal_reach', goalEngagement: 'goal_engagement',
    targetAges: 'target_ages', targetGender: 'target_gender',
    estReach: 'est_reach', estEngagement: 'est_engagement', estEmv: 'est_emv',
    successRate: 'success_rate', successFactors: 'success_factors',
  }
  for (const [k, v] of Object.entries(patch)) {
    const col = map[k as keyof CampaignPatch]
    if (!col || v === undefined) continue
    cols[col] = k === 'targetAges' && Array.isArray(v) ? v.join(',')
      : k === 'successFactors' || k === 'inspirations' ? JSON.stringify(v)
      : v
  }
  if (Object.keys(cols).length === 0) return false

  const sets = Object.keys(cols).map((c, i) => `${c} = $${i + 3}`)
  const { rowCount } = await pool.query(
    `UPDATE public.discover_orders SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $1 AND organization_id = $2`,
    [orderId, orgId, ...Object.values(cols)],
  )
  return (rowCount ?? 0) > 0
}

/* ── dashboard ───────────────────────────────────────────────────────────── */

export interface CampaignContribution {
  accountId: string
  username: string
  platform: string
  units: number
  cost: number
  reach: number
  engagement: number
  /** Share of total campaign reach, 0–100. */
  reachShare: number
  brandFit: number
}

export interface CampaignDashboardPayload {
  order: OrderDetail
  campaign: CampaignFields
  estimate: CampaignEstimate
  prediction: SuccessPrediction
  contributions: CampaignContribution[]
  /** Campaign window progress, 0–100. */
  pacingPct: number
  actuals: { reach: number; engagement: number; emv: number; roi: number }
  budgetUsedPct: number
  goals: { label: string; actual: number; goal: number; pct: number; met: boolean }[]
  /** Always true today — see the note at the top of this module. */
  actualsAreProjected: boolean
  missingProfiles: string[]
}

/** Fraction of the campaign window elapsed; 1 when no window is set. */
function pacing(start: string | null, end: string | null, today: number): number {
  if (!start || !end) return 1
  const s = new Date(start).getTime()
  const e = new Date(end).getTime()
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 1
  return Math.max(0, Math.min(1, (today - s) / (e - s)))
}

export async function getCampaignDashboard(
  orgId: string, orderId: number, now: number,
): Promise<CampaignDashboardPayload | null> {
  const [order, campaign, profiles] = await Promise.all([
    getOrder(orgId, orderId),
    getCampaignFields(orgId, orderId),
    listKolProfiles(orgId),
  ])
  if (!order || !campaign) return null

  const byKey = new Map<string, KolProfile>(
    profiles.map(p => [`${p.account.relation}:${p.account.id}`, p]))

  // Group line items back into per-creator selections.
  const grouped = new Map<string, { profile: KolProfile; units: number; cost: number }>()
  const missingProfiles: string[] = []
  for (const item of order.items) {
    const key = `${item.relation}:${item.socialAccountId}`
    const profile = byKey.get(key)
    if (!profile) {
      // The account was unlinked after the order was placed. The order still
      // stands (its lines are snapshotted) but it can no longer be modelled.
      if (!missingProfiles.includes(item.accountUsername)) missingProfiles.push(item.accountUsername)
      continue
    }
    const cur = grouped.get(key)
    grouped.set(key, {
      profile,
      units: (cur?.units ?? 0) + item.qty,
      cost: (cur?.cost ?? 0) + item.lineTotal,
    })
  }

  const selected = [...grouped.values()]
  const estimate = estimateCampaign(selected)
  const prediction = predictSuccess(selected, {
    targetAges: campaign.targetAges,
    targetGender: campaign.targetGender,
  })

  const contributions: CampaignContribution[] = selected.map(s => {
    const reach = reachFor(s.profile, s.units)
    return {
      accountId: s.profile.account.id,
      username: s.profile.account.username,
      platform: s.profile.account.platform,
      units: s.units,
      cost: s.cost,
      reach,
      engagement: engagementFor(s.profile, s.units),
      reachShare: estimate.reach > 0 ? (reach / estimate.reach) * 100 : 0,
      brandFit: s.profile.brandFit.value,
    }
  }).sort((a, b) => b.reach - a.reach)

  // Prefer the estimate frozen at checkout; fall back to a live recompute for
  // orders created before those columns existed.
  const baseReach = campaign.estReach ?? estimate.reach
  const baseEngagement = campaign.estEngagement ?? estimate.engagement
  const baseEmv = campaign.estEmv ?? estimate.emv

  const pacingPct = pacing(campaign.startDate, campaign.endDate, now)
  const actuals = {
    reach: Math.round(baseReach * pacingPct),
    engagement: Math.round(baseEngagement * pacingPct),
    emv: Math.round(baseEmv * pacingPct),
    roi: order.total > 0 ? (baseEmv * pacingPct) / order.total : 0,
  }

  const goal = (label: string, actual: number, target: number | null) => ({
    label, actual, goal: target ?? 0,
    pct: target && target > 0 ? Math.min(999, (actual / target) * 100) : 0,
    met: !!target && target > 0 && actual >= target,
  })

  return {
    order,
    campaign,
    estimate,
    prediction,
    contributions,
    pacingPct: Math.round(pacingPct * 100),
    actuals,
    budgetUsedPct: campaign.budget && campaign.budget > 0
      ? Math.min(999, (order.total / campaign.budget) * 100) : 0,
    goals: [
      goal('Reach', actuals.reach, campaign.goalReach),
      goal('Engagement', actuals.engagement, campaign.goalEngagement),
    ],
    actualsAreProjected: true,
    missingProfiles,
  }
}

