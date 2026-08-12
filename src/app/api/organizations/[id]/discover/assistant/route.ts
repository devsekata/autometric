import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { generateGeminiContent } from '@/lib/reports/ai/gemini'
import { getDiscoverSummary } from '@/lib/discover/summary'
import {
  ASSISTANT_SYSTEM_PROMPT, buildAssistantPrompt, contentTypesFor, isValidPair, parseConcepts,
} from '@/lib/discover/assistant'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/**
 * POST — generate content concepts for one platform + content type.
 *
 * The grounding summary is read server-side rather than accepted from the
 * client. It is the same data the client could fetch anyway, but building the
 * prompt from a client-supplied payload would let a caller feed the model
 * whatever it liked, and the answer would still arrive wearing this org's name.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id: orgId } = await params
    const access = await requireOrgMemberById(orgId)
    if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

    const body = await req.json().catch(() => null)
    const platform = typeof body?.platform === 'string' ? body.platform : ''
    const contentType = typeof body?.contentType === 'string' ? body.contentType : ''

    if (!isValidPair(platform, contentType)) {
      return NextResponse.json(
        { error: 'platform dan contentType tidak dikenali.' }, { status: 400 })
    }

    const summary = await getDiscoverSummary(orgId)
    if (summary.totals.posts === 0) {
      return NextResponse.json(
        { error: 'Belum ada konten yang tersinkron, jadi belum ada data untuk jadi dasar ide.' },
        { status: 409 },
      )
    }

    const label = contentTypesFor(platform).find(t => t.id === contentType)?.label ?? contentType
    const raw = await generateGeminiContent(
      buildAssistantPrompt(summary, platform, label), ASSISTANT_SYSTEM_PROMPT)

    const concepts = parseConcepts(raw)
    if (concepts.length === 0) {
      return NextResponse.json(
        { error: 'AI tidak mengembalikan konsep yang bisa dibaca — coba lagi.' }, { status: 502 })
    }

    return NextResponse.json({ concepts, groundedOn: summary.totals.posts })
  } catch (e) {
    console.error('[discover/assistant]', e)
    const msg = e instanceof Error ? e.message : ''
    // A key problem is a setup problem, not a failure of the request, and the
    // fix is different — so it gets its own message and a 503. Both shapes count:
    // no key at all, and a key the provider rejects (API_KEY_INVALID), which
    // otherwise reads to the user as "the AI is broken".
    const keyProblem =
      msg.includes('GEMINI_API_KEY') || /API_KEY_INVALID|API key not valid/i.test(msg)
    return NextResponse.json(
      {
        error: keyProblem
          ? 'AI belum aktif: GEMINI_API_KEY belum diset atau ditolak provider. Periksa konfigurasi server.'
          : 'Gagal membuat konsep konten.',
      },
      { status: keyProblem ? 503 : 500 },
    )
  }
}
