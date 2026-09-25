import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

/**
 * POST /api/admin/competitor-scheduler/trigger
 *
 * Switched off: this endpoint reads or writes the analytics warehouse, and the
 * KOL product uses the KOL database only. It answers "unavailable" until its
 * data has a source of truth on the KOL server.
 */
async function unavailable() {
  const session = await auth()
  // Admin-only, as before it was switched off.
  if (session?.user?.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return featureUnavailable('Scheduler')
}

export async function POST(_req: NextRequest) { return unavailable() }
