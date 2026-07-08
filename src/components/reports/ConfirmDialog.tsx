'use client'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

/** In-app confirmation dialog (replaces browser confirm()). */
export default function ConfirmDialog({
  open, title, message, confirmLabel = 'Delete', cancelLabel = 'Cancel', danger = true, busy = false, onConfirm, onCancel,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && onCancel()}>
      <div style={PJ} onClick={e => e.stopPropagation()}
        className="w-full max-w-[400px] bg-white rounded-2xl shadow-xl shadow-black/20 p-5">
        <h3 className="text-[15px] font-bold text-[#111827] tracking-[-0.01em]">{title}</h3>
        <p className="text-[13px] text-[#6b7280] mt-1.5 leading-relaxed whitespace-pre-line">{message}</p>
        <div className="flex items-center justify-end gap-2 mt-5">
          <button type="button" onClick={onCancel} disabled={busy}
            className="h-9 px-4 text-[13px] font-semibold text-[#6b7280] bg-white border border-[#e5e7eb] rounded-lg hover:border-[#d1d5db] disabled:opacity-40 transition-colors">
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}
            className={`h-9 px-4 text-[13px] font-bold text-white rounded-lg transition-colors disabled:opacity-60 ${
              danger ? 'bg-[#dc2626] hover:bg-[#b91c1c]' : 'bg-[#1e4f49] hover:bg-[#163a35]'
            }`}>
            {busy ? 'Menghapus…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
