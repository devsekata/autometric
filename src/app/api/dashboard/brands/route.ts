import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

/**
 * GET /api/dashboard/brands
 *
 * Switched off: this endpoint reads or writes the analytics warehouse, and the
 * KOL product uses the KOL database only. It answers "unavailable" until its
 * data has a source of truth on the KOL server.
 */
async function unavailable() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return featureUnavailable('Dashboard')
}

export async function GET(_req: NextRequest) { return unavailable() }
