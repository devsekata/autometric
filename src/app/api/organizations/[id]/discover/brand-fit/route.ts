import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import {
  BrandFitNotFound, COMPONENT_WEIGHTS, MIN_COMPONENTS, PERFORMANCE_METRICS,
  RELATED_THRESHOLD, getBrandFitForBrand, runBrandFit,
} from '@/lib/discover/brandFit'

type Params = { params: Promise<{ id: string }> }

/**
 * Brand Fit Analysis for one brand.
 *
 *     UI → this route → Brand Fit engine → kolDb() / kolDbWrite() → KOL server
 *
 * Every byte of it comes from the KOL database. Nothing in this path reads
 * `@/lib/db`, and nothing reads the warehouse: Brand Fit's grain is
 * `(agency_kol_account_id, brand_id)` and both of those are KOL-server tables.
 *
 * The score is computed server-side and sent as a finished number. The client
 * renders `partnership_score`, the four sub-scores, the chips and the
 * recommendations — it never recomputes any of them, because a second
 * implementation in the browser is a second answer waiting to disagree.
 *
 * GET  reads what is stored. Cheap, and the normal path for a page load.
 * POST recomputes and stores. ADMIN only: a recompute rewrites the analysis the
 *      whole workspace reads, which is the same workspace-level decision that
 *      already gates the Brand Profile.
 */

/** What the rules currently are, sent alongside so the UI can explain a score. */
const RULES = {
  weights: COMPONENT_WEIGHTS,
  minComponents: MIN_COMPONENTS,
  relatedThreshold: RELATED_THRESHOLD,
  performanceMetrics: PERFORMANCE_METRICS,
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) {
      return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
    }

    const brandId = req.nextUrl.searchParams.get('brandId')
    if (!brandId) {
      return NextResponse.json({ error: 'brandId is required.' }, { status: 400 })
    }

    const results = await getBrandFitForBrand(brandId)
    return NextResponse.json({
      brandId,
      results,
      // Distinguishes "never computed" from "computed and found unmeasurable".
      // They look identical in the data and need different prompts in the UI.
      computed: results.length > 0,
      measurable: results.filter(r => r.partnershipScore !== null).length,
      canRecompute: access.role === 'ADMIN',
      rules: RULES,
    })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/brand-fit]', err)
    return NextResponse.json({ error: 'Unable to load Brand Fit analysis.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) {
      return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })
    }
    if (access.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only an organization admin can recompute Brand Fit.' },
        { status: 403 },
      )
    }

    const body = await req.json().catch(() => null) as
      { brandId?: unknown; agencyKolAccountIds?: unknown; persist?: unknown } | null
    const brandId = typeof body?.brandId === 'string' ? body.brandId : null
    if (!brandId) {
      return NextResponse.json({ error: 'brandId is required.' }, { status: 400 })
    }

    const ids = Array.isArray(body?.agencyKolAccountIds)
      ? body.agencyKolAccountIds.filter((x): x is string => typeof x === 'string')
      : undefined

    const run = await runBrandFit(brandId, {
      agencyKolAccountIds: ids,
      persist: body?.persist !== false,
    })

    return NextResponse.json({
      brandId: run.brandId,
      brandName: run.brandName,
      analysed: run.analysed,
      stored: run.stored,
      measurable: run.measurable,
      rules: RULES,
      // The per-pair detail, capped: a full-roster run is 7,431 analyses and the
      // page shows a list, not all of them. The rest are in the table.
      results: run.results.slice(0, 200),
    })
  } catch (err) {
    if (err instanceof BrandFitNotFound) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    console.error('[POST /api/organizations/[id]/discover/brand-fit]', err)
    return NextResponse.json({ error: 'Unable to compute Brand Fit analysis.' }, { status: 500 })
  }
}
