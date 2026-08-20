'use client'

/**
 * Offer tab — composing an offer, and everything that happens to it after.
 *
 * The deliverable mix and the price are one screen on purpose: in the source
 * platform they were the same argument, and separating them produced offers
 * whose number nobody could account for. The rate-card total sits next to the
 * field you type into, so the gap between list price and what you are asking is
 * always visible while you are asking it.
 *
 * Offer tracking is a real state machine (`draft → sent → delivered → viewed →
 * accepted | counter | rejected | expired`), and every version is kept with the
 * terms as they stood when it went out. That history is why a counter three
 * rounds in can still be read: the number alone never explains itself.
 *
 * Because no creator is on the other end of this yet, the states that only a
 * counterparty can cause are reachable through clearly-labelled simulation
 * controls. They are marked as simulation everywhere they appear — an offer that
 * says "viewed" when nobody viewed it is worse than no tracking at all.
 */

import { useMemo, useState } from 'react'
import { Btn, PJ, fmtNum } from './ui'
import {
  Collapsible, FieldLabel, MoneyField, MoneyRow, Note, Panel, StatusPill, StepRail,
  TextField,
} from './negotiationUi'
import {
  OFFER_STATE_LABEL, deliverableSummary, idr, isNegotiable, listPriceOf, totalUnits,
  type Negotiation, type StageTone,
} from '@/lib/discover/negotiation'
import type { Deliverable, RateCard } from '@/lib/discover/vocab'
import type { NegotiationsApi } from './useNegotiations'

export default function NegotiationOffer({
  deal, api, catalogue, rate,
}: {
  deal: Negotiation
  api: NegotiationsApi
  catalogue: Deliverable[]
  rate: RateCard | null
}) {
  const [price, setPrice] = useState(deal.draft.price)
  const [note, setNote] = useState(deal.draft.note)
  const [counterPrice, setCounterPrice] = useState('')
  const [counterNote, setCounterNote] = useState('')

  const platformDelivs = useMemo(
    () => catalogue.filter(d => d.platform === deal.platform),
    [catalogue, deal.platform],
  )
  const listPrice = listPriceOf(deal.selection, rate, catalogue)
  const last = deal.offers[deal.offers.length - 1]
  const editable = isNegotiable(deal)

  /** An answered offer should not look like one still waiting. */
  const offerTone: StageTone =
    deal.offerState === 'accepted' ? 'good'
    : deal.offerState === 'rejected' || deal.offerState === 'expired' ? 'bad'
    : deal.offerState === 'counter' ? 'live'
    : 'neutral'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.9fr_1fr] gap-4 items-start">
      <div className="flex flex-col gap-4">
        {deal.stage !== 'draft' && <OfferTracking deal={deal} api={api} />}

        {deal.stage === 'draft' ? (
          <Panel
            title={deal.offers.length ? `Draft offer v${deal.offers.length + 1}` : 'Susun offer pertama'}
            sub="Rate card adalah titik awal, bukan harga final. Yang dikirim adalah nominal di bawah."
          >
            <div className="flex flex-col gap-3.5">
              <div>
                <FieldLabel>Deliverable</FieldLabel>
                {platformDelivs.length === 0 ? (
                  <Note tone="warn">
                    Belum ada deliverable untuk platform <b>{deal.platform}</b> di katalog.
                  </Note>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {platformDelivs.map(d => {
                      const qty = deal.selection[d.id] ?? 0
                      const unit = rate?.baseRate ? listPriceOf({ [d.id]: 1 }, rate, catalogue) : 0
                      return (
                        <div key={d.id}
                          className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 ${
                            qty > 0 ? 'border-[#A7C8D4] bg-[#f0f7fa]' : 'border-[#e5e7eb] bg-white'
                          }`}>
                          <span className="material-symbols-outlined text-[17px] text-[#6b7280]">{d.icon}</span>
                          <div className="flex-1 min-w-0">
                            <span style={PJ} className="block text-[12px] font-bold text-[#111827] truncate">{d.label}</span>
                            <span className="block text-[10px] text-[#9ca3af] tabular-nums">
                              {unit > 0 ? `${idr(unit)} / unit` : 'Rate card belum diisi'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <StepBtn icon="remove" disabled={qty <= 0}
                              onClick={() => api.setQty(deal.id, d.id, qty - 1)} label={`Kurangi ${d.label}`} />
                            <span style={PJ} className="w-6 text-center text-[12px] font-extrabold tabular-nums text-[#111827]">
                              {qty}
                            </span>
                            <StepBtn icon="add"
                              onClick={() => api.setQty(deal.id, d.id, qty + 1)} label={`Tambah ${d.label}`} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2.5">
                <MoneyRow label="Total rate card" amount={listPrice}
                  note={totalUnits(deal.selection) ? deliverableSummary(deal.selection, catalogue) : 'Belum ada deliverable dipilih'} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,220px)_1fr] gap-3">
                <div>
                  <FieldLabel>Nominal offer</FieldLabel>
                  <MoneyField value={price} onChange={setPrice} placeholder="0" />
                  {!!listPrice && !!price && (
                    <Delta offer={Number(price)} list={listPrice} />
                  )}
                </div>
                <div>
                  <FieldLabel>Catatan untuk creator</FieldLabel>
                  <TextField value={note} onChange={setNote}
                    placeholder="Alasan angka ini, ekspektasi, atau ruang negosiasi yang tersedia." />
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Btn variant="primary"
                  disabled={!totalUnits(deal.selection) || !Number(price)}
                  onClick={() => {
                    if (api.sendOffer(deal.id, Number(price), note, catalogue)) {
                      setPrice(''); setNote('')
                    }
                  }}>
                  <span className="material-symbols-outlined text-[15px]">send</span>
                  Kirim offer
                </Btn>
                <Btn variant="secondary" onClick={() => {
                  api.saveDraft(deal.id, { price, note })
                }}>
                  <span className="material-symbols-outlined text-[15px]">save</span>
                  Simpan draft
                </Btn>
                {!deal.offers.length && (
                  <Btn variant="ghost" onClick={() => api.remove(deal.id)}>
                    <span className="material-symbols-outlined text-[15px]">delete</span>
                    Buang draft
                  </Btn>
                )}
              </div>
            </div>
          </Panel>
        ) : (
          <Panel
            title={`Offer v${last?.v ?? 1} · ${idr(last?.amount ?? 0)}`}
            sub={last ? `Dikirim ${last.by === 'brand' ? 'brand' : deal.creatorName} · ${last.at}` : undefined}
            action={<StatusPill label={OFFER_STATE_LABEL[deal.offerState]} tone={offerTone} />}
          >
            <div className="flex flex-col gap-3">
              <MoneyRow label="Total rate card" amount={deal.listPrice || listPrice} strike />
              <MoneyRow label={`Nominal ditawarkan${last?.by === 'creator' ? ' (counter creator)' : ''}`}
                amount={last?.amount ?? 0} tone="good" strong />
              {last?.note && (
                <div className="rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2">
                  <FieldLabel>Catatan</FieldLabel>
                  <p className="text-[11.5px] text-[#374151] leading-relaxed">{last.note}</p>
                </div>
              )}
              <div className="text-[10.5px] text-[#9ca3af]">
                {deliverableSummary(deal.selection, catalogue)}
              </div>
            </div>
          </Panel>
        )}

        {deal.stage === 'negotiation' && (
            <Panel title="Jawab counter / ajukan angka baru"
              sub="Setiap versi tersimpan — angka yang berubah tetap bisa ditelusuri.">
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,220px)_1fr] gap-3 mb-3">
              <div>
                <FieldLabel>Counter dari brand</FieldLabel>
                <MoneyField value={counterPrice} onChange={setCounterPrice} placeholder="0" />
              </div>
              <div>
                <FieldLabel>Catatan</FieldLabel>
                <TextField value={counterNote} onChange={setCounterNote} rows={1}
                  placeholder="Kenapa angka ini yang diajukan." />
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Btn variant="primary" disabled={!Number(counterPrice)}
                onClick={() => {
                  if (api.counter(deal.id, 'brand', Number(counterPrice), counterNote)) {
                    setCounterPrice(''); setCounterNote('')
                  }
                }}>
                <span className="material-symbols-outlined text-[15px]">swap_horiz</span>
                Kirim counter
              </Btn>
              {last?.by === 'creator' && (
                <Btn variant="secondary" onClick={() => api.creatorAccept(deal.id)}>
                  <span className="material-symbols-outlined text-[15px]">handshake</span>
                  Terima {idr(last.amount)}
                </Btn>
              )}
              {!deal.offers.some(o => o.by === 'creator') && (
                <Btn variant="ghost" onClick={() => api.withdrawOffer(deal.id)}
                  title="Tarik kembali offer terakhir selama creator belum menjawab">
                  <span className="material-symbols-outlined text-[15px]">undo</span>
                  Tarik offer
                </Btn>
              )}
              <Btn variant="ghost" onClick={() => api.newOfferDraft(deal.id)}>
                <span className="material-symbols-outlined text-[15px]">edit_note</span>
                Draft offer baru
              </Btn>
            </div>

          </Panel>
        )}

        {deal.stage === 'negotiation' && (
          <Collapsible title="Simulasi jawaban creator" icon="science">
            <p className="text-[10.5px] text-[#9ca3af] leading-relaxed mb-2.5">
              Belum ada inbox creator di sisi ini, jadi jawaban dari seberang dijalankan manual.
              Tombol ini menandai apa yang <i>seolah</i> dilakukan creator — bukan data dari
              orang sungguhan.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <Btn size="sm" variant="secondary" onClick={() => api.markViewed(deal.id)}>
                Ditandai dibuka
              </Btn>
              <Btn size="sm" variant="secondary"
                onClick={() => api.counter(deal.id, 'creator', Math.round((last?.amount ?? 0) * 1.15), 'Counter dari creator (simulasi)')}>
                Creator counter +15%
              </Btn>
              <Btn size="sm" variant="secondary" onClick={() => api.creatorAccept(deal.id)}>
                Creator terima
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => api.creatorReject(deal.id)}>
                Creator tolak
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => api.expireOffer(deal.id)}>
                Kedaluwarsa
              </Btn>
            </div>
          </Collapsible>
        )}

        {(deal.stage === 'rejected' || deal.stage === 'closed') && (
          <Panel
            title={deal.stage === 'rejected' ? 'Offer ditolak' : 'Negosiasi ditutup'}
            sub={deal.closeReason ?? undefined}
          >
            <div className="flex flex-col gap-3">
              <MoneyRow label="Offer pertama" amount={deal.offers[0]?.amount ?? 0} />
              <MoneyRow label="Offer terakhir brand"
                amount={[...deal.offers].reverse().find(o => o.by === 'brand')?.amount ?? 0} />
              <MoneyRow label="Counter terakhir creator"
                amount={[...deal.offers].reverse().find(o => o.by === 'creator')?.amount ?? 0} />
              <div className="flex items-center gap-2 flex-wrap">
                <Btn variant="secondary" onClick={() => api.reopen(deal.id)}>
                  <span className="material-symbols-outlined text-[15px]">restart_alt</span>
                  Buka kembali
                </Btn>
              </div>
            </div>
          </Panel>
        )}
      </div>

      <div className="flex flex-col gap-4">
          <Panel title="Riwayat versi" sub={`${deal.offers.length} versi`}>
          {deal.offers.length === 0 ? (
            <p className="text-[11px] text-[#9ca3af]">Belum ada offer terkirim.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {[...deal.offers].reverse().map(o => (
                <div key={o.v} className="rounded-xl border border-[#e5e7eb] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span style={PJ} className="text-[11px] font-extrabold text-[#111827]">
                      v{o.v} · {o.by === 'brand' ? 'Brand' : deal.creatorName}
                    </span>
                    <span style={PJ} className="text-[11.5px] font-extrabold tabular-nums text-[#285D6E]">
                      {idr(o.amount)}
                    </span>
                  </div>
                  <p className="text-[10.5px] text-[#6b7280] mt-1 leading-relaxed">{o.note}</p>
                  <div className="flex items-center gap-2 mt-1.5 text-[9.5px] text-[#9ca3af] tabular-nums">
                    <span>{o.at}</span>
                    <span>·</span>
                    <span>Guaranteed {idr(o.snapshot.guaranteed)}</span>
                    <span>·</span>
                    <span>Performance {idr(o.snapshot.performance)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

          <Panel title="Target KPI yang menyertai offer"
            sub="Ikut terbawa di setiap versi — angka inilah yang nanti dinilai.">
          <div className="flex flex-col gap-1.5">
            <MoneyRow label="Reach" amount={fmtNum(deal.terms.targets.reach)} />
            <MoneyRow label="Engagement" amount={fmtNum(deal.terms.targets.engagement)} />
            <MoneyRow label="Likes" amount={fmtNum(deal.terms.kpi.likes)} />
            <MoneyRow label="Komentar" amount={fmtNum(deal.terms.kpi.comments)} />
            <MoneyRow label="Views" amount={fmtNum(deal.terms.kpi.views)} />
          </div>
          {editable && (
            <p className="text-[10px] text-[#9ca3af] mt-2">
              Target diedit di tab Agreement, dan perubahan ikut ke versi offer berikutnya.
            </p>
          )}
        </Panel>
      </div>
    </div>
  )
}

function StepBtn({
  icon, onClick, disabled, label,
}: { icon: string; onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="w-6 h-6 inline-flex items-center justify-center rounded-md border border-[#e5e7eb] bg-white text-[#6b7280] hover:border-[#A7C8D4] hover:text-[#285D6E] disabled:opacity-40 disabled:cursor-not-allowed">
      <span className="material-symbols-outlined text-[14px]">{icon}</span>
    </button>
  )
}

/** How far the asking price sits from the rate card, stated as both. */
function Delta({ offer, list }: { offer: number; list: number }) {
  if (!list) return null
  const diff = offer - list
  const pct = Math.round((diff / list) * 100)
  if (diff === 0) return <p className="text-[10px] text-[#9ca3af] mt-1">Sama dengan rate card.</p>
  const under = diff < 0
  return (
    <p className={`text-[10px] mt-1 font-semibold ${under ? 'text-[#2f7d63]' : 'text-[#a4713a]'}`}>
      {under ? '−' : '+'}{idr(Math.abs(diff))} ({under ? '' : '+'}{pct}%) {under ? 'di bawah' : 'di atas'} rate card
    </p>
  )
}

/**
 * The offer's delivery receipts. Five steps, and the last one takes the colour
 * of whatever answer arrived — a rejection and an acceptance should not look
 * alike at a glance.
 */
function OfferTracking({ deal, api }: { deal: Negotiation; api: NegotiationsApi }) {
  const st = deal.offerState
  const seen = ['viewed', 'accepted', 'counter', 'rejected'].includes(st) || deal.stage === 'rejected'
  const answered = !['sent', 'viewed', 'draft', 'delivered'].includes(st)

  const steps = [
    { label: 'Draft', icon: 'edit_note' },
    { label: 'Terkirim', icon: 'send' },
    { label: 'Sampai', icon: 'mark_email_read' },
    { label: 'Dibuka creator', icon: 'visibility' },
    {
      label: OFFER_STATE_LABEL[answered ? st : 'sent'],
      icon: st === 'expired' ? 'timer_off' : st === 'counter' ? 'swap_horiz' : st === 'rejected' ? 'close' : 'schedule',
    },
  ]
  const active = answered ? 4 : seen ? 3 : st === 'delivered' ? 2 : st === 'sent' ? 1 : 0
  const failed = st === 'rejected' || st === 'expired' || deal.stage === 'rejected'

  return (
    <Panel>
      <div className="flex items-center justify-between gap-3 mb-2.5 flex-wrap">
        <span style={PJ} className="text-[10px] font-bold uppercase tracking-widest text-[#9ca3af]">
          Pelacakan offer
        </span>
        {(st === 'sent' || st === 'delivered') && (
          <span className="text-[10px] text-[#9ca3af]">
            Terkirim {deal.sentAt} · belum dibuka
          </span>
        )}
        {st === 'viewed' && (
          <span className="text-[10px] text-[#9ca3af]">
            Dibuka {deal.viewedAt} — menunggu jawaban
          </span>
        )}
      </div>
      <StepRail steps={steps} activeIndex={active} failed={failed} />
      {(st === 'sent' || st === 'delivered' || st === 'viewed') && (
        <p className="text-[9.5px] text-[#9ca3af] mt-2">
          Status setelah &quot;Terkirim&quot; dijalankan manual dari panel simulasi di bawah —
          belum terhubung ke inbox creator.
          {' '}
          <button type="button" onClick={() => api.markViewed(deal.id)}
            className="font-bold text-[#285D6E] hover:underline">Tandai dibuka</button>
        </p>
      )}
    </Panel>
  )
}
