import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { runScheduler } from '@/lib/monitoring/scheduler'

// POST /api/admin/scheduler/trigger
// Protected by admin session — for manual trigger from admin panel
export async function POST() {
  const session = await auth()
  if (session?.user?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const summary = await runScheduler('manual-sync')
  return NextResponse.json(summary)
}
