import cloudinary from './client'

export async function uploadAvatarFromUrl(
  sourceUrl: string,
  publicId: string,
): Promise<string | null> {
  try {
    const result = await cloudinary.uploader.upload(sourceUrl, {
      folder:        'autometric/avatars',
      public_id:     publicId,
      overwrite:     true,
      resource_type: 'image',
    })
    return result.secure_url
  } catch (err) {
    console.error('[Cloudinary] avatar upload failed', err)
    return null
  }
}

