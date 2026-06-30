// Google Cloud Storage helpers for report (.pptx) exports.
//
// Server-only. Credentials come from a service-account JSON in
// GOOGLE_SERVICE_ACCOUNT_KEY (the full JSON as a string) and the bucket name
// from GCS_BUCKET_NAME.
import { Storage } from '@google-cloud/storage'

const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'

let cached: Storage | null = null

function getStorage(): Storage {
  if (cached) return cached
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not set')
  const credentials = JSON.parse(raw)
  cached = new Storage({ credentials, projectId: credentials.project_id })
  return cached
}

function getBucket() {
  const bucketName = process.env.GCS_BUCKET_NAME
  if (!bucketName) throw new Error('GCS_BUCKET_NAME is not set')
  return getStorage().bucket(bucketName)
}

/** Uploads a PPTX buffer to GCS at the given object path. */
export async function uploadToGCS(buffer: Buffer, objectName: string): Promise<void> {
  await getBucket().file(objectName).save(buffer, {
    contentType: PPTX_MIME,
    resumable: false,
  })
}

/** Downloads a GCS object as a Buffer. */
export async function downloadFromGCS(objectName: string): Promise<Buffer> {
  const [buffer] = await getBucket().file(objectName).download()
  return buffer
}

/** Deletes a GCS object (ignores "not found"). */
export async function deleteFromGCS(objectName: string): Promise<void> {
  try {
    await getBucket().file(objectName).delete()
  } catch {
    // ignore — object may already be gone
  }
}
