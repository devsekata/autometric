import { NextRequest, NextResponse } from 'next/server'
import { runScheduler } from '@/lib/monitoring/scheduler'
import { getSchedulerConfig, shouldRunNow } from '@/lib/monitoring/scheduler-config'

// POST /api/scheduler/run
// Protected by Authorization: Bearer <SCHEDULER_SECRET>
// Crontab — run every hour, config controls which hour(s) actually execute:
//   0 * * * * curl -s -X POST https://yourdomain.com/api/scheduler/run \
//     -H "Authorization: Bearer $SCHEDULER_SECRET" >> /var/log/autometric.log 2>&1
export async function POST(req: NextRequest) {
  const secret = process.env.SCHEDULER_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const config = await getSchedulerConfig()

  if (!shouldRunNow(config)) {
    return NextResponse.json({ skipped: true, reason: 'Not scheduled for this hour' })
  }

  const summary = await runScheduler('daily-sync')
  return NextResponse.json(summary)
}
