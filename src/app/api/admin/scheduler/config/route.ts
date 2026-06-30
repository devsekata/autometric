import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getSchedulerConfig, saveSchedulerConfig } from '@/lib/monitoring/scheduler-config'
import type { ScheduleTime } from '@/lib/monitoring/scheduler-config'

async function requireAdmin() {
  const session = await auth()
  return session?.user?.role === 'ADMIN' ? session : null
}

export async function GET() {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const config = await getSchedulerConfig()
  return NextResponse.json(config)
}

export async function PUT(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { scheduleTimes, isActive } = await req.json()

  const valid =
    Array.isArray(scheduleTimes) &&
    scheduleTimes.every((t: unknown): t is ScheduleTime =>
      typeof t === 'object' && t !== null &&
      typeof (t as ScheduleTime).hour   === 'number' && (t as ScheduleTime).hour   >= 0 && (t as ScheduleTime).hour   <= 23 &&
      typeof (t as ScheduleTime).minute === 'number' && (t as ScheduleTime).minute >= 0 && (t as ScheduleTime).minute <= 59
    )

  if (!valid) return NextResponse.json({ error: 'Invalid scheduleTimes' }, { status: 400 })

  await saveSchedulerConfig(scheduleTimes, Boolean(isActive))
  return NextResponse.json({ success: true })
}
