import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { generateGeminiContent } from '@/lib/reports/ai/gemini'
import { ANALYST_SYSTEM_PROMPT, buildInsightPrompt, parseInsight, type InsightContext } from '@/lib/reports/ai/prompts'
import type { SlideType } from '@/lib/reports/data/slideModel'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }
const TYPES: SlideType[] = ['section', 'dashboard', 'comparison', 'kpi', 'visual', 'overview']

// POST /api/organizations/[id]/reports/ai-insight
// { slideType, channel, brandName, period, title, data } -> { analysis, recommendations }
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const ctx: InsightContext = {
      slideType: TYPES.includes(body?.slideType) ? (body.slideType as SlideType) : 'overview',
      channel: typeof body?.channel === 'string' ? body.channel : 'all',
      brandName: typeof body?.brandName === 'string' ? body.brandName : 'Brand',
      period: typeof body?.period === 'string' ? body.period : '',
      title: typeof body?.title === 'string' ? body.title : '',
      data: body?.data ?? {},
    }

    const raw = await generateGeminiContent(buildInsightPrompt(ctx), ANALYST_SYSTEM_PROMPT)
    const insight = parseInsight(raw)
    if (!insight.analysis && insight.recommendations.length === 0) {
      return NextResponse.json({ error: 'AI returned no usable insight — try again.' }, { status: 502 })
    }
    return NextResponse.json(insight)
  } catch (e) {
    console.error('[reports/ai-insight]', e)
    const msg = e instanceof Error ? e.message : ''
    return NextResponse.json(
      { error: msg.includes('GEMINI_API_KEY') ? 'AI is not configured on the server.' : 'Could not generate insight.' },
      { status: 500 },
    )
  }
}
