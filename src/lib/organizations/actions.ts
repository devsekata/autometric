'use server'

import { cookies } from 'next/headers'

export async function setLastOrgSlug(slug: string) {
  const cookieStore = await cookies()
  cookieStore.set('last_org_slug', slug, { path: '/', maxAge: 60 * 60 * 24 * 30 })
}
