'use client'

/**
 * Chat tab — the conversation attached to the deal.
 *
 * Attached to the deal, not to the creator: the point is that three months later
 * the offer, the terms, and the sentence "we can do 3 Reels if you drop the story"
 * are all in the same place. System lines are part of the same thread rather than
 * a separate audit log, because "who said what" and "what happened" are the same
 * story when you are reconstructing why a price moved.
 *
 * The creator side is simulated — there is no creator portal yet — so the
 * composer says whose voice it is writing in. A thread that silently invents
 * messages from the other party would make the record worse than having none.
 */

import { useEffect, useRef, useState } from 'react'
import { Btn, PJ } from './ui'
import { Note, Panel } from './negotiationUi'
import type { Negotiation } from '@/lib/discover/negotiation'
import type { NegotiationsApi } from './useNegotiations'

export default function NegotiationChat({
  deal, api,
}: { deal: Negotiation; api: NegotiationsApi }) {
  const [text, setText] = useState('')
  const [as, setAs] = useState<'brand' | 'creator'>('brand')
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [deal.chat.length])

  const send = () => {
    if (!text.trim()) return
    api.send(deal.id, as, text)
    setText('')
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.9fr_1fr] gap-4 items-start">
      <Panel title="Percakapan" sub={`${deal.chat.length} pesan · menempel pada ${deal.id}`}>
        <div className="flex flex-col gap-2.5 max-h-[460px] overflow-y-auto pr-1">
          {deal.chat.map((m, i) => {
            if (m.by === 'system') {
              return (
                <div key={i} className="flex items-start gap-2 py-1">
                  <span className="material-symbols-outlined text-[13px] text-[#A7C8D4] mt-0.5">info</span>
                  <div className="min-w-0">
                    <p className="text-[10.5px] text-[#6b7280] leading-relaxed italic">{m.text}</p>
                    <span className="text-[9.5px] text-[#9ca3af]">{m.at}</span>
                  </div>
                </div>
              )
            }
            const mine = m.by === 'brand'
            return (
              <div key={i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[76%] rounded-2xl px-3 py-2 ${
                  mine
                    ? 'bg-[#327488] text-white rounded-br-md'
                    : 'bg-[#f3f4f6] text-[#111827] rounded-bl-md'
                }`}>
                  <span style={PJ} className={`block text-[9.5px] font-bold uppercase tracking-wider mb-0.5 ${
                    mine ? 'text-white/70' : 'text-[#9ca3af]'
                  }`}>
                    {mine ? 'Brand' : deal.creatorName}
                  </span>
                  <p className="text-[11.5px] leading-relaxed whitespace-pre-wrap">{m.text}</p>
                  <span className={`block text-[9.5px] mt-1 ${mine ? 'text-white/60' : 'text-[#9ca3af]'}`}>
                    {m.at}
                  </span>
                </div>
              </div>
            )
          })}
          <div ref={endRef} />
        </div>

        <div className="mt-3 pt-3 border-t border-[#e5e7eb]">
          <div className="flex items-center gap-1.5 mb-2">
            {(['brand', 'creator'] as const).map(role => (
              <button
                key={role}
                type="button"
                onClick={() => setAs(role)}
                style={PJ}
                className={`inline-flex items-center rounded-full border px-2.5 h-6 text-[10px] font-bold transition-colors ${
                  as === role
                    ? 'bg-[#f0f7fa] border-[#327488] text-[#285D6E]'
                    : 'bg-white border-[#e5e7eb] text-[#9ca3af] hover:border-[#A7C8D4]'
                }`}
              >
                Tulis sebagai {role === 'brand' ? 'brand' : deal.creatorName}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <textarea
              value={text}
              rows={2}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                // Enter sends, Shift+Enter breaks the line — the convention
                // people already have from every other chat box.
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
              }}
              placeholder={`Pesan sebagai ${as === 'brand' ? 'brand' : deal.creatorName}…`}
              className="flex-1 px-2.5 py-2 rounded-lg border border-[#e5e7eb] text-[11.5px] text-[#374151] bg-white resize-none focus:outline-none focus:border-[#327488]"
            />
            <Btn variant="primary" disabled={!text.trim()} onClick={send}>
              <span className="material-symbols-outlined text-[15px]">send</span>
              Kirim
            </Btn>
          </div>
        </div>
      </Panel>

      <div className="flex flex-col gap-4">
        <Note tone="warn">
          <b>Belum ada portal creator.</b> Pesan dari sisi {deal.creatorName} ditulis dari sini
          juga, untuk menjalankan alurnya. Semua pesan tersimpan di browser ini saja.
        </Note>
        <Panel title="Ringkasan deal">
          <div className="flex flex-col gap-1.5 text-[11px]">
            <Line label="ID" value={deal.id} />
            <Line label="Creator" value={deal.creatorName} />
            <Line label="Platform" value={deal.platform} />
            <Line label="Versi offer" value={String(deal.offers.length)} />
          </div>
        </Panel>
      </div>
    </div>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[#6b7280]">{label}</span>
      <span style={PJ} className="font-bold text-[#111827]">{value}</span>
    </div>
  )
}
