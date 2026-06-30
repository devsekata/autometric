import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess, getConnectedIgAccount } from '@/lib/brands/queries'
import { fetchAllIgTaggedPosts } from '@/lib/instagram/graph'
import { saveIgTaggedPosts, IgTaggedPostItem } from '@/lib/instagram/queries'

type Params = { params: Promise<{ brandId: string }> }

// POST /api/brands/[brandId]/instagram/tagged/snapshot
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId  = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { brandId } = await params
    const orgId = await verifyBrandAccess(brandId, userId)
    if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

    const account = await getConnectedIgAccount(brandId)
    if (!account) {
      return NextResponse.json({ error: 'No connected Instagram account found.' }, { status: 404 })
    }

    const { id: socialAccountId, platform_user_id, oauth_token } = account

    const snapshotDays = parseInt(process.env.IG_SNAPSHOT_DAYS ?? '60', 10)
    const raw = await fetchAllIgTaggedPosts(platform_user_id, oauth_token, snapshotDays)

    const items: IgTaggedPostItem[] = raw.map((p) => ({
      socialAccountId,
      mediaId:      p.id          as string,
      postedAt:     (p.timestamp  as string) ?? null,
      caption:      (p.caption    as string) ?? null,
      mediaType:    (p.media_type as string) ?? null,
      permalink:    (p.permalink  as string) ?? null,
      taggedBy:     (p.username   as string) ?? null,
      likeCount:    (p.like_count     as number) ?? null,
      commentCount: (p.comments_count as number) ?? null,
      coverImage:   (p.thumbnail_url  as string) ?? (p.media_url as string) ?? null,
    }))

    await saveIgTaggedPosts(items)

    return NextResponse.json({
      success:     true,
      fetched_at:  new Date().toISOString(),
      posts_saved: items.length,
    }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/brands/[brandId]/instagram/tagged/snapshot]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
