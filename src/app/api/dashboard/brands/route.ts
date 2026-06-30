import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getOrgBySlugForUser } from '@/lib/organizations/queries'
import { getDashboardBrands } from '@/lib/dashboard/brands'

// GET /api/dashboard/brands?org=<orgSlug>
// Kept outside /api/organizations/[id] to avoid a dynamic-segment name clash.
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const slug = req.nextUrl.searchParams.get('org')
    if (!slug) return NextResponse.json({ error: 'Missing org.' }, { status: 400 })

    const org = await getOrgBySlugForUser(slug, userId) // enforces active membership
    if (!org) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })

    const brands = await getDashboardBrands(org.id)
    return NextResponse.json({ brands })
  } catch (err) {
    console.error('[GET /api/dashboard/brands]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
