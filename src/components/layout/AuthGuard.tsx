'use client'

import { useSession } from 'next-auth/react'
import { useEffect } from 'react'

export default function AuthGuard() {
  const { status } = useSession()

  useEffect(() => {
    if (status === 'unauthenticated') {
      window.location.replace('/login')
    }
  }, [status])

  return null
}
