'use client'

import { useCallback, useEffect, useState } from 'react'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

export type ToastKind = 'success' | 'error' | 'info'
export interface ToastState { kind: ToastKind; message: string; id: number }

/** Lightweight in-app toast (replaces browser alert()). */
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null)
  const showToast = useCallback((kind: ToastKind, message: string) => setToast({ kind, message, id: Date.now() }), [])
  const clearToast = useCallback(() => setToast(null), [])
  return { toast, showToast, clearToast }
}

const STYLES: Record<ToastKind, { icon: string; ring: string; color: string }> = {
  success: { icon: 'check_circle', ring: 'border-[#cfe8df]', color: '#2f9e6f' },
  error:   { icon: 'error',        ring: 'border-[#f6d5d0]', color: '#d9534f' },
  info:    { icon: 'info',         ring: 'border-[#d6e4ea]', color: '#285D6E' },
}

export function ToastHost({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(onClose, toast.kind === 'error' ? 6000 : 3800)
    return () => clearTimeout(t)
  }, [toast?.id, toast?.kind, onClose])

  if (!toast) return null
  const s = STYLES[toast.kind]
  return (
    <div className="fixed bottom-5 right-5 z-[100] pointer-events-none">
      <div role="status" aria-live="polite" style={{ ...PJ, transition: 'opacity .18s ease-out' }}
        className={`pointer-events-auto flex items-start gap-2.5 w-[360px] max-w-[calc(100vw-2.5rem)] bg-white border ${s.ring} rounded-xl shadow-lg shadow-black/[0.10] px-4 py-3`}>
        <span className="material-symbols-outlined text-[20px] flex-shrink-0 mt-[1px]" style={{ color: s.color }}>{s.icon}</span>
        <p className="text-[13px] leading-snug text-[#1f2937] whitespace-pre-line flex-1 min-w-0">{toast.message}</p>
        <button onClick={onClose} aria-label="Tutup"
          className="material-symbols-outlined text-[16px] text-[#9ca3af] hover:text-[#374151] flex-shrink-0 -mr-1 -mt-0.5">close</button>
      </div>
    </div>
  )
}
