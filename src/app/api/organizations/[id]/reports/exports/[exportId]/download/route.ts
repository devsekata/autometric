import { NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { getReportExport } from '@/lib/reports/queries'
import { downloadFromGCS } from '@/lib/reports/storage/gcs'

export const runtime = 'nodejs'

const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; exportId: string }> },
) {
  const { id: orgId, exportId } = await params
  const access = await requireOrgMemberById(orgId)
  if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

  const row = await getReportExport(access.orgId, exportId)
  if (!row) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  let buffer: Buffer
  try {
    buffer = await downloadFromGCS(row.gcsObjectName)
  } catch (e) {
    console.error('[reports/exports] GCS download failed:', e)
    return NextResponse.json({ error: 'File unavailable.' }, { status: 502 })
  }

  const fileName = `${row.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'report'}.pptx`
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': PPTX_MIME,
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  })
}
