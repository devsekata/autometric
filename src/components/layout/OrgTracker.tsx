'use client'

import { useEffect } from 'react'
import { setLastOrgSlug } from '@/lib/organizations/actions'

export default function OrgTracker({ orgSlug }: { orgSlug: string }) {
  useEffect(() => {
    setLastOrgSlug(orgSlug)
  }, [orgSlug])

  return null
}
