'use client'

import { Btn, PJ } from './ui'

/**
 * What a Discover screen shows when its data still lives on the analytics
 * warehouse. The KOL product reads the KOL database only, so such a feature is
 * switched off with this notice instead of reaching for warehouse data or
 * showing something made up.
 */
export default function FeatureUnavailable({
  title, body, actionLabel, onAction,
}: {
  title: string
  body?: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div role="status"
      className="flex flex-col items-center justify-center text-center py-16 px-6 rounded-2xl border bg-white"
      style={{ borderColor: '#e3e8ee' }}>
      <span className="material-symbols-outlined text-[30px]" style={{ color: '#9aa8b6' }}>block</span>
      <h3 style={PJ} className="text-[15px] font-extrabold mt-2 text-[#1f2d3a]">
        {title} sementara tidak tersedia
      </h3>
      <p className="text-[12.5px] mt-1.5 max-w-[46ch] text-[#6b7a88]">
        {body ?? 'Fitur ini masih bergantung pada data di luar database KOL, jadi dinonaktifkan dulu sampai datanya tersedia di KOL.'}
      </p>
      {actionLabel && onAction && (
        <div className="mt-4">
          <Btn variant="secondary" size="sm" onClick={onAction}>{actionLabel}</Btn>
        </div>
      )}
    </div>
  )
}
