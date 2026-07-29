import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess } from '@/lib/brands/queries'
import { getBrandDataSources, getCsvUploadHistory } from '@/lib/csv/queries'
import { engineHealth } from '@/lib/csv/engine'
import { CSV_PLATFORMS } from '@/lib/csv/types'

type Params = { params: Promise<{ brandId: string }> }

// GET /api/brands/[brandId]/csv/sources
// Isi tab Data Sources: sumber per platform, riwayat upload, status mesin.
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { brandId } = await params
    const orgId = await verifyBrandAccess(brandId, userId)
    if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

    const withHealth = req.nextUrl.searchParams.get('health') === '1'
    const [sources, history, health] = await Promise.all([
      getBrandDataSources(brandId),
      getCsvUploadHistory(brandId),
      withHealth ? engineHealth() : Promise.resolve(null),
    ])

    return NextResponse.json({
      data: {
        sources,
        history,
        supported_platforms: CSV_PLATFORMS,
        engine: health,
      },
    })
  } catch (err) {
    console.error('[GET /api/brands/[brandId]/csv/sources]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
