import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { checkKolExists, type AddKolPlatform } from '@/lib/kolDirectory/addKolCheck'

/**
 * POST /api/kol-directory/add/check
 *
 * "Add New KOL" — step one. Just a login check: `kol_directory` is not
 * org-scoped, so there is no membership to verify beyond "someone is signed
 * in".
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const platform = body?.platform as AddKolPlatform | undefined
    const input = body?.input as string | undefined

    if (platform !== 'instagram' && platform !== 'tiktok') {
      return NextResponse.json({ error: 'platform must be "instagram" or "tiktok".' }, { status: 400 })
    }
    if (typeof input !== 'string' || !input.trim()) {
      return NextResponse.json({ error: 'input is required.' }, { status: 400 })
    }

    const result = await checkKolExists(platform, input)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[POST /api/kol-directory/add/check]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
