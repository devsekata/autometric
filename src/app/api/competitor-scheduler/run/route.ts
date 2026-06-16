import { NextRequest, NextResponse } from 'next/server'
import { runCompetitorScheduler } from '@/lib/competitors/scheduler'
import { getCompetitorSchedulerConfig, shouldRunNow, isPostsDay } from '@/lib/competitors/scheduler-config'

// POST /api/competitor-scheduler/run
// Protected by Authorization: Bearer <SCHEDULER_SECRET>
// Crontab — run every minute, config controls which time(s) actually execute:
//   * * * * * curl -s -X POST https://yourdomain.com/api/competitor-scheduler/run \
//     -H "Authorization: Bearer $SCHEDULER_SECRET" >> /var/log/autometric.log 2>&1
//
// Profile is synced on every scheduled run; posts are synced additionally when
// today's WIB date matches the configured posts_day_of_month.
export async function POST(req: NextRequest) {
  const secret = process.env.SCHEDULER_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const config = await getCompetitorSchedulerConfig()

  if (!shouldRunNow(config)) {
    return NextResponse.json({ skipped: true, reason: 'Not scheduled for this time' })
  }

  const syncPosts = isPostsDay(config)
  const summary   = await runCompetitorScheduler('competitor-daily', { syncPosts })
  return NextResponse.json({ ...summary, syncPosts })
}
