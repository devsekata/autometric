import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

/**
 * GET /api/csv/categories
 *
 * Switched off: this endpoint writes brand accounts and Fanpage Karma data to the analytics warehouse (directly and through the mapping engine). The KOL product reads the KOL database
 * only, so it answers "unavailable" instead of serving warehouse data.
 */
async function unavailable() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return featureUnavailable('CSV upload')
}

export async function GET() { return unavailable() }
