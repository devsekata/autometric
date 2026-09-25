import { NextRequest } from 'next/server'
import { featureUnavailable } from '@/lib/discover/featureUnavailable'

/**
 * POST /api/scheduler/run
 *
 * Switched off: this endpoint reads or writes the analytics warehouse, and the
 * KOL product uses the KOL database only. It answers "unavailable" until its
 * data has a source of truth on the KOL server.
 */
async function unavailable() {
  return featureUnavailable('Scheduler')
}

export async function POST(_req: NextRequest) { return unavailable() }
