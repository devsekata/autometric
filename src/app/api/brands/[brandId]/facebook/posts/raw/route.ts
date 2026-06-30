import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, getConnectedFbAccount } from '@/lib/brands/queries'
import pool from '@/lib/db'

type Params = { params: Promise<{ brandId: string }> }

// GET /api/brands/[brandId]/facebook/posts/raw
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId  = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { brandId } = await params
    const orgId = await verifyBrandAccess(brandId, userId)
    if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

    const account = await getConnectedFbAccount(brandId)
    if (!account) {
      return NextResponse.json({ error: 'No connected Facebook account found.' }, { status: 404 })
    }

    const { rows } = await pool.query(
      `SELECT *
       FROM l0_raw.fb_post_snapshots
       WHERE social_account_id = $1
       ORDER BY posted_at DESC NULLS LAST
       LIMIT 100`,
      [account.id]
    )

    return NextResponse.json({ data: rows })
  } catch (err) {
    console.error('[GET /api/brands/[brandId]/facebook/posts/raw]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
