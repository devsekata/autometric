interface Props {
  onNew: () => void
}

export default function EmptyState({ onNew }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-28 px-8">
      <div className="w-9 h-9 rounded-lg bg-[#edf5f8] flex items-center justify-center mb-4">
        <span className="material-symbols-outlined text-[20px] text-[#3d7e96]">corporate_fare</span>
      </div>
      <p className="text-[15px] font-semibold text-[#111827] mb-1">No organizations yet</p>
      <p className="text-[13px] text-[#9ca3af] mb-6 text-center max-w-[260px] leading-relaxed">
        Create your first organization to start tracking brands and competitors.
      </p>
      <button
        onClick={onNew}
        className="h-9 px-4 bg-[#3d7e96] hover:bg-[#2d6e85] text-white text-[13px] font-medium rounded-md transition-colors"
      >
        New Organization
      </button>
    </div>
  )
}
