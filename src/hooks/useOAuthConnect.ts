'use client'

import { useState } from 'react'
import { Platform, SocialAccount } from '@/lib/brands/types'

export const CONNECT_OPTIONS = [
  { id: 'facebook',  platform: 'facebook'  as Platform, label: 'Facebook',                    method: 'facebook-page' },
  { id: 'ig-fb',     platform: 'instagram' as Platform, label: 'Instagram via Facebook login', method: 'facebook'      },
  { id: 'tiktok',    platform: 'tiktok'    as Platform, label: 'TikTok',                       method: 'tiktok'        },
]

export type ConnectOption = typeof CONNECT_OPTIONS[0]

export interface OAuthPayload {
  platform:       string
  platformUserId: string | null
  username:       string
  avatarUrl:      string | null
  profileUrl:     string
  oauthToken:     string
  refreshToken:   string | null
  tokenExpiresAt: string
}

export interface PendingConnection {
  payload: OAuthPayload
  method:  string
}

function buildOAuthUrl(method: string, brandId: string): string | null {
  if (method === 'instagram')     return `/api/auth/instagram?brandId=${brandId}`
  if (method === 'facebook')      return `/api/auth/facebook?brandId=${brandId}`
  if (method === 'facebook-page') return `/api/auth/facebook?brandId=${brandId}&mode=facebook`
  if (method === 'tiktok')        return `/api/auth/tiktok?brandId=${brandId}`
  return null
}

function openOAuthPopup(url: string, onPayload: (p: OAuthPayload) => void, onError: (msg: string) => void) {
  const w = 500, h = 680
  const left = Math.round(window.screenX + (window.outerWidth - w) / 2)
  const top  = Math.round(window.screenY + (window.outerHeight - h) / 2)
  const popup = window.open(url, 'social-oauth', `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`)

  function onMessage(event: MessageEvent) {
    if (event.data?.type === 'OAUTH_CONNECTED') { cleanup(); onPayload(event.data) }
    else if (event.data?.type === 'OAUTH_ERROR') { cleanup(); onError(event.data.error ?? 'Connection failed.') }
  }

  const timer = setInterval(() => { if (popup?.closed) cleanup() }, 500)
  function cleanup() { clearInterval(timer); window.removeEventListener('message', onMessage) }
  window.addEventListener('message', onMessage)
}

async function persistConnection(
  brandId: string,
  payload: OAuthPayload,
  skipInitialSync = false,
): Promise<{ account: SocialAccount; is_new: boolean } | null> {
  const res  = await fetch(`/api/brands/${brandId}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform:        payload.platform,
      platformUserId:  payload.platformUserId,
      username:        payload.username,
      avatarUrl:       payload.avatarUrl,
      profileUrl:      payload.profileUrl,
      oauthToken:      payload.oauthToken,
      refreshToken:    payload.refreshToken ?? null,
      tokenExpiresAt:  payload.tokenExpiresAt,
      skipInitialSync,
    }),
  })
  const json = await res.json()
  if (!res.ok) return null
  return { account: json.data as SocialAccount, is_new: json.is_new as boolean }
}

export function useOAuthConnect(brandId: string | null) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [pending, setPending] = useState<PendingConnection | null>(null)

  // Confirm mode (ConnectAccountModal): stores OAuth result in pending
  // Direct  mode (CreateBrandModal wizard): saves immediately and calls onDirectSave
  function connect(method: string, onDirectSave?: (account: SocialAccount) => void) {
    if (!brandId) return
    const url = buildOAuthUrl(method, brandId)
    if (!url) return
    setError('')

    openOAuthPopup(
      url,
      async (payload) => {
        if (onDirectSave) {
          setLoading(true)
          try {
            const result = await persistConnection(brandId, payload)
            if (!result) { setError('Failed to connect account.'); return }
            onDirectSave(result.account)
          } catch {
            setError('Failed to connect account.')
          } finally {
            setLoading(false)
          }
        } else {
          setPending({ payload, method })
        }
      },
      (msg) => setError(msg),
    )
  }

  function reset() {
    setPending(null)
    setError('')
  }

  async function save(onSaved: (account: SocialAccount, is_new: boolean) => void, options?: { skipInitialSync?: boolean }) {
    if (!brandId || !pending) return
    setLoading(true); setError('')
    try {
      const result = await persistConnection(brandId, pending.payload, options?.skipInitialSync ?? false)
      if (!result) { setError('Failed to connect account.'); return }
      onSaved(result.account, result.is_new)
    } catch {
      setError('Failed to connect account.')
    } finally {
      setLoading(false)
    }
  }

  return { loading, error, pending, connect, reset, save, clearError: () => setError('') }
}
