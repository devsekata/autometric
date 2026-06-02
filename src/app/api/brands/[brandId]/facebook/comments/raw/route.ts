import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, getConnectedFbAccount } from '@/lib/brands/queries'
import pool from '@/lib/db'

type Params = { params: Promise<{ brandId: string }> }

// GET /api/brands/[brandId]/facebook/comments/raw?postId=<post_id>
export async function GET(req: NextRequest, { params }: Params) {
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

    const postId = new URL(req.url).searchParams.get('postId')

    const { rows } = postId
      ? await pool.query(
          `SELECT *
           FROM l0_raw.fb_comments
           WHERE social_account_id = $1 AND post_id = $2
           ORDER BY comment_time DESC NULLS LAST
           LIMIT 200`,
          [account.id, postId]
        )
      : await pool.query(
          `SELECT *
           FROM l0_raw.fb_comments
           WHERE social_account_id = $1
           ORDER BY comment_time DESC NULLS LAST
           LIMIT 200`,
          [account.id]
        )

    return NextResponse.json({ data: rows })
  } catch (err) {
    console.error('[GET /api/brands/[brandId]/facebook/comments/raw]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
