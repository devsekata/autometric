import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { listKolDirectory, listKolFacets } from '@/lib/discover/kolDirectory'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/organizations/[id]/discover/kol-directory
 *   ?q=&platform=&category=&tier=a,b&follMin=&minEr=&verified=1&sort=&page=&pageSize=&facets=1
 *
 * The roster itself is global — it is the commercial KOL platform's directory,
 * not org-scoped data — but the endpoint still requires org membership so the
 * page behaves like every other Discover surface.
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

    const data = await listKolDirectory({
      q: sp.get('q'),
      platform: sp.get('platform'),
      category: sp.get('category'),
      tiers: (sp.get('tier') || '').split(',').filter(Boolean),
      minFollowers: num('follMin'),
      minErPct: num('minEr'),
      verifiedOnly: sp.get('verified') === '1',
      sort: sp.get('sort'),
      dir: sp.get('dir'),
      page: num('page') ?? 1,
      pageSize: num('pageSize') ?? 20,
    })

    // Only the first load asks for facets; later filter changes reuse them.
    if (sp.get('facets') === '1') data.facets = await listKolFacets()

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
