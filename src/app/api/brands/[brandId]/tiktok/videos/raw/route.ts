import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, getConnectedTtAccount } from '@/lib/brands/queries'
import pool from '@/lib/db'

type Params = { params: Promise<{ brandId: string }> }

// GET /api/brands/[brandId]/tiktok/videos/raw
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId  = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { brandId } = await params
    const orgId = await verifyBrandAccess(brandId, userId)
    if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

    const account = await getConnectedTtAccount(brandId)
    if (!account) {
      return NextResponse.json({ error: 'No connected TikTok account found.' }, { status: 404 })
    }

    const { rows } = await pool.query(
      `SELECT DISTINCT ON (video_id)
         id, video_id, posted_at, title, description, duration,
         cover_image_url, share_url,
         like_count, comment_count, share_count, view_count, engagement_rate,
         fetched_at
       FROM l0_raw.tt_video_snapshots
       WHERE social_account_id = $1
       ORDER BY video_id, fetched_at DESC`,
      [account.id]
    )

    return NextResponse.json({ data: rows })
  } catch (err) {
    console.error('[GET /api/brands/[brandId]/tiktok/videos/raw]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
