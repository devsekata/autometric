'use client'

/**
 * Agreement tab — the document both sides accept.
 *
 * Before the price is agreed this edits the draft terms that travel with each
 * offer. After it, it edits the Agreement: the same fields, frozen at the moment
 * the price was struck, and every change from here on resets both signatures.
 * `activeTerms` in the model is what makes that one screen instead of two.
 *
 * Four panels, in the order the argument actually happens in:
 *
 *   1. the fee split, next to the tier table that gives "at risk" a consequence
 *   2. the KPI targets the performance half is measured against, and the window
 *   3. the three rule sets — bonus, penalty, protection
 *   4. payment terms and, if custom, the milestones
 *
 * Responsibilities sit below in a collapsible: they matter, they are read once,
 * and two four-line text areas at full height pushed the acceptance controls off
 * the first screen. This started as seven stacked panels — the fee split, the
 * tiers and each rule set had one each — which meant the thing you were actually
 * negotiating was never visible next to the thing it implied.
 *
 * The three rule sets share one panel with a selector rather than stacking, but
 * the selector shows all three counts at once: penalties and protections are a
 * matched pair, and a screen where the brand's recourse is visible while the
 * creator's is a click away is not describing a two-sided agreement.
 */

import { useState } from 'react'
import { Btn, PJ, fmtNum } from './ui'
import {
  Collapsible, FieldLabel, GlossaryButton, Modal, MoneyRow, Note, NumberField, Panel,
  Stat, StatusPill, TextField,
} from './negotiationUi'
import {
  PAY_TERMS_LABEL, PERF_TIERS, activeTerms, idr, isLocked, milestoneTotal,
  type Negotiation, type PayTerms, type Rule,
} from '@/lib/discover/negotiation'
import type { Deliverable } from '@/lib/discover/vocab'
import type { NegotiationsApi } from './useNegotiations'

const PAY_TERMS: PayTerms[] = ['after', 'split50', 'milestone', 'upfront']

type RuleGroup = 'bonuses' | 'penalties' | 'protections'

const RULE_GROUPS: { id: RuleGroup; label: string; sub: string; accent: string }[] = [
  {
    id: 'bonuses',
    label: 'Bonus',
    sub: 'Upside yang brand setuju bayar bila hasil melewati target.',
    accent: '#2f7d63',
  },
  {
    id: 'penalties',
    label: 'Penalti',
    sub: 'Hak brand bila isi perjanjian dilanggar — bukan untuk angka yang lemah.',
    accent: '#c2553f',
  },
  {
    id: 'protections',
    label: 'Proteksi influencer',
    sub: 'Cermin dari penalti, untuk saat brand yang terlambat.',
    accent: '#285D6E',
  },
]

export default function NegotiationTerms({
  deal, api, catalogue,
}: { deal: Negotiation; api: NegotiationsApi; catalogue: Deliverable[] }) {
  const t = activeTerms(deal)
  const locked = isLocked(deal)
  const agreement = deal.agreement
  const price = deal.finalPrice ?? deal.offers[deal.offers.length - 1]?.amount ?? deal.listPrice
  const guaranteed = agreement ? agreement.guaranteed : Math.round((price * t.guaranteedPct) / 100)
  const performance = agreement ? agreement.performance : price - guaranteed

  const [ruleGroup, setRuleGroup] = useState<RuleGroup>('bonuses')
  const [acceptError, setAcceptError] = useState<string | null>(null)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.9fr_1fr] gap-4 items-start">
      <div className="flex flex-col gap-4">
        {locked ? (
          <Note tone="good">
            <b>Final Agreement terkunci.</b> Dokumen ini yang jadi acuan campaign dan
            perhitungan pembayaran. Untuk mengubahnya, ajukan amendment — perubahan tercatat
            dan kedua pihak harus menerima ulang.
          </Note>
        ) : !agreement ? (
          <Note>
            Ini masih <b>draft terms</b>. Isinya ikut terkirim di setiap versi offer, dan
            membeku jadi Final Agreement begitu harga disepakati.
          </Note>
        ) : null}

        {/* 1 — the fee split, beside what it implies */}
        <Panel
          title="Harga & pembagian fee"
          sub="Guaranteed Fee dibayar untuk pekerjaannya. Performance Fee bergantung hasil."
          action={<GlossaryButton />}
        >
          <div className="grid grid-cols-1 sm:grid-cols-[1.15fr_1fr] gap-4">
            <div>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <Stat label="Harga deal" value={idr(price)}
                  sub={deal.finalPrice ? 'disepakati' : 'offer terakhir'} />
                <Stat label="Guaranteed" value={idr(guaranteed)}
                  sub={`${t.guaranteedPct}% · terlindungi`} tone="good" />
                <Stat label="Performance" value={idr(performance)}
                  sub={`${100 - t.guaranteedPct}% · bertingkat`} tone="warn" />
              </div>
              <FieldLabel>Porsi Guaranteed Fee</FieldLabel>
              <div className="flex items-center gap-2.5">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={t.guaranteedPct}
                  disabled={locked}
                  onChange={e => api.patchTerms(deal.id, { guaranteedPct: Number(e.target.value) })}
                  className="flex-1 accent-[#327488] disabled:opacity-50"
                  aria-label="Porsi Guaranteed Fee"
                />
                <span style={PJ} className="w-10 text-right text-[12px] font-extrabold tabular-nums text-[#111827]">
                  {t.guaranteedPct}%
                </span>
              </div>
              <p className="text-[10px] text-[#9ca3af] mt-1.5 max-w-[46ch]">
                Porsi ini yang paling sering jadi pokok tawar-menawar: semakin tinggi, semakin
                kecil risiko yang ditanggung creator.
              </p>
            </div>

            <div className="rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2.5">
              <span style={PJ} className="block text-[9.5px] font-bold uppercase tracking-widest text-[#9ca3af] mb-1">
                Achievement → Performance Fee
              </span>
              {PERF_TIERS.map(tier => (
                <div key={tier.min}
                  className="flex items-baseline justify-between gap-2 py-1 border-b border-[#eef0f3] last:border-0">
                  <div className="min-w-0">
                    <span style={PJ} className="text-[11px] font-bold text-[#111827]">
                      {tier.min === 0 ? '< 60%' : `≥ ${tier.min}%`}
                    </span>
                    <p className="text-[9.5px] text-[#9ca3af] leading-snug">{tier.note}</p>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    <span style={PJ} className="text-[11.5px] font-extrabold tabular-nums text-[#285D6E]">
                      {tier.earns}%
                    </span>
                    <span className="block text-[9px] text-[#9ca3af] tabular-nums">
                      {idr(Math.round((performance * tier.earns) / 100))}
                    </span>
                  </div>
                </div>
              ))}
              <p className="text-[9.5px] text-[#9ca3af] mt-1.5 leading-snug">
                Di bawah target hanya Performance Fee yang turun. Guaranteed Fee tidak — kecuali
                deliverable memang tidak selesai.
              </p>
            </div>
          </div>
        </Panel>

        {/* 2 — the targets and the window */}
        <Panel
          title="Target KPI & jadwal"
          sub="Reach dan engagement diturunkan dari matriks ini, jadi angka yang dinilai selalu sama dengan yang dilihat kedua pihak."
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {([['views', 'Views / Reach'], ['likes', 'Likes'], ['comments', 'Komentar']] as const).map(([key, label]) => (
              <div key={key}>
                <FieldLabel>{label}</FieldLabel>
                <NumberField value={t.kpi[key]} disabled={locked}
                  onChange={v => api.setKpi(deal.id, key, v)} />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3">
            <Stat label="Target reach" value={fmtNum(t.targets.reach)} />
            <Stat label="Target engagement" value={fmtNum(t.targets.engagement)} sub="likes + komentar" />
            <div>
              <FieldLabel>Mulai</FieldLabel>
              <DateField value={t.start} disabled={locked}
                onChange={v => api.patchTerms(deal.id, { start: v })} />
              <div className="mt-2">
                <FieldLabel>Selesai</FieldLabel>
                <DateField value={t.end} disabled={locked}
                  onChange={v => api.patchTerms(deal.id, { end: v })} />
              </div>
            </div>
            <div>
              <FieldLabel>Tenggat bayar</FieldLabel>
              <DateField value={t.dueDate} disabled={locked}
                onChange={v => api.patchTerms(deal.id, { dueDate: v })} />
              <div className="mt-2">
                <FieldLabel>Durasi sound</FieldLabel>
                <select
                  value={t.soundDuration}
                  disabled={locked}
                  onChange={e => api.patchTerms(deal.id, { soundDuration: e.target.value })}
                  style={PJ}
                  className="w-full h-8 px-2 rounded-lg border border-[#e5e7eb] text-[11px] font-bold text-[#111827] bg-white focus:outline-none focus:border-[#327488] disabled:bg-[#f9fafb] disabled:text-[#9ca3af]"
                >
                  {['15 detik', '30 detik', '45 detik', '60 detik'].map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
            </div>
          </div>
        </Panel>

        {/* 3 — the three rule sets, one panel */}
        <Panel
          title="Aturan deal"
          sub="Tiap aturan bisa dinyalakan sendiri dan punya nilainya sendiri. Semuanya masuk ke perhitungan akhir."
        >
          <div className="flex flex-wrap gap-1.5 mb-3">
            {RULE_GROUPS.map(g => {
              const rules = t[g.id] as Rule[]
              const on = rules.filter(r => r.on).length
              const selected = ruleGroup === g.id
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setRuleGroup(g.id)}
                  style={PJ}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 h-7 text-[11px] font-bold transition-colors ${
                    selected
                      ? 'bg-[#f0f7fa] border-[#327488] text-[#285D6E]'
                      : 'bg-white border-[#e5e7eb] text-[#6b7280] hover:border-[#A7C8D4]'
                  }`}
                >
                  {g.label}
                  <span
                    style={{ color: on ? g.accent : '#b6bcc6' }}
                    className="text-[10px] font-extrabold tabular-nums"
                  >
                    {on}/{rules.length}
                  </span>
                </button>
              )
            })}
          </div>

          {RULE_GROUPS.filter(g => g.id === ruleGroup).map(g => (
            <div key={g.id}>
              <p className="text-[10.5px] text-[#9ca3af] mb-1.5">{g.sub}</p>
              <RuleList
                rules={t[g.id] as Rule[]}
                locked={locked}
                onToggle={id => api.toggleRule(deal.id, g.id, id)}
                onAmount={(id, v) => api.setRuleAmount(deal.id, g.id, id, v)}
              />
            </div>
          ))}
        </Panel>

        {/* 4 — payment terms */}
        <Panel title="Termin pembayaran" sub="Terkunci bersama agreement, dan jadwalnya dibentuk dari pilihan ini.">
          <div className="flex flex-wrap gap-1.5 mb-3">
            {PAY_TERMS.map(pt => {
              const on = t.payTerms === pt
              return (
                <button
                  key={pt}
                  type="button"
                  disabled={locked}
                  onClick={() => api.setPayTerms(deal.id, pt)}
                  style={PJ}
                  className={`inline-flex items-center rounded-full border px-3 h-7 text-[11px] font-bold transition-colors disabled:opacity-50 ${
                    on
                      ? 'bg-[#f0f7fa] border-[#327488] text-[#285D6E]'
                      : 'bg-white border-[#e5e7eb] text-[#6b7280] hover:border-[#A7C8D4]'
                  }`}
                >
                  {PAY_TERMS_LABEL[pt]}
                </button>
              )
            })}
          </div>

          {t.payTerms === 'milestone' ? (
            <MilestoneEditor deal={deal} api={api} locked={locked} price={price} />
          ) : (
            <div className="flex flex-col">
              {t.payTerms === 'split50' && (
                <>
                  <MoneyRow label="Di muka — campaign mulai · 50%" amount={Math.round(price * 0.5)} />
                  <MoneyRow label="Pelunasan — setelah evaluasi · 50%" amount={price - Math.round(price * 0.5)}
                    note="Disesuaikan hasil evaluasi." />
                </>
              )}
              {t.payTerms === 'upfront' && (
                <MoneyRow label="Pembayaran penuh — campaign mulai · 100%" amount={price} />
              )}
              {t.payTerms === 'after' && (
                <MoneyRow label="Pelunasan — setelah evaluasi · 100%" amount={price}
                  note="Seluruh nilai diselesaikan setelah evaluasi." />
              )}
            </div>
          )}
        </Panel>

        {/* Read once, then in the way — so it folds. */}
        <Collapsible title="Tanggung jawab masing-masing pihak" icon="assignment">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <FieldLabel>Brand / agency</FieldLabel>
              <TextField value={t.respBrand} disabled={locked} rows={4}
                onChange={v => api.patchTerms(deal.id, { respBrand: v })} />
            </div>
            <div>
              <FieldLabel>{deal.creatorName}</FieldLabel>
              <TextField value={t.respCreator} disabled={locked} rows={4}
                onChange={v => api.patchTerms(deal.id, { respCreator: v })} />
            </div>
          </div>
        </Collapsible>
      </div>

      {/* acceptance + log */}
      <div className="flex flex-col gap-4">
        {agreement ? (
          <Panel
            title="Persetujuan"
            sub="Influencer menerima lebih dulu, brand mengonfirmasi dan mengunci."
            action={locked ? <StatusPill label="Terkunci" tone="good" /> : undefined}
          >
            <div className="flex flex-col gap-2 mb-3">
              <AcceptRow label={deal.creatorName} done={agreement.accept.creator} />
              <AcceptRow label="Brand / agency" done={agreement.accept.brand} />
            </div>
            {acceptError && <div className="mb-2.5"><Note tone="warn">{acceptError}</Note></div>}
            {!locked ? (
              <div className="flex flex-col gap-2">
                {!agreement.accept.creator && (
                  <Btn variant="secondary"
                    onClick={() => setAcceptError(api.accept(deal.id, 'creator', catalogue))}>
                    <span className="material-symbols-outlined text-[15px]">how_to_reg</span>
                    Tandai influencer menerima
                  </Btn>
                )}
                <Btn variant="primary" disabled={!agreement.accept.creator}
                  onClick={() => setAcceptError(api.accept(deal.id, 'brand', catalogue))}>
                  <span className="material-symbols-outlined text-[15px]">gavel</span>
                  Konfirmasi &amp; kunci agreement
                </Btn>
                <p className="text-[9.5px] text-[#9ca3af]">
                  Persetujuan influencer masih ditandai manual — belum ada portal creator.
                </p>
              </div>
            ) : (
              <Btn variant="ghost" onClick={() => api.amend(deal.id)}>
                <span className="material-symbols-outlined text-[15px]">edit_document</span>
                Ajukan amendment
              </Btn>
            )}
            {deal.amendments > 0 && (
              <p className="text-[10px] text-[#9ca3af] mt-2">
                Amendment ke-{deal.amendments}. Versi sebelumnya tetap ada di riwayat perubahan.
              </p>
            )}
          </Panel>
        ) : (
          <Panel title="Persetujuan">
            <p className="text-[11px] text-[#9ca3af] leading-relaxed">
              Final Agreement dibuat otomatis begitu harga disepakati. Sampai itu terjadi,
              yang diedit di sini adalah draft terms yang menyertai offer.
            </p>
          </Panel>
        )}

        <Panel title="Riwayat perubahan" sub={`${deal.changes.length} catatan`}>
          <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto">
            {[...deal.changes].reverse().map((c, i) => (
              <div key={`${c.field}-${i}`} className="flex items-start gap-2">
                <span className="material-symbols-outlined text-[13px] text-[#A7C8D4] mt-0.5">history</span>
                <div className="min-w-0">
                  <p className="text-[11px] text-[#374151] leading-relaxed">{c.field}</p>
                  <span className="text-[9.5px] text-[#9ca3af]">{c.at}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}

function AcceptRow({ label, done }: { label: string; done: boolean }) {
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
      done ? 'border-[#b6e0cd] bg-[#eaf6f1]' : 'border-[#e5e7eb] bg-white'
    }`}>
      <span className={`material-symbols-outlined text-[17px] ${done ? 'text-[#2f7d63]' : 'text-[#d1d5db]'}`}>
        {done ? 'task_alt' : 'radio_button_unchecked'}
      </span>
      <span style={PJ} className="text-[11.5px] font-bold text-[#111827] flex-1 min-w-0 truncate">{label}</span>
      <span className="text-[10px] text-[#9ca3af]">{done ? 'Menerima' : 'Belum'}</span>
    </div>
  )
}

function DateField({
  value, onChange, disabled,
}: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <input
      type="date"
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      style={PJ}
      className="w-full h-8 px-2 rounded-lg border border-[#e5e7eb] text-[11px] font-bold text-[#111827] bg-white focus:outline-none focus:border-[#327488] disabled:bg-[#f9fafb] disabled:text-[#9ca3af]"
    />
  )
}

function RuleList({
  rules, locked, onToggle, onAmount,
}: {
  rules: Rule[]
  locked: boolean
  onToggle: (id: string) => void
  onAmount: (id: string, amount: number) => void
}) {
  return (
    <div className="flex flex-col">
      {rules.map(r => (
        <div key={r.id} className="flex items-start gap-2.5 py-2 border-b border-[#f3f4f6] last:border-0">
          <button
            type="button"
            role="switch"
            aria-checked={r.on}
            aria-label={r.label}
            disabled={locked}
            onClick={() => onToggle(r.id)}
            className={`mt-0.5 w-8 h-[18px] rounded-full flex-shrink-0 relative transition-colors disabled:opacity-50 ${
              r.on ? 'bg-[#327488]' : 'bg-[#e5e7eb]'
            }`}
          >
            <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all ${
              r.on ? 'left-[16px]' : 'left-[2px]'
            }`} />
          </button>
          <div className="flex-1 min-w-0">
            <span style={PJ} className={`block text-[11.5px] font-bold ${r.on ? 'text-[#111827]' : 'text-[#9ca3af]'}`}>
              {r.label}
            </span>
            <p className="text-[10px] text-[#9ca3af] leading-relaxed">{r.desc}</p>
          </div>
          <div className="w-[118px] flex-shrink-0">
            <NumberField value={r.amount} disabled={locked || !r.on} onChange={v => onAmount(r.id, v)} />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Custom milestones. The total is shown at all times because the agreement
 * cannot be accepted until it is exactly 100% — a rule that is much less
 * annoying when you can see how far off you are while editing.
 */
function MilestoneEditor({
  deal, api, locked, price,
}: { deal: Negotiation; api: NegotiationsApi; locked: boolean; price: number }) {
  const t = activeTerms(deal)
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const total = milestoneTotal(t.milestones)

  const set = (i: number, patch: Partial<{ label: string; pct: number }>) => {
    api.setMilestones(deal.id, t.milestones.map((m, j) => (j === i ? { ...m, ...patch } : m)))
  }

  return (
    <div className="flex flex-col gap-2">
      {t.milestones.map((m, i) => (
        <div key={`${m.label}-${i}`} className="flex items-center gap-2">
          <input
            value={m.label}
            disabled={locked}
            onChange={e => set(i, { label: e.target.value })}
            className="flex-1 min-w-0 h-8 px-2.5 rounded-lg border border-[#e5e7eb] text-[11.5px] text-[#374151] bg-white focus:outline-none focus:border-[#327488] disabled:bg-[#f9fafb]"
          />
          <div className="w-[86px] flex-shrink-0">
            <NumberField value={m.pct} suffix="%" disabled={locked} onChange={v => set(i, { pct: v })} />
          </div>
          <span style={PJ} className="w-[104px] text-right text-[11px] font-bold tabular-nums text-[#6b7280]">
            {idr(Math.round((price * m.pct) / 100))}
          </span>
          <button
            type="button"
            disabled={locked || t.milestones.length <= 2}
            onClick={() => api.setMilestones(deal.id, t.milestones.filter((_, j) => j !== i))}
            aria-label={`Hapus ${m.label}`}
            title={t.milestones.length <= 2 ? 'Minimal dua milestone' : 'Hapus milestone'}
            className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-[#9ca3af] hover:bg-[#f3f4f6] hover:text-[#c2553f] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[16px]">delete</span>
          </button>
        </div>
      ))}

      <div className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${
        total === 100 ? 'border-[#b6e0cd] bg-[#eaf6f1]' : 'border-[#f0c8bf] bg-[#fcefec]'
      }`}>
        <span style={PJ} className="text-[11px] font-bold text-[#374151]">
          Total {total}% {total === 100 ? '· siap' : '· harus tepat 100% sebelum bisa diterima'}
        </span>
        <span style={PJ} className="text-[11.5px] font-extrabold tabular-nums text-[#111827]">
          {idr(Math.round((price * total) / 100))}
        </span>
      </div>

      {!locked && (
        <Btn size="sm" variant="secondary" onClick={() => setAdding(true)}>
          <span className="material-symbols-outlined text-[15px]">add</span>
          Tambah milestone
        </Btn>
      )}

      {adding && (
        <Modal
          title="Tambah milestone"
          onClose={() => { setAdding(false); setLabel('') }}
          footer={
            <>
              <Btn variant="ghost" onClick={() => { setAdding(false); setLabel('') }}>Batal</Btn>
              <Btn variant="primary" disabled={!label.trim()} onClick={() => {
                api.setMilestones(deal.id, [...t.milestones, { label: label.trim(), pct: 0 }])
                setAdding(false); setLabel('')
              }}>Tambah</Btn>
            </>
          }
        >
          <FieldLabel>Nama milestone</FieldLabel>
          <input
            value={label}
            autoFocus
            onChange={e => setLabel(e.target.value)}
            placeholder="mis. Brief disetujui"
            className="w-full h-9 px-2.5 rounded-lg border border-[#e5e7eb] text-[12px] text-[#374151] bg-white focus:outline-none focus:border-[#327488]"
          />
          <p className="text-[10.5px] text-[#9ca3af] mt-2">
            Persentasenya diatur di daftar, dan totalnya harus 100%.
          </p>
        </Modal>
      )}
    </div>
  )
}
