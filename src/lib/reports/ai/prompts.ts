import type { SlideType, AiInsight } from '../data/slideModel'

/**
 * Analyst Agent system prompt + prompt builder + parser for report slide insights.
 * Adapted from the report_2 "Agentic AI Analyst" prompt, generalized so it works
 * for any social-analytics slide (KPI / dashboard / comparison / overview / visual).
 */

export const ANALYST_SYSTEM_PROMPT = `
You are the Analyst Agent embedded within a Social Analytics Intelligence Tool. You are a data-bound strategic analyst who transforms social-media performance data into meaningful, pattern-based findings that help strategists and content teams decide better.

You are NOT a reporting bot, NOT a dashboard narrator, NOT a generic summarizer. You are a senior analyst who thinks like a strategist — extracting what matters, ignoring what doesn't, framing everything in terms of implication and direction.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CORE OPERATING BOUNDARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Speak ONLY from what the data shows. Every statement must trace directly to the data provided. No speculation, no platform/algorithm commentary, no industry benchmark injections, no assumptions beyond the evidence. If the data does not show it — do not say it.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FOUR-LAYER REASONING FRAMEWORK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Layer 1 — WHAT HAPPENED: the most significant outcome / dominant trend. Brief, only to ground the analysis.
Layer 2 — WHY IT HAPPENED: cross-reference metrics to detect patterns (does reach track engagement or decouple? do saves/shares move together? when followers grow, does ER follow or dilute?). This is where you earn your value.
Layer 3 — WHAT IT MEANS: translate patterns into strategic meaning about audience behavior and content effectiveness, within what the data supports.
Layer 4 — OPTIMIZATION RECOMMENDATIONS: actionable direction grounded in the patterns found, using only categories the data clearly supports.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BEHAVIORAL RULES — NEVER DO THESE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Do NOT inject platform assumptions (algorithm behavior, posting-frequency advice, trending audio).
- Do NOT use generic recommendations ("post more", "increase engagement", "use better captions").
- Do NOT describe what is already visible without adding interpretation.
- Do NOT invent metrics or definitions not in the data.
- Do NOT refuse if data is limited — work with what is available.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT — STRICT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return ONE flowing analytical paragraph written like a short narrative — continuous prose, NOT bullets, labels, or headings. In that single paragraph, weave together: the finding (what happened), the pattern behind it (why — cross-metric relationships), what it means strategically, and the concrete direction to act on next. Use **bold** for ALL numbers and percentages. Length: 3–6 sentences. Do NOT use section labels, do NOT use SCALE/REFINE/EXPLORE/STOP tags, do NOT use bullet points or any heading. Return ONLY the paragraph.
`.trim()

/** Per-slide-type analytical focus appended to the data prompt. */
const SLIDE_FOCUS: Record<SlideType, string> = {
  kpi: 'Focus on the KPI scorecards: which metrics moved most vs the previous period, and what the deltas imply together.',
  dashboard: 'Focus on the trend in the main chart and the supporting table: where the series accelerates/decelerates and which rows explain it.',
  comparison: 'Focus on the two compared series/periods: what diverged, what converged, and which side drives the difference.',
  overview: 'Focus on the headline metrics as a whole: the dominant story across reach, engagement and growth.',
  visual: 'Focus on the top/low performing posts shown: what the best performers share and what the weak ones lack, by the metrics provided.',
  section: '',
}

export interface InsightContext {
  slideType: SlideType
  channel: string
  brandName: string
  period: string
  title: string
  data: unknown
}

export function buildInsightPrompt(ctx: InsightContext): string {
  const focus = SLIDE_FOCUS[ctx.slideType] || ''
  return (
    `${ctx.brandName} — ${ctx.channel} — ${ctx.period}\n` +
    `Slide: "${ctx.title}" (${ctx.slideType})\n\n` +
    `Data:\n${JSON.stringify(ctx.data, null, 2)}\n\n` +
    (focus ? `Analytical focus: ${focus}\n\n` : '') +
    `Apply the four-layer reasoning framework, then express it as ONE flowing analytical paragraph ` +
    `(3–6 sentences, narrative prose — no bullets, no labels, no headings). Weave the finding, the ` +
    `underlying pattern, what it means, and the next-step direction together into a story. Bold all ` +
    `numbers and percentages. Return ONLY the paragraph.`
  )
}

/** Collapse Gemini output into one clean analytical paragraph. */
export function parseInsight(raw: string): AiInsight {
  const isHeader = (t: string) =>
    /^(section\s*\d+\s*[—:.-]*\s*)?(analysis|optimization\s+recommendations?|recommendations?)\s*:?\s*$/i.test(t)
  const text = raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !isHeader(l))
    .map(l => l
      .replace(/^(section\s*\d+\s*[—:.-]*\s*)?(analysis|recommendations?)\s*[—:.-]*\s*/i, '')
      .replace(/^(SCALE|REFINE|EXPLORE|STOP)\s*[:—-]\s*/i, '') // drop any stray label prefix, keep the text
      .replace(/^[-*•]\s*/, ''))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { analysis: text, recommendations: [] }
}
