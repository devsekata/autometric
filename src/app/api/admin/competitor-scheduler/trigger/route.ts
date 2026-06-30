import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { runCompetitorScheduler } from '@/lib/competitors/scheduler'

// POST /api/admin/competitor-scheduler/trigger
// Protected by admin session — manual trigger from the admin panel.
// A manual run does a FULL refresh: profile + posts for every competitor.
export async function POST() {
  const session = await auth()
  if (session?.user?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const summary = await runCompetitorScheduler('competitor-manual', { syncPosts: true })
  return NextResponse.json(summary)
}
