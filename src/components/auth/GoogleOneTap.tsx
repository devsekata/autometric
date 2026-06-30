'use client'

import { useEffect } from 'react'
import { signIn } from 'next-auth/react'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: object) => void
          prompt: () => void
          cancel: () => void
        }
      }
    }
  }
}

export default function GoogleOneTap() {
  useEffect(() => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true

    script.onload = () => {
      window.google?.accounts.id.initialize({
        client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
        callback: async ({ credential }: { credential: string }) => {
          await signIn('google-one-tap', {
            idToken: credential,
            callbackUrl: '/',
          })
        },
        cancel_on_tap_outside: false,
        use_fedcm_for_prompt: false,
      })
      window.google?.accounts.id.prompt()
    }

    document.head.appendChild(script)

    return () => {
      window.google?.accounts.id.cancel()
      if (document.head.contains(script)) document.head.removeChild(script)
    }
  }, [])

  return null
}
