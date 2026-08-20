'use client'

/**
 * Campaign tab — running the deal once the agreement is locked.
 *
 * One tracked item per unit ordered, because three Reels are three things to
 * review, not a quantity. Each moves through its own small state machine
 * (`waiting → submitted → approved → scheduled → published`, with a revision
 * loop back), and the campaign's own stage is *derived* from theirs — it is never
 * set independently, so the headline can never claim the content is approved
 * while an item is still waiting.
 *
 * The actuals that close the campaign are entered here rather than measured.
 * autometric ingests no per-deal delivery signal — nothing reports back "this
 * sponsored Reel got X reach" — so the alternative to a form is a guess wearing a
 * status badge. The form is labelled for what it is, and the settlement screen
 * repeats the label next to every number derived from it.
 */

import { useState } from 'react'
import { Btn, EmptyState, PJ, fmtNum } from './ui'
import {
  FieldLabel, Modal, Note, NumberField, Panel, StatusPill, StepRail, TextField,
} from './negotiationUi'
import {
  CONTENT_STAGES, DELIVERABLE_STATUS, PENALTY_DEFS, PROTECTION_DEFS,
  contentStageOf, deliverableActions, idr,
  type Actuals, type Negotiation,
} from '@/lib/discover/negotiation'
import type { NegotiationsApi } from './useNegotiations'

export default function NegotiationCampaign({
  deal, api,
}: { deal: Negotiation; api: NegotiationsApi }) {
  const [revising, setRevising] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [closing, setClosing] = useState(false)

  if (!deal.agreement?.locked) {
    return (
      <Panel title="Campaign">
        <EmptyState
          icon="lock"
          title="Campaign terbuka setelah agreement terkunci"
          body="Deliverable, review konten, dan pelacakan performa mengacu pada Final Agreement — jadi keduanya harus disepakati lebih dulu."
        />
      </Panel>
    )
  }

  if (deal.stage === 'agreed') {
    return (
      <div className="flex flex-col gap-4">
        <Note tone="good">
          <b>Agreement terkunci.</b> {deal.deliverables.length} deliverable siap dijalankan,
          senilai {idr(deal.finalPrice ?? 0)}. Mulai campaign untuk membuka review konten.
        </Note>
        <Panel title="Siap dijalankan" sub="Deliverable dibentuk dari agreement yang terkunci.">
          <DeliverableList deal={deal} readOnly />
          <div className="mt-3">
            <Btn variant="primary" onClick={() => api.startCampaign(deal.id)}>
              <span className="material-symbols-outlined text-[15px]">rocket_launch</span>
              Mulai campaign
            </Btn>
          </div>
        </Panel>
      </div>
    )
  }

  const items = deal.deliverables
  const stage = contentStageOf(items)
  const allPublished = items.length > 0 && items.every(d => d.status === 'published')

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.9fr_1fr] gap-4 items-start">
      <div className="flex flex-col gap-4">
        <Panel title="Tahap konten" sub="Diturunkan dari status tiap deliverable, bukan diatur sendiri.">
          <StepRail
            steps={CONTENT_STAGES.map((label, i) => ({
              label,
              icon: ['hourglass_empty', 'upload', 'check', 'publish'][i],
            }))}
            activeIndex={stage}
          />
        </Panel>

        <Panel title="Deliverable" sub={`${items.length} item · ${items.filter(d => d.status === 'published').length} tayang`}>
          <DeliverableList
            deal={deal}
            onAction={(key, action) => {
              if (action === 'revise') { setRevising(key); setFeedback(''); return }
              api.deliverableAction(deal.id, key, action)
            }}
          />
        </Panel>

        {deal.stage === 'active' && (
          <Panel title="Tutup campaign" sub="Masukkan hasil akhir, lalu perhitungan pembayaran dijalankan dari aturan yang disepakati.">
            {!allPublished ? (
              <Note tone="warn">
                Masih ada deliverable yang belum tayang. Menutup campaign sekarang berarti
                deliverable yang belum selesai dihitung sebagai tidak terkirim — Guaranteed Fee
                akan diprorata.
              </Note>
            ) : (
              <Note tone="good">Semua deliverable tayang. Guaranteed Fee terlindungi penuh.</Note>
            )}
            <div className="mt-3">
              <Btn variant="primary" onClick={() => setClosing(true)}>
                <span className="material-symbols-outlined text-[15px]">query_stats</span>
                Masukkan hasil &amp; tutup campaign
              </Btn>
            </div>
          </Panel>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <Panel title="Target yang harus dicapai" sub="Dari agreement yang terkunci.">
          <div className="flex flex-col gap-1.5">
            <Row label="Target reach" value={fmtNum(deal.agreement.targets.reach)} />
            <Row label="Target engagement" value={fmtNum(deal.agreement.targets.engagement)} />
            <Row label="Periode" value={`${deal.agreement.start} → ${deal.agreement.end}`} />
            <Row label="Durasi sound" value={deal.agreement.soundDuration} />
          </div>
        </Panel>

        <Panel title="Aktivitas" sub={`${deal.chat.filter(c => c.by === 'system').length} catatan sistem`}>
          <div className="flex flex-col gap-2 max-h-[360px] overflow-y-auto">
            {[...deal.chat].filter(c => c.by === 'system').reverse().map((c, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="material-symbols-outlined text-[13px] text-[#A7C8D4] mt-0.5">info</span>
                <div className="min-w-0">
                  <p className="text-[11px] text-[#374151] leading-relaxed">{c.text}</p>
                  <span className="text-[9.5px] text-[#9ca3af]">{c.at}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {revising && (
        <Modal
          title="Minta revisi"
          onClose={() => setRevising(null)}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setRevising(null)}>Batal</Btn>
              <Btn variant="primary" onClick={() => {
                api.deliverableAction(deal.id, revising, 'revise', feedback)
                setRevising(null)
              }}>Kirim permintaan revisi</Btn>
            </>
          }
        >
          <FieldLabel>Yang perlu diperbaiki</FieldLabel>
          <TextField value={feedback} onChange={setFeedback} rows={4}
            placeholder="Sebutkan bagian yang harus disesuaikan — caption, CTA, penempatan produk, visual, hashtag, atau sound." />
          <p className="text-[10.5px] text-[#9ca3af] mt-2">
            Catatan ini menempel pada deliverable dan masuk ke riwayat aktivitas, jadi putaran
            revisi berikutnya bisa ditelusuri.
          </p>
        </Modal>
      )}

      {closing && (
        <ActualsForm
          deal={deal}
          onClose={() => setClosing(false)}
          onSubmit={actuals => {
            api.completeCampaign(deal.id, actuals)
            setClosing(false)
          }}
        />
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[11px] text-[#6b7280]">{label}</span>
      <span style={PJ} className="text-[11.5px] font-bold tabular-nums text-[#111827]">{value}</span>
    </div>
  )
}

function DeliverableList({
  deal, onAction, readOnly,
}: {
  deal: Negotiation
  onAction?: (key: string, action: 'submit' | 'approve' | 'revise' | 'schedule' | 'publish') => void
  readOnly?: boolean
}) {
  if (!deal.deliverables.length) {
    return <p className="text-[11px] text-[#9ca3af]">Belum ada deliverable.</p>
  }
  return (
    <div className="flex flex-col gap-2">
      {deal.deliverables.map(d => {
        const status = DELIVERABLE_STATUS[d.status]
        const actions = readOnly ? [] : deliverableActions(d.status)
        return (
          <div key={d.key} className="rounded-xl border border-[#e5e7eb] px-3 py-2.5">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="material-symbols-outlined text-[17px] text-[#6b7280]">{d.icon}</span>
              <span style={PJ} className="text-[12px] font-bold text-[#111827] flex-1 min-w-0 truncate">
                {d.label}
              </span>
              <StatusPill label={status.label} tone={status.tone} size="sm" />
            </div>

            {d.status === 'revision' && d.feedback && (
              <p className="text-[10.5px] text-[#c2553f] mt-1.5 leading-relaxed">
                Revisi #{d.revisions}: {d.feedback}
              </p>
            )}
            {d.versions.length > 0 && (
              <p className="text-[9.5px] text-[#9ca3af] mt-1">{d.versions.join(' · ')}</p>
            )}
            {d.status === 'published' && (
              <p className="text-[9.5px] text-[#9ca3af] mt-1">Tayang {d.publishedAt}</p>
            )}

            {actions.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap mt-2">
                {actions.map(a => (
                  <Btn key={a.id} size="sm" variant={a.primary ? 'primary' : 'secondary'}
                    onClick={() => onAction?.(d.key, a.id)}>
                    <span className="material-symbols-outlined text-[14px]">{a.icon}</span>
                    {a.label}
                  </Btn>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * The actuals form.
 *
 * Reach and engagement are pre-filled with the agreed targets rather than with
 * zeroes, so the fields open on the number the deal was written against and the
 * person filling them in is adjusting rather than inventing. The two rule
 * checklists are the ones that were actually switched on in the agreement —
 * offering a penalty nobody agreed to would let the settlement charge for it.
 */
function ActualsForm({
  deal, onClose, onSubmit,
}: { deal: Negotiation; onClose: () => void; onSubmit: (a: Actuals) => void }) {
  const a = deal.agreement!
  const published = deal.deliverables.filter(d => d.status === 'published').length
  const total = Math.max(1, deal.deliverables.length)

  const [reach, setReach] = useState(a.targets.reach)
  const [engagement, setEngagement] = useState(a.targets.engagement)
  const [viewsHit, setViewsHit] = useState(false)
  const [convHit, setConvHit] = useState(false)
  const [topHit, setTopHit] = useState(false)
  const [violations, setViolations] = useState<string[]>(
    published < total ? ['missing'] : [])
  const [brandIssues, setBrandIssues] = useState<string[]>([])

  const activePenalties = a.penalties.filter(p => p.on)
  const activeProtections = a.protections.filter(p => p.on)
  const activeBonuses = a.bonuses.filter(b => b.on)

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter(x => x !== id) : [...list, id])

  return (
    <Modal
      title="Hasil akhir campaign"
      wide
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Batal</Btn>
          <Btn variant="primary" onClick={() => onSubmit({
            reach, engagement,
            delivered: published >= total,
            deliveredRatio: published / total,
            viewsHit, convHit, topHit,
            violations, brandIssues,
          })}>
            Hitung penyelesaian
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Note tone="warn">
          Angka ini <b>diisi manual</b>. autometric tidak menerima laporan performa per-deal
          dari platform, jadi tidak ada sumber terukur untuk diisi otomatis. Setiap hasil
          perhitungan yang memakai angka ini ditandai sebagai input manual.
        </Note>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <FieldLabel>Reach aktual</FieldLabel>
            <NumberField value={reach} onChange={setReach} />
            <p className="text-[10px] text-[#9ca3af] mt-1">Target {fmtNum(a.targets.reach)}</p>
          </div>
          <div>
            <FieldLabel>Engagement aktual</FieldLabel>
            <NumberField value={engagement} onChange={setEngagement} />
            <p className="text-[10px] text-[#9ca3af] mt-1">Target {fmtNum(a.targets.engagement)}</p>
          </div>
        </div>

        <div className="rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2.5">
          <span style={PJ} className="block text-[11px] font-bold text-[#111827]">
            Deliverable: {published} dari {total} tayang
          </span>
          <p className="text-[10.5px] text-[#9ca3af] mt-0.5">
            {published >= total
              ? 'Semua terkirim — Guaranteed Fee terlindungi penuh.'
              : `Guaranteed Fee diprorata ke ${Math.round((published / total) * 100)}%.`}
          </p>
        </div>

        {activeBonuses.length > 0 && (
          <div>
            <FieldLabel>Syarat bonus yang tercapai</FieldLabel>
            <div className="flex flex-col gap-1">
              {activeBonuses.some(b => b.id === 'views') && (
                <Check label="Views melewati benchmark" on={viewsHit} onChange={setViewsHit} />
              )}
              {activeBonuses.some(b => b.id === 'conv') && (
                <Check label="Konversi melewati benchmark" on={convHit} onChange={setConvHit} />
              )}
              {activeBonuses.some(b => b.id === 'top') && (
                <Check label="Masuk konten terbaik brand" on={topHit} onChange={setTopHit} />
              )}
              {activeBonuses.some(b => b.id === 'reach' || b.id === 'eng') && (
                <p className="text-[10px] text-[#9ca3af]">
                  Bonus reach dan engagement dinilai otomatis dari angka aktual di atas.
                </p>
              )}
            </div>
          </div>
        )}

        {activePenalties.length > 0 && (
          <div>
            <FieldLabel>Pelanggaran yang terjadi (penalti)</FieldLabel>
            <div className="flex flex-col gap-1">
              {activePenalties.map(p => (
                <Check
                  key={p.id}
                  label={`${p.label} · ${idr(p.amount)}`}
                  on={violations.includes(p.id)}
                  onChange={() => toggle(violations, setViolations, p.id)}
                  desc={PENALTY_DEFS.find(d => d.id === p.id)?.desc}
                />
              ))}
            </div>
          </div>
        )}

        {activeProtections.length > 0 && (
          <div>
            <FieldLabel>Keterlambatan di sisi brand (proteksi creator)</FieldLabel>
            <div className="flex flex-col gap-1">
              {activeProtections.map(p => (
                <Check
                  key={p.id}
                  label={`${p.label} · ${idr(p.amount)}`}
                  on={brandIssues.includes(p.id)}
                  onChange={() => toggle(brandIssues, setBrandIssues, p.id)}
                  desc={PROTECTION_DEFS.find(d => d.id === p.id)?.desc}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Check({
  label, on, onChange, desc,
}: { label: string; on: boolean; onChange: (v: boolean) => void; desc?: string }) {
  return (
    <label className="flex items-start gap-2 py-1 cursor-pointer">
      <input
        type="checkbox"
        checked={on}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 w-3.5 h-3.5 accent-[#327488]"
      />
      <span className="min-w-0">
        <span className="block text-[11.5px] text-[#374151]">{label}</span>
        {desc && <span className="block text-[10px] text-[#9ca3af]">{desc}</span>}
      </span>
    </label>
  )
}
