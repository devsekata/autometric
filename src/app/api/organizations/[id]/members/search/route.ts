import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getMemberRole } from '@/lib/organizations/queries'
import pool from '@/lib/db'

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
    if (email.length < 4) return NextResponse.json({ data: [] })

    const { rows } = await pool.query<UserSearchResult>(
      `SELECT id, name, email, avatar_url
       FROM users
       WHERE email ILIKE $1
         AND id NOT IN (
           SELECT user_id FROM organization_members
           WHERE organization_id = $2
             AND user_id IS NOT NULL
             AND status != 'CANCELLED'
         )
       LIMIT 5`,
      [`%${email}%`, id]
    )

    return NextResponse.json({ data: rows })
  } catch (err) {
    console.error('[GET /api/organizations/[id]/members/search]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
