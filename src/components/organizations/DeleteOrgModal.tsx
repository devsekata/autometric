'use client'

interface Props {
  orgId: string
  orgName: string
  onClose: () => void
  onDeleted: (id: string) => void
}

export default function DeleteOrgModal({ orgId, orgName, onClose, onDeleted }: Props) {
  function handleDelete() {
    onDeleted(orgId)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />
      <div className="relative bg-white rounded-lg w-full max-w-[420px] mx-4 shadow-xl shadow-black/5 border border-[#e5e7eb]">
        <div className="px-6 pt-5 pb-4">
          <h2 className="text-[15px] font-semibold text-[#111827]">Delete Organization</h2>
          <p className="text-[13px] text-[#6b7280] mt-1.5 leading-relaxed">
            Are you sure you want to delete{' '}
            <span className="font-semibold text-[#111827]">{orgName}</span>? All brands,
            members, and data inside will be permanently removed. This cannot be undone.
          </p>
        </div>

        <div className="border-t border-[#f3f4f6]" />

        <div className="px-6 py-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-3.5 text-[13px] font-medium text-[#6b7280] hover:text-[#111827] hover:bg-[#f9fafb] rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            className="h-8 px-3.5 bg-red-500 hover:bg-red-600 text-white text-[13px] font-medium rounded-md transition-colors"
          >
            Delete Organization
          </button>
        </div>
      </div>
    </div>
  )
}
