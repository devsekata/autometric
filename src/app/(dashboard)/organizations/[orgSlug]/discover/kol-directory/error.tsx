'use client'

/**
 * Error boundary for the KOL Directory route.
 *
 * Without one, a throw during client render unmounts the tree and leaves a
 * blank white page — the server HTML is already correct at that point, so there
 * is nothing on screen and nothing in the response to explain it. This turns
 * that into the actual message, which is the difference between "it's broken"
 * and knowing which row or which field broke it.
 */

import { useEffect } from 'react'

export default function KolDirectoryError({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[kol-directory] render error', error)
  }, [error])

  return (
    <div className="min-h-full flex flex-col items-center justify-center text-center px-5 py-20"
      style={{ background: '#f9fafb' }}>
      <span className="material-symbols-outlined text-[44px]" style={{ color: '#e6b8b8' }}>error</span>
      <h4 className="text-[15px] font-extrabold mt-2.5"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: '#111827' }}>
        KOL Directory gagal ditampilkan
      </h4>
      <p className="text-[12.5px] mt-1.5 max-w-[560px] leading-[1.5] break-words" style={{ color: '#6b7280' }}>
        {error.message || 'Unknown error'}
      </p>
      {error.digest && (
        <p className="text-[11px] mt-1" style={{ color: '#9ca3af' }}>digest: {error.digest}</p>
      )}
      <button type="button" onClick={reset}
        className="mt-4 h-9 px-3.5 rounded-[11px] text-white text-[12.5px] font-bold"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", background: 'linear-gradient(135deg,#4E96AC,#327488)' }}>
        Coba lagi
      </button>
    </div>
  )
}
