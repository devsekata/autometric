import pool from '@/lib/db'
// The catalogue and pricing helpers are pure and live in vocab.ts so client
// components can import them without pulling the pg driver into the browser.
export {
  DELIVERABLES, deliverablesFor, findDeliverable, unitPrice,
  type CartRelation, type Deliverable, type RateCard, type RosterRateCard,
} from './vocab'
import { unitPrice as _unitPrice } from './vocab'

/**
 * Rate cards and the deliverable catalogue.
 *
 * Ported from the source platform's pricing model: every creator has one base
 * rate, and each deliverable costs `base × multiplier`. That model survives the
 * port because it needs exactly one number per account, which a team can
 * realistically keep current — a full price-per-deliverable matrix tends to rot.
 *
 * Two changes from the source:
 *   * Currency is IDR, not USD. autometric is an Indonesian product and Midtrans
 *     settles in rupiah.
 *   * Facebook deliverables exist here. The source only priced Instagram and
 *     TikTok, but autometric tracks Facebook accounts too, and an account with
 *     no priceable deliverable would be un-orderable for no good reason.
 */

export async function listRateCards(orgId: string): Promise<Record<string, import('./vocab').RateCard>> {
  const { rows } = await pool.query<{
    social_account_id: string; base_rate: string; currency: string
    note: string | null; updated_at: Date | string | null
  }>(
    `SELECT social_account_id, base_rate, currency, note, updated_at
       FROM public.discover_rate_cards WHERE organization_id = $1`,
    [orgId],
  )
  const out: Record<string, import('./vocab').RateCard> = {}
  for (const r of rows) {
    out[r.social_account_id] = {
      socialAccountId: r.social_account_id,
      // NUMERIC comes back as a string from node-pg to avoid float loss.
      baseRate: Number(r.base_rate ?? 0),
      currency: r.currency ?? 'IDR',
      note: r.note,
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    }
  }
  return out
}

export async function getRateCard(orgId: string, accountId: string): Promise<import('./vocab').RateCard | null> {
  return (await listRateCards(orgId))[accountId] ?? null
}

export async function setRateCard(
  orgId: string, accountId: string, baseRate: number, userId: string, note?: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO public.discover_rate_cards
       (organization_id, social_account_id, base_rate, note, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (organization_id, social_account_id) DO UPDATE
       SET base_rate = EXCLUDED.base_rate,
           note       = EXCLUDED.note,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
    [orgId, accountId, Math.max(0, Math.round(baseRate)), note ?? null, userId],
  )
}

/* ── roster rate cards ────────────────────────────────────────────────────── */

/**
 * Prices the org has stated for creators from the commercial KOL roster.
 *
 * Kept apart from `listRateCards` because the ids come from a different database
 * (`@/lib/kolDb`) and mean a different thing. Returned keyed by roster id so a
 * caller can ask "does this creator have a price" without a second query — the
 * Directory grid asks that for every row on the page.
 */
export async function listRosterRateCards(
  orgId: string,
): Promise<Record<string, import('./vocab').RosterRateCard>> {
  const { rows } = await pool.query<{
    roster_kol_id: string; base_rate: string; currency: string
    note: string | null; updated_at: Date | string | null
  }>(
    `SELECT roster_kol_id, base_rate, currency, note, updated_at
       FROM public.discover_roster_rate_cards WHERE organization_id = $1`,
    [orgId],
  )
  const out: Record<string, import('./vocab').RosterRateCard> = {}
  for (const r of rows) {
    out[r.roster_kol_id] = {
      rosterKolId: r.roster_kol_id,
      // NUMERIC comes back as a string from node-pg to avoid float loss.
      baseRate: Number(r.base_rate ?? 0),
      currency: r.currency ?? 'IDR',
      note: r.note,
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    }
  }
  return out
}

export async function setRosterRateCard(
  orgId: string, rosterKolId: string, baseRate: number, userId: string, note?: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO public.discover_roster_rate_cards
       (organization_id, roster_kol_id, base_rate, note, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (organization_id, roster_kol_id) DO UPDATE
       SET base_rate  = EXCLUDED.base_rate,
           note       = EXCLUDED.note,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
    [orgId, rosterKolId, Math.max(0, Math.round(baseRate)), note ?? null, userId],
  )
}
