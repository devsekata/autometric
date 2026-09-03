'use client'

/**
 * "Viewing as" — the screen between signing in and entering the product.
 *
 * This is where the role is chosen, and the only place it can be. There is no
 * switcher in the sidebar: the mode is settled before the application opens, and
 * changing it means signing out and choosing again. That keeps one question in
 * one place rather than two controls that can disagree.
 *
 * Two cards, one explicit choice, nothing preselected. Preselecting Admin would
 * make the screen a formality people click through; preselecting Member would
 * quietly downgrade an administrator. Continue stays disabled until a card is
 * picked, which is the only thing that makes the question real.
 *
 * The cards say what each mode *does* rather than naming it and leaving the
 * reader to guess — the difference between "Admin" and "Member" is not
 * self-evident to someone seeing it for the first time, and this is the one
 * screen where explaining it costs nothing.
 *
 * Which cards appear is decided on the server from the account's memberships,
 * and the choice is validated there again. This component only collects it.
 */

import { useState, useTransition } from 'react'
import type { OrgRole } from '@/lib/organizations/viewRole'

const PJ = { fontFamily: "'Plus Jakarta Sans', sans-serif" } as const

const MODES: {
  id: OrgRole
  title: string
  tagline: string
  description: string
  icon: string
  bullets: string[]
}[] = [
  {
    id: 'ADMIN',
    title: 'Admin',
    tagline: 'Kelola, setujui, dan bayar',
    description: 'Manage workspace configuration, ordering, payments, and administrative features.',
    icon: 'shield_person',
    bullets: ['Ordering & pembayaran', 'Workspace settings', 'Seluruh modul Member'],
  },
  {
    id: 'MEMBER',
    title: 'Member',
    tagline: 'Cari, analisis, dan jalankan',
    description: 'Discover creators, compare KOLs, analyze content, and work with campaigns.',
    icon: 'person',
    bullets: ['Discover & Compare KOL', 'Negotiation & Reports', 'Campaign, Content & Audience'],
  },
]

export default function WorkspaceModeChooser({
  userName, available, onChoose,
}: {
  userName: string | null
  /** The modes this account may use, decided on the server. */
  available: OrgRole[]
  /** Records the choice and navigates on. Server action. */
  onChoose: (mode: OrgRole) => Promise<void>
}) {
  const [picked, setPicked] = useState<OrgRole | null>(null)
  const [pending, startTransition] = useTransition()

  const cards = MODES.filter(m => available.includes(m.id))
  const onlyOne = cards.length === 1

  const submit = (mode: OrgRole | null) => {
    if (!mode || pending) return
    startTransition(() => { void onChoose(mode) })
  }

  return (
    <div className="min-h-screen bg-[#f9fafb] flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-[720px]">
        <div className="text-center mb-7">
          {/* The screen is named by the thing it decides, in the sidebar's own
              small-caps label style — so "Viewing as" reads as one idea that
              moved here, not as a new concept. */}
          <span style={PJ}
            className="block text-[11px] font-bold uppercase tracking-[0.18em] text-[#b6bcc6]">
            Viewing as
          </span>
          <h1 style={PJ}
            className="text-[24px] font-extrabold text-[#111827] tracking-[-0.03em] mt-2">
            How do you want to access this workspace?
          </h1>
          {userName && (
            <p className="text-[13px] text-[#6b7280] mt-1.5">
              Masuk sebagai <span className="font-semibold text-[#374151]">{userName}</span>
            </p>
          )}
        </div>

        <div className={`grid gap-3.5 ${onlyOne ? 'grid-cols-1 max-w-[380px] mx-auto' : 'grid-cols-1 sm:grid-cols-2'}`}>
          {cards.map(m => {
            const on = picked === m.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setPicked(m.id)}
                onDoubleClick={() => submit(m.id)}
                aria-pressed={on}
                className={`text-left rounded-2xl border-2 bg-white p-5 transition-all ${
                  on
                    ? 'border-[#327488] shadow-[0_12px_32px_rgba(40,93,110,.14)]'
                    : 'border-[#e5e7eb] hover:border-[#A7C8D4] hover:shadow-[0_1px_2px_rgba(17,24,39,.05),0_4px_14px_rgba(17,24,39,.05)]'
                }`}
              >
                <div className="flex items-center gap-2.5 mb-2.5">
                  <span className={`w-10 h-10 rounded-xl inline-flex items-center justify-center flex-shrink-0 ${
                    on ? 'bg-[#f0f7fa]' : 'bg-[#f3f4f6]'
                  }`}>
                    <span className={`material-symbols-outlined text-[22px] ${
                      on ? 'text-[#285D6E]' : 'text-[#9ca3af]'
                    }`}>
                      {m.icon}
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <span style={PJ} className="block text-[15px] font-extrabold text-[#111827]">
                      {m.title}
                    </span>
                    <span className="block text-[11px] text-[#9ca3af]">{m.tagline}</span>
                  </div>
                  {/* The selected state has to be unmistakable — this is the one
                      control on the screen and Continue depends on it. */}
                  <span className={`material-symbols-outlined text-[20px] flex-shrink-0 ${
                    on ? 'text-[#327488]' : 'text-[#d1d5db]'
                  }`}>
                    {on ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                </div>

                <p className="text-[12px] text-[#6b7280] leading-relaxed">{m.description}</p>

                <ul className="mt-3 flex flex-col gap-1.5">
                  {m.bullets.map(b => (
                    <li key={b} className="flex items-start gap-1.5 text-[11.5px] text-[#374151]">
                      <span className={`material-symbols-outlined text-[14px] mt-px ${
                        on ? 'text-[#4E96AC]' : 'text-[#c8ced6]'
                      }`}>
                        check
                      </span>
                      {b}
                    </li>
                  ))}
                </ul>
              </button>
            )
          })}
        </div>

        <div className="mt-6 flex flex-col items-center gap-2.5">
          <button
            type="button"
            disabled={!picked || pending}
            onClick={() => submit(picked)}
            style={PJ}
            className={`inline-flex items-center justify-center gap-1.5 h-11 px-7 rounded-xl text-[13.5px] font-bold transition-colors ${
              picked && !pending
                ? 'bg-[#327488] text-white hover:bg-[#285D6E] cursor-pointer'
                : 'bg-[#e5e7eb] text-[#9ca3af] cursor-not-allowed'
            }`}
          >
            {pending
              ? 'Membuka workspace…'
              : picked
                ? `Continue as ${picked === 'ADMIN' ? 'Admin' : 'Member'}`
                : 'Continue'}
          </button>

          <p className="text-[11px] text-[#9ca3af] text-center max-w-[46ch] leading-relaxed">
            {onlyOne
              ? 'Akun ini terdaftar sebagai Member di workspace-nya. Pilihan Admin muncul di sini kalau kamu jadi admin di salah satu workspace.'
              : 'Untuk mengganti mode, keluar lalu masuk lagi dan pilih yang lain. Akses tetap mengikuti izin akunmu di tiap workspace.'}
          </p>
        </div>
      </div>
    </div>
  )
}
