import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, addCompetitor } from '@/lib/brands/queries'
import { PLATFORM_LIST } from '@/lib/brands/types'

type Params = { params: Promise<{ brandId: string }> }

// POST /api/brands/[brandId]/competitors
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { brandId } = await params
    const orgId = await verifyBrandAccess(brandId, userId)
    if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

    const body = await req.json()
    const platform = typeof body?.platform === 'string' ? body.platform.trim() : ''
    const username  = typeof body?.username  === 'string' ? body.username.trim().replace(/^@/, '') : ''

    if (!platform || !PLATFORM_LIST.includes(platform as never)) {
      return NextResponse.json({ error: 'Valid platform is required.' }, { status: 400 })
    }
    if (!username) {
      return NextResponse.json({ error: 'Username is required.' }, { status: 400 })
    }

    const competitor = await addCompetitor(brandId, platform, username)
    return NextResponse.json({ data: competitor }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/brands/[brandId]/competitors]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
