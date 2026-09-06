import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { listKolDirectory, listKolFacets } from '@/lib/discover/kolDirectory'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/organizations/[id]/discover/kol-directory
 *   ?q=&platform=&category=a,b&tier=a,b&follMin=&minEr=&maxRate=&verified=1
 *   &createdAfter=&refreshedAfter=&sort=&dir=&page=&pageSize=&facets=1
 *
 * The roster itself is global — it is the commercial KOL platform's directory,
 * not org-scoped data — but the endpoint still requires org membership so the
 * page behaves like every other Discover surface.
 *
 * `category` and `tier` both accept a comma-separated list and union their
 * members. A single value behaves exactly as it did before, so existing callers
 * — the sidebar, the toolbar chips, saved lists in localStorage — are unaffected.
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const sp = req.nextUrl.searchParams
    /**
     * An absent param must stay absent: `Number(null)` is 0, and a `minEr` of 0
     * is not the same as no minimum — `er_pct >= 0` drops every creator whose
     * engagement rate was never measured, which is most of the roster.
     */
    const num = (key: string) => {
      const raw = sp.get(key)
      if (raw === null || raw.trim() === '') return null
      const v = Number(raw)
      return Number.isFinite(v) ? v : null
    }

    // `?ids=` fetches an explicit set — what Compare asks for. Shape-checked
    // because the column is UUID and a malformed value would fail the statement
    // rather than return nothing, and capped so a hand-made query cannot ask for
    // the whole roster at once.
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const ids = (sp.get('ids') || '')
      .split(',').map(v => v.trim()).filter(v => UUID.test(v)).slice(0, 50)

    /** `a,b` unions; a lone value behaves exactly as the single-value param did. */
    const list = (key: string) =>
      (sp.get(key) || '').split(',').map(v => v.trim()).filter(Boolean)

    /**
     * A date param is either absent or a real instant — a typo must not silently
     * become "no filter", which would answer a narrowed question with the whole
     * roster. Absent stays absent, for the same reason `num()` above does.
     */
    const badDates: string[] = []
    const date = (key: string) => {
      const raw = sp.get(key)
      if (raw === null || raw.trim() === '') return null
      const d = new Date(raw.trim())
      if (Number.isNaN(d.getTime())) { badDates.push(key); return null }
      return d
    }
    const createdAfter = date('createdAfter')
    const refreshedAfter = date('refreshedAfter')
    if (badDates.length) {
      return NextResponse.json({
        error: `Invalid date for ${badDates.join(', ')}. Expected an ISO 8601 date, e.g. 2026-08-07.`,
      }, { status: 400 })
    }

    const platform = sp.get('platform')

    const data = await listKolDirectory({
      ids,
      q: sp.get('q'),
      platform,
      categories: list('category'),
      tiers: list('tier'),
      minFollowers: num('follMin'),
      minErPct: num('minEr'),
      maxRate: num('maxRate'),
      verifiedOnly: sp.get('verified') === '1',
      createdAfter,
      refreshedAfter,
      sort: sp.get('sort'),
      dir: sp.get('dir'),
      page: num('page') ?? 1,
      // An explicit id list is the page: paging it would drop selections.
      pageSize: ids.length ? ids.length : (num('pageSize') ?? 20),
    })

    // Facets are requested on the first load and again when the platform
    // changes, because the tier counts are scoped to it (BE-02).
    if (sp.get('facets') === '1') data.facets = await listKolFacets({ platform })

    return NextResponse.json(data)
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/kol-directory]', err)
    return NextResponse.json({
      error: 'Something went wrong.',
      // The KOL database sits on a private network, so "it failed" is rarely
      // enough to act on locally: in development the page shows the real reason
      // (unreachable host, missing PG_*_KOL, bad credentials).
      detail: process.env.NODE_ENV === 'development'
        ? String(err instanceof Error ? err.message : err)
        : undefined,
    }, { status: 500 })
  }
}
