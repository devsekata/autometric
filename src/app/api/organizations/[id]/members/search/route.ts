import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getMemberRole } from '@/lib/organizations/queries'
import kolDb from '@/lib/kolDb'

type Params = { params: Promise<{ id: string }> }

export interface UserSearchResult {
  id: string
  name: string | null
  email: string
  avatar_url: string | null
}

// GET /api/organizations/[id]/members/search?email=...
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const role = await getMemberRole(id, userId)
    if (!role) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 })

    const email = req.nextUrl.searchParams.get('email')?.trim().toLowerCase() ?? ''
    // Exact address only. A substring search let any member list every account
    // on the platform one letter at a time; a full address reveals nothing the
    // caller did not already know.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ data: [] })

    const { rows } = await kolDb().query<UserSearchResult>(
      `SELECT u.id, u.name, u.email, u.avatar_url
       FROM public.user u
       WHERE lower(u.email) = $1
         AND NOT EXISTS (
           SELECT 1 FROM public.agency_members am
           WHERE am.agency_id = $2
             AND am.user_id = u.id
             AND am.status IS DISTINCT FROM 'CANCELLED'
         )
       LIMIT 1`,
      [email, id]
    )

    return NextResponse.json({ data: rows })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/members/search]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
