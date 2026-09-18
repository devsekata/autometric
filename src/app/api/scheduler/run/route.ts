import { NextRequest, NextResponse } from 'next/server'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

/**
 * POST /api/scheduler/run
 *
 * Switched off: this endpoint reads and writes scheduler config, sync logs and raw snapshots on the analytics warehouse. The KOL product reads the KOL database
 * only, so it answers "unavailable" instead of serving warehouse data.
 */
async function unavailable(req: NextRequest) {
  const secret = process.env.SCHEDULER_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return featureUnavailable('Scheduler')
}

export async function POST(req: NextRequest) { return unavailable(req) }
