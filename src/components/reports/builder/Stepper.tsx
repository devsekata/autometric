'use client'

import { PJ } from './ui'

export type Step = 'setup' | 'cover' | 'slides' | 'editSlide'

export default function Stepper({ step }: { step: Step }) {
  const order: Step[] = ['setup', 'cover', 'slides']
  const steps: { id: Step; label: string }[] = [
    { id: 'setup', label: 'Setup' },
    { id: 'cover', label: 'Cover' },
    { id: 'slides', label: 'Slides' },
  ]
  // editSlide is a sub-state of slides for stepper purposes
  const currentIndex = order.indexOf(step === 'editSlide' ? 'slides' : step)
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => {
        const active = i === currentIndex
        const done = i < currentIndex
        return (
          <div key={s.id} className="flex items-center gap-2">
            <span
              style={PJ}
              className={`flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors ${
                active ? 'bg-[#1e4f49] text-white' : done ? 'bg-[#e6f0ee] text-[#1e4f49]' : 'bg-[#f3f4f6] text-[#9ca3af]'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-white/25 flex items-center justify-center text-[10px]">{i + 1}</span>
              {s.label}
            </span>
            {i < steps.length - 1 && <span className="material-symbols-outlined text-[18px] text-[#d1d5db]">chevron_right</span>}
          </div>
        )
      })}
    </div>
  )
}
