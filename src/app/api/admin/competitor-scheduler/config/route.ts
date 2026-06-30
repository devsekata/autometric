import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getCompetitorSchedulerConfig, saveCompetitorSchedulerConfig } from '@/lib/competitors/scheduler-config'
import type { ScheduleTime } from '@/lib/competitors/scheduler-config'

async function requireAdmin() {
  const session = await auth()
  return session?.user?.role === 'ADMIN' ? session : null
}

export async function GET() {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const config = await getCompetitorSchedulerConfig()
  return NextResponse.json(config)
}

export async function PUT(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { scheduleTimes, postsDayOfMonth, isActive } = await req.json()

  const validTimes =
    Array.isArray(scheduleTimes) &&
    scheduleTimes.every((t: unknown): t is ScheduleTime =>
      typeof t === 'object' && t !== null &&
      typeof (t as ScheduleTime).hour   === 'number' && (t as ScheduleTime).hour   >= 0 && (t as ScheduleTime).hour   <= 23 &&
      typeof (t as ScheduleTime).minute === 'number' && (t as ScheduleTime).minute >= 0 && (t as ScheduleTime).minute <= 59
    )

  const validDay =
    typeof postsDayOfMonth === 'number' &&
    Number.isInteger(postsDayOfMonth) &&
    postsDayOfMonth >= 1 && postsDayOfMonth <= 28

  if (!validTimes)  return NextResponse.json({ error: 'Invalid scheduleTimes' }, { status: 400 })
  if (!validDay)    return NextResponse.json({ error: 'postsDayOfMonth must be 1-28' }, { status: 400 })

  await saveCompetitorSchedulerConfig(scheduleTimes, postsDayOfMonth, Boolean(isActive))
  return NextResponse.json({ success: true })
}
