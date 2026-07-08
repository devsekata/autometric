import type { SlideType, AiInsight, AiRecommendation, RecommendationType } from '../data/slideModel'

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
OUTPUT FORMAT — STRICT (return ONLY these two sections)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Section 1 — ANALYSIS (required):
One flowing sentence covering the key pattern (Layers 1–3). Use **bold** for ALL numbers and percentages. STRICT LIMIT: exactly 1 sentence, max 150 characters total. Start directly with the finding — no label, no heading.

[blank line]

Section 2 — RECOMMENDATIONS (required):
Give AT MOST 3 recommendations — only the most impactful ones the data clearly supports. NEVER more than 3 lines. Each is exactly one line "LABEL: text" (no line breaks within a recommendation):
SCALE: [strong consistent performance worth increasing — max 65 chars]
REFINE: [has potential but needs improvement — max 65 chars]
EXPLORE: [untested/underused direction the data suggests — max 65 chars]
STOP: [consistently underperforming, deprioritize — max 65 chars]

Rules: pick the 3 (or fewer) most important categories; OMIT the rest entirely (never write "None"/placeholder). Truncate text rather than exceed 65 chars. No heading, preamble, or closing remark.
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
    `Apply the four-layer reasoning framework. Bold all numbers and percentages. ` +
    `Analysis: exactly 1 sentence, max 150 characters. Recommendations: AT MOST 3 (the most impactful), ` +
    `one line each, max 65 characters, omit unsupported categories entirely (never write None). ` +
    `Follow the strict two-section output format exactly.`
  )
}

/** Parse Gemini output into { analysis, recommendations }, stripping section headers. */
export function parseInsight(raw: string): AiInsight {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
  const recommendations: AiRecommendation[] = []
  const analysisLines: string[] = []
  const labelRe = /^(SCALE|REFINE|EXPLORE|STOP):\s*/i
  const isNone = (t: string) => /^\(?\s*none\s*\)?\.?$/i.test(t)
  const isHeader = (t: string) =>
    /^(section\s*\d+\s*[—:.-]*\s*)?(analysis|optimization\s+recommendations?|recommendations?)\s*:?\s*$/i.test(t)

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    const inline = line.match(/^(SCALE|REFINE|EXPLORE|STOP):\s*(.+)/i)
    if (inline) {
      const text = inline[2].trim()
      if (!isNone(text)) recommendations.push({ type: inline[1].toUpperCase() as RecommendationType, text })
      continue
    }
    const labelOnly = line.match(/^(SCALE|REFINE|EXPLORE|STOP):\s*$/i)
    if (labelOnly && i + 1 < lines.length && !labelRe.test(lines[i + 1])) {
      const text = lines[++i].trim()
      if (!isNone(text)) recommendations.push({ type: labelOnly[1].toUpperCase() as RecommendationType, text })
      continue
    }
    // strip a leading "Section 1 — ANALYSIS:" prefix, then drop standalone section headers
    line = line.replace(/^(section\s*\d+\s*[—:.-]*\s*)?analysis\s*[—:.-]*\s*/i, '').trim()
    if (!line || isHeader(line)) continue
    analysisLines.push(line)
  }
  return { analysis: analysisLines.join(' ').replace(/\s+/g, ' ').trim(), recommendations }
}
