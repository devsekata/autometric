import { NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { deleteReportTemplate } from '@/lib/reports/queries'

export const runtime = 'nodejs'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  const { id: orgId, templateId } = await params
  const access = await requireOrgMemberById(orgId)
  if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

  const deleted = await deleteReportTemplate(access.orgId, templateId)
  if (!deleted) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
