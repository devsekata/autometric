import { NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { getPostCover } from '@/lib/discover/kolPostCover'

type Params = { params: Promise<{ id: string; kolId: string; postId: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/organizations/[id]/discover/kol-directory/[kolId]/cover/[postId]
 *
 * One harvested post's cover picture, served from here rather than linked to
 * directly. The link the warehouse stores is signed and has expired for every
 * post harvested so far, so the Content grid was rendering as blank tiles; this
 * route re-mints the picture from the post's permalink instead (see
 * `@/lib/discover/kolPostCover`).
 *
 * It takes a post id, never a URL. Anything else would make this an open proxy —
 * a URL parameter here would let a caller aim the server at any host it liked.
 * The id is resolved against `kolId`, so a member can only pull covers of the
 * creator they are looking at.
 *
 * A cover that cannot be recovered answers 404 on purpose: the grid already has
 * a format tile to fall back to, and a placeholder image served from here would
 * be cached by the browser as though it were the post.
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const { id: orgId, kolId, postId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    if (!UUID.test(kolId) || !UUID.test(postId)) {
      return NextResponse.json({ error: 'Bad identifier.' }, { status: 400 })
    }

    const image = await getPostCover(kolId, postId)
    if (!image) return NextResponse.json({ error: 'Cover tidak tersedia.' }, { status: 404 })

    return new NextResponse(image.body, {
      headers: {
        'Content-Type': image.contentType,
        'Content-Length': String(image.body.byteLength),
        // Private: the picture is public, but the route behind it is not, and a
        // shared cache keyed on the URL alone would serve it past the auth check.
        'Cache-Control': 'private, max-age=21600',
      },
    })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/discover/kol-directory/[kolId]/cover/[postId]]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
