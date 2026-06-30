import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMemberById } from '@/lib/reports/access'
import { uploadToGCS } from '@/lib/reports/storage/gcs'
import { uploadCoverImage, cloudinaryConfigured } from '@/lib/reports/storage/cloudinary'
import { insertReportExport, nextCoverSequence, type ReportExportConfig } from '@/lib/reports/queries'

export const runtime = 'nodejs'

interface SaveMeta {
  title: string
  brandName: string
  period: string
  slideCount: number
  config: ReportExportConfig
}

function slug(s: string): string {
  return (s || 'report').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'report'
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orgId } = await params
  const access = await requireOrgMemberById(orgId)
  if (!access) return NextResponse.json({ error: 'Not authorized for this organization.' }, { status: 401 })

  const form = await req.formData()
  const file = form.get('file')
  const metaRaw = form.get('meta')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
  }

  let meta: SaveMeta
  try {
    meta = JSON.parse(String(metaRaw))
  } catch {
    return NextResponse.json({ error: 'Invalid metadata.' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const objectName = `exports/${access.orgId}/${slug(meta.brandName)}_${slug(meta.period)}_${Date.now()}.pptx`

  try {
    await uploadToGCS(buffer, objectName)
  } catch (e) {
    console.error('[reports/exports] GCS upload failed:', e)
    return NextResponse.json({ error: 'Storage upload failed.' }, { status: 502 })
  }

  // Generated identifier name: brand_month-year_N (N = next per org+brand+period).
  const month = meta.config?.month ?? slug(meta.period)
  const year = meta.config?.year ?? ''
  const n = await nextCoverSequence(access.orgId, meta.brandName, meta.period)
  const name = `${slug(meta.brandName)}_${slug(month)}-${year}_${n}`

  // Cover preview → Cloudinary (best-effort; the export still saves if Cloudinary
  // is unset or the upload fails — the card falls back to a live render).
  let coverImageUrl: string | null = null
  let coverPublicId: string | null = null
  const coverImage = form.get('coverImage')
  if (typeof coverImage === 'string' && coverImage && cloudinaryConfigured()) {
    try {
      const uploaded = await uploadCoverImage(coverImage, `reports/${access.orgId}/${name}`)
      coverImageUrl = uploaded.url
      coverPublicId = uploaded.publicId
    } catch (e) {
      console.error('[reports/exports] Cloudinary cover upload failed:', e)
    }
  }

  try {
    const id = await insertReportExport({
      organizationId: access.orgId,
      createdBy: access.userId,
      name,
      title: meta.title,
      brandName: meta.brandName,
      period: meta.period,
      slideCount: meta.slideCount,
      gcsObjectName: objectName,
      sizeBytes: buffer.length,
      config: meta.config,
      coverImageUrl,
      coverPublicId,
    })
    return NextResponse.json({ ok: true, id })
  } catch (e) {
    console.error('[reports/exports] DB insert failed:', e)
    return NextResponse.json({ error: 'Could not record export.' }, { status: 500 })
  }
}
