// Client-side helpers: trigger a local download of a generated blob, and upload
// it (plus metadata) to the org's report library through our server route.
import type { ReportExportConfig } from '../queries'

/** Triggers a browser download of a blob. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export interface SaveExportMeta {
  title: string
  brandName: string
  period: string
  slideCount: number
  config: ReportExportConfig
  /** Optional cover-preview image as a PNG data URI (uploaded to Cloudinary). */
  coverImage?: string | null
}

export interface SaveExportResult {
  ok: boolean
  error?: string
}

/** Uploads a generated .pptx + metadata to the org's report library. */
export async function saveExportToLibrary(
  orgId: string,
  blob: Blob,
  fileName: string,
  meta: SaveExportMeta,
): Promise<SaveExportResult> {
  const { coverImage, ...metaRest } = meta
  const form = new FormData()
  form.append('file', blob, fileName)
  form.append('meta', JSON.stringify(metaRest))
  if (coverImage) form.append('coverImage', coverImage)

  let res: Response
  try {
    res = await fetch(`/api/organizations/${encodeURIComponent(orgId)}/reports/exports`, {
      method: 'POST',
      body: form,
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' }
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    return { ok: false, error: data?.error ?? `Save failed (${res.status})` }
  }
  return { ok: true }
}
