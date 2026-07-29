import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { EngineUnavailableError, fetchCategories } from '@/lib/csv/engine'

// GET /api/csv/categories
// Data acuan (tidak spesifik brand): kategori mana yang punya tujuan tulis, dan
// kategori mana yang sengaja ditolak beserta alasannya.
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ data: await fetchCategories() })
  } catch (err) {
    if (err instanceof EngineUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    console.error('[GET /api/csv/categories]', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
