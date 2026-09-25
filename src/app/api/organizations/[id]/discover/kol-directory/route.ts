import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { listKolDirectory, listKolFacets } from '@/lib/discover/kolDirectory'
import { myCreatorIdsAmong } from '@/lib/discover/myCreators'
import { getBrandProfile } from '@/lib/discover/brandMatch/profile'
import { brandMatchForDirectory, type DirectoryBrandMatch } from '@/lib/discover/whatMatters/brandMatch'
import { storedBrandMatchForDirectory } from '@/lib/discover/whatMatters/brandMatchStore'

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
     * Brand Profile eligibility — `?brandProfile=1`, sent by the main Directory
     * list only (My Creators included, which is the same list).
     *
     * Read once, and turned into hard filters on the criteria whose creator-side
     * data is real today:
     *   - gender_majority      → kol_profile_card.creator_gender (Female/Male;
     *                            Any and Balanced filter nothing)
     *   - preferred_platforms  → platforms.key
     *   - preferred_tiers      → kol_tiers.name
     *   - preferred_categories → kol_categories.taxonomy_key
     * Several values in one field match any of them; the fields, and the manual
     * Directory filters, all have to hold together. An empty field filters
     * nothing.
     *
     * Deliberately NOT filters: brand_category (the brand's own industry, not a
     * creator requirement), and age, country, city, audience interests, content
     * style, personality and values — their creator-side data is missing or not
     * mapped yet, and filtering on it would empty the Directory.
     *
     * Never applied to `?ids=`: Compare, Cart, SmartDiscovery and the Brand
     * Match request fetch creators the user already picked, and must get
     * exactly those back. Eligibility only — none of it is part of Match %.
     */
    let creatorGender: 'female' | 'male' | null = null
    let profilePlatforms: string[] | null = null
    let profileTiers: string[] | null = null
    let profileCategories: string[] | null = null
    if (sp.get('brandProfile') === '1' && !ids.length) {
      const profile = await getBrandProfile(access.orgId)
      const g = profile.genderMajority
      creatorGender = g === 'Female' ? 'female' : g === 'Male' ? 'male' : null
      profilePlatforms = profile.preferredPlatforms.length ? profile.preferredPlatforms : null
      profileTiers = profile.preferredTiers.length ? profile.preferredTiers : null
      profileCategories = profile.preferredCategories.length ? profile.preferredCategories : null
    }

    const data = await listKolDirectory({
      ids,
      creatorGender,
      profilePlatforms,
      profileTiers,
      profileCategories,
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
      audienceGender: sp.get('audGender'),
      audienceAge: sp.get('audAge'),
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
     * criteria plus, for every Target Audience field the profile fills in
     * (gender, age, country, city, interests), that criterion's score from the
     * Audience Analysis L2 (`whatMatters/brandMatch.ts`, `audienceMatch.ts`);
     * each row carries its breakdown. With nothing chosen, `brandMatch.unavailable`
     * is 'no_selection' and no KOL is scored. Typed here rather than on
     * `KolDirectoryPayload`, which is not this change's to widen.
     */
    let brandMatch: DirectoryBrandMatch | undefined
    if (sp.get('match') === '1') {
      const profile = await getBrandProfile(access.orgId)
      const ids = data.rows.map(r => r.id)
      // The background result (brand_match_result) when it is current for this
      // profile version and this KOL data version; otherwise computed now.
      brandMatch = await storedBrandMatchForDirectory(access.orgId, ids, profile.whatMatters, profile)
        ?? await brandMatchForDirectory(ids, profile.whatMatters, profile)
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
