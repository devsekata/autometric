import { NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { deleteReportExport } from '@/lib/reports/queries'
import { deleteFromGCS } from '@/lib/reports/storage/gcs'
import { deleteCoverImage } from '@/lib/reports/storage/cloudinary'

export const runtime = 'nodejs'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; exportId: string }> },
) {
  const { id: orgId, exportId } = await params
  const access = await requireOrgMemberById(orgId)
  if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

  const deleted = await deleteReportExport(access.orgId, exportId)
  if (!deleted) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  // Remove the stored files too; ignore storage errors so the row stays deleted.
  await deleteFromGCS(deleted.gcsObjectName)
  if (deleted.coverPublicId) await deleteCoverImage(deleted.coverPublicId)

  return NextResponse.json({ ok: true })
}
