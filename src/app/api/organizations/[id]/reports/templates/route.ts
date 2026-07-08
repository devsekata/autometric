import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { insertReportTemplate } from '@/lib/reports/queries'
import type { ReportTemplateConfig } from '@/lib/reports/data/slideModel'

export const runtime = 'nodejs'

interface SaveTemplateBody {
  name: string
  sourceBrandName: string | null
  config: ReportTemplateConfig
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orgId } = await params
  const access = await requireOrgMemberById(orgId)
  if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

  let body: SaveTemplateBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const name = (body.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'Template name is required.' }, { status: 400 })
  if (!body.config || !Array.isArray(body.config.slides)) {
    return NextResponse.json({ error: 'Invalid template config.' }, { status: 400 })
  }

  try {
    const id = await insertReportTemplate({
      organizationId: access.orgId,
      createdBy: access.userId,
      name,
      sourceBrandName: body.sourceBrandName ?? null,
      config: body.config,
    })
    return NextResponse.json({ ok: true, id })
  } catch (e) {
    console.error('[reports/templates] DB insert failed:', e)
    return NextResponse.json({ error: 'Could not save template.' }, { status: 500 })
  }
}
