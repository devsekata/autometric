// Cloudinary helpers for report cover-preview images.
//
// Server-only. Env: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.
import { v2 as cloudinary } from 'cloudinary'

let configured = false
function configure() {
  if (configured) return
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  })
  configured = true
}

export function cloudinaryConfigured(): boolean {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET,
  )
}

/** Uploads a base64 data URI image under the given public id. */
export async function uploadCoverImage(
  dataUri: string,
  publicId: string,
): Promise<{ url: string; publicId: string }> {
  configure()
  const res = await cloudinary.uploader.upload(dataUri, {
    public_id: publicId,
    overwrite: true,
    resource_type: 'image',
  })
  return { url: res.secure_url, publicId: res.public_id }
}

/** Deletes a cover image (ignores errors). */
export async function deleteCoverImage(publicId: string): Promise<void> {
  configure()
  try {
    await cloudinary.uploader.destroy(publicId)
  } catch {
    // ignore — image may already be gone
  }
}
