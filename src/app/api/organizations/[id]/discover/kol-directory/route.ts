import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { listKolDirectory, listKolFacets } from '@/lib/discover/kolDirectory'
import { myCreatorIdsAmong } from '@/lib/discover/myCreators'
import { getBrandProfile } from '@/lib/discover/brandMatch/profile'
import { brandMatchForDirectory, type DirectoryBrandMatch } from '@/lib/discover/whatMatters/brandMatch'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/organizations/[id]/discover/kol-directory
 *   ?q=&platform=&category=&tier=a,b&follMin=&minEr=&maxRate=&growthMin=&growthMax=&connected=1&verified=1&updatedWithin=&agency=&sort=&page=&pageSize=&facets=1&match=1&brandProfile=1
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

    /**
     * Comma-separated category filter, the shape `tier` already uses.
     * Returns null rather than [] for an absent or empty param: an empty
     * array bound to `= ANY($n)` matches nothing and would empty the
     * directory instead of leaving it unfiltered.
     */
    const list = (key: string) => {
      const v = (sp.get(key) || '').split(',').map(x => x.trim()).filter(Boolean)
      return v.length ? v : null
    }

    // `?ids=` fetches an explicit set — what Compare asks for. Shape-checked
    // because the column is UUID and a malformed value would fail the statement
    // rather than return nothing, and capped so a hand-made query cannot ask for
    // the whole roster at once.
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const ids = (sp.get('ids') || '')
      .split(',').map(v => v.trim()).filter(v => UUID.test(v)).slice(0, 50)

    /**
     * Brand Profile gender — `?brandProfile=1`, sent by the main Directory
     * list only.
     *
     * Female/Male on the agency's Brand Profile (`gender_majority`) keeps only
     * creators whose CREATOR gender (kol_profile_card.creator_gender) is that
     * gender; Any and Balanced filter nothing. Never applied to `?ids=`:
     * Compare, Cart, SmartDiscovery and the Brand Match request fetch creators
     * the user already picked, and must get exactly those back. Gender is
     * eligibility only — it is not part of Match %.
     */
    let creatorGender: 'female' | 'male' | null = null
    if (sp.get('brandProfile') === '1' && !ids.length) {
      const { genderMajority } = await getBrandProfile(access.orgId)
      creatorGender = genderMajority === 'Female' ? 'female' : genderMajority === 'Male' ? 'male' : null
    }

    const data = await listKolDirectory({
      ids,
      creatorGender,
      q: sp.get('q'),
      platform: sp.get('platform'),
      category: sp.get('category'),
      tiers: (sp.get('tier') || '').split(',').filter(Boolean),
      minFollowers: num('follMin'),
      minErPct: num('minEr'),
      maxRate: num('maxRate'),
      // Growth bounds may legitimately be negative or exactly 0, so they go
      // through `num` (which keeps an absent param absent) rather than a
      // truthiness check.
      minGrowth: num('growthMin'),
      maxGrowth: num('growthMax'),
      // Calculated metrics (037/038). Numeric bounds go through `num`, which
      // keeps an absent param absent — 0 is a real bound for every one of
      // them, so a truthiness check would silently drop it.
      minFemalePct: num('femaleMin'),
      minMalePct: num('maleMin'),
      maxPaidRatio: num('paidMax'),
      minPostFrequencyMonthly: num('postFreqMin'),
      minShareRate: num('shareMin'),
      // Category filters arrive comma-separated, the shape `tier` already
      // uses. An empty string yields null, not [''], which would match nothing.
      growthClass: list('growthClass'),
      postFrequencyReliability: list('freqReliability'),
      monitoringPriority: list('priority'),
      // Discovery filters, migration 039.
      minSaveRate: num('saveMin'),
      minViralFrequency: num('viralMin'),
      risingOnly: sp.get('rising') === '1',
      contentTopic: list('topic'),
      formatDominant: list('format'),
      audienceQualityTier: list('audQuality'),
      performanceStability: list('stability'),
      audienceInterest: list('interest'),
      audienceGeoKey: sp.get('geoKey'),
      audienceGeoLevel: sp.get('geoLevel'),
      connectedOnly: sp.get('connected') === '1',
      // Separate axis from `connected`, deliberately: one is the platform's
      // badge, the other is whether the creator linked the account to us.
      verifiedOnly: sp.get('verified') === '1',
      updatedWithinDays: num('updatedWithin'),
      agency: sp.get('agency'),
      // My Creators: the agency is the org in the URL, whose membership was
      // checked above — never a value the client chooses.
      agencyId: sp.get('scope') === 'mine' ? access.orgId : null,
      sort: sp.get('sort'),
      dir: sp.get('dir'),
      page: num('page') ?? 1,
      // An explicit id list is the page: paging it would drop selections.
      pageSize: ids.length ? ids.length : (num('pageSize') ?? 20),
    })

    // Only the first load asks for facets; later filter changes reuse them.
    if (sp.get('facets') === '1') data.facets = await listKolFacets()

    // Every card draws an add/remove toggle for My Creators.
    const mine = await myCreatorIdsAmong(access.orgId, data.rows.map(r => r.id))
    for (const r of data.rows) r.inMyCreators = mine.has(r.id)

    /**
     * Brand Match, for the creators on this page — `?match=1`.
     *
     * The criteria are the ones this agency saved on its Brand Profile
     * (`brand_profile.what_matters`), read here, so no caller passes them.
     * Match % is the plain mean of each KOL's What Matters scores on those
     * criteria (`whatMatters/brandMatch.ts`); each row carries its breakdown.
     * With nothing saved, `brandMatch.unavailable` is 'no_selection' and no KOL
     * is scored. Typed here rather than on `KolDirectoryPayload`, which is not
     * this change's to widen.
     */
    let brandMatch: DirectoryBrandMatch | undefined
    if (sp.get('match') === '1') {
      const profile = await getBrandProfile(access.orgId)
      brandMatch = await brandMatchForDirectory(data.rows.map(r => r.id), profile.whatMatters)
    }

    return NextResponse.json(brandMatch ? { ...data, brandMatch } : data)
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
