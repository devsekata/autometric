import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

/**
 * GET, PUT /api/admin/scheduler/config
 *
 * Switched off: this endpoint reads and writes scheduler config, sync logs and raw snapshots on the analytics warehouse. The KOL product reads the KOL database
 * only, so it answers "unavailable" instead of serving warehouse data.
 */
async function unavailable() {
  const session = await auth()
  if (session?.user?.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return featureUnavailable('Scheduler')
}

export async function GET() { return unavailable() }
export async function PUT() { return unavailable() }
