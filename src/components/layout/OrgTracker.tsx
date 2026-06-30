'use client'

import { useEffect } from 'react'
import { setLastOrgSlug } from '@/lib/organizations/actions'
import { useSetOrgRole } from './OrgContext'

export default function OrgTracker({ orgSlug, role }: { orgSlug: string; role: 'ADMIN' | 'MEMBER' }) {
  const setRole = useSetOrgRole()

  useEffect(() => { setLastOrgSlug(orgSlug) }, [orgSlug])
  useEffect(() => { setRole(role) }, [role, setRole])

  return null
}
