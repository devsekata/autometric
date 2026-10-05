'use client'

/**
 * Settlement tab — the payment schedule, the evaluation, and the final amount.
 *
 * The whole point of the two-part fee is that the final number can be *read*, so
 * this screen shows the arithmetic rather than the result: what was guaranteed
 * and whether it was protected, which performance tier was reached and why, each
 * bonus and whether it fired, each penalty and each protection. Both parties
 * signed the rules; the settlement's job is to show them being applied.
 *
 * Money already paid through the schedule is subtracted at the end rather than
 * folded in earlier, because "remaining to pay now" and "what this deal was
 * worth" are two different questions and a single figure answers neither.
 */

import { Btn, EmptyState, PJ, fmtNum } from './ui'
import { MoneyRow, Note, Panel, Stat, StatusPill } from './negotiationUi'
import {
  PAY_TERMS_LABEL, evaluate, idr, scheduleRowStatus,
  type Negotiation,
} from '@/lib/discover/negotiation'
import type { NegotiationsApi } from './useNegotiations'

export default function NegotiationSettlement({
  deal, api,
}: { deal: Negotiation; api: NegotiationsApi }) {
  const a = deal.agreement
  if (!a?.locked || !deal.finalPrice) {
    return (
      <Panel title="Penyelesaian">
        <EmptyState
          icon="lock"
          title="Belum ada yang bisa diselesaikan"
          body="Jadwal pembayaran terbentuk saat Final Agreement terkunci, dan perhitungan akhir berjalan setelah campaign ditutup."
        />
      </Panel>
    )
  }

  const ev = evaluate(deal)
  const due = ev ? Math.max(0, ev.final - deal.paid) : 0
  const schedule = a.schedule ?? []

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.9fr_1fr] gap-4 items-start">
      <div className="flex flex-col gap-4">
        <Panel
          title="Jadwal pembayaran"
          sub={`${PAY_TERMS_LABEL[a.payTerms]} · terkunci bersama agreement`}
          action={schedule.every(r => r.paid) && schedule.length > 0
            ? <StatusPill label="Lunas" tone="good" /> : undefined}
        >
          {schedule.length === 0 ? (
            <p className="text-[11px] text-[#9ca3af]">Jadwal belum terbentuk.</p>
          ) : (
            <div className="flex flex-col">
              {schedule.map((r, i) => {
                const st = scheduleRowStatus(deal, i)
                const isFinal = r.payAt === 'evaluation'
                return (
                  <div key={`${r.label}-${i}`}
                    className="flex items-center justify-between gap-3 py-2 border-b border-[#f3f4f6] last:border-0">
                    <div className="min-w-0">
                      <span style={PJ} className="text-[11.5px] font-bold text-[#111827]">
                        {i + 1}. {r.label} · {r.pct}%
                      </span>
                      {isFinal && (
                        <p className="text-[10px] text-[#9ca3af]">Disesuaikan hasil evaluasi</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span style={PJ} className="text-[11.5px] font-extrabold tabular-nums text-[#111827]">
                        {idr(r.amount)}
                      </span>
                      <StatusPill label={st.label} tone={st.tone} size="sm" />
                      {!r.paid && st.label === 'Jatuh tempo' && !isFinal && (
                        <Btn size="sm" variant="secondary" onClick={() => api.payMilestone(deal.id, i)}>
                          Catat bayar
                        </Btn>
                      )}
                    </div>
                  </div>
                )
              })}
              <MoneyRow label="Terbayar / Harga deal"
                amount={`${idr(deal.paid)} / ${idr(deal.finalPrice)}`} strong />
            </div>
          )}
          <p className="text-[9.5px] text-[#9ca3af] mt-2">
            Termin terakhir diselesaikan setelah evaluasi: Guaranteed + Performance Fee yang
            diperoleh + Bonus − Penyesuaian, dikurangi yang sudah dibayar. Pencatatan
            pembayaran di sini belum terhubung ke payment gateway.
          </p>
        </Panel>

        {ev ? (
          <Panel title="Perhitungan akhir" sub="Setiap baris berasal dari aturan yang disepakati di agreement.">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-3">
              <Stat label="Achievement" value={`${ev.achievementPct}%`}
                tone={ev.achievementPct >= 100 ? 'good' : ev.achievementPct >= 60 ? 'warn' : undefined}
                sub="rata-rata reach & engagement" />
              <Stat label="Tier performance" value={`${ev.tierPct}%`} sub="dari Performance Fee" />
              <Stat label="Total akhir" value={idr(ev.final)} tone="good" />
            </div>

            <div className="flex flex-col">
              <MoneyRow
                label={`Guaranteed Fee ${deal.actuals?.delivered ? '(terlindungi)' : '(diprorata)'}`}
                amount={ev.guaranteedEarned}
                note={ev.guaranteedNote}
              />
              <MoneyRow
                label={`Performance Fee — ${ev.tierPct}% dari ${idr(a.performance)}`}
                amount={ev.performanceEarned}
                note={ev.performanceNote}
              />
              {ev.bonusRows.length > 0 && (
                <RuleBlock title="Bonus" hit={ev.bonusRows.filter(r => r.hit).length}>
                  {ev.bonusRows.map(r => (
                    <RuleLine key={r.label} label={r.label} amount={r.amount} hit={r.hit} sign="+" />
                  ))}
                  <MoneyRow label="Total bonus" amount={ev.bonus} tone="good" />
                </RuleBlock>
              )}
              {ev.penaltyRows.length > 0 && (
                <RuleBlock title="Penalti" hit={ev.penaltyRows.filter(r => r.hit).length}>
                  {ev.penaltyRows.map(r => (
                    <RuleLine key={r.label} label={r.label} amount={r.amount} hit={r.hit} sign="−" />
                  ))}
                </RuleBlock>
              )}
              {ev.protectionRows.length > 0 && (
                <RuleBlock title="Proteksi influencer" hit={ev.protectionRows.filter(r => r.hit).length}>
                  {ev.protectionRows.map(r => (
                    <RuleLine key={r.label} label={r.label} amount={r.amount} hit={r.hit} sign="+" />
                  ))}
                </RuleBlock>
              )}
              {ev.adjustment !== 0 && (
                <MoneyRow
                  label={ev.adjustment > 0 ? 'Penyesuaian (penalti kontraktual)' : 'Penyesuaian (kredit proteksi creator)'}
                  amount={`${ev.adjustment > 0 ? '−' : '+'}${idr(Math.abs(ev.adjustment))}`}
                  tone={ev.adjustment > 0 ? 'bad' : 'good'}
                />
              )}
              <MoneyRow label="Total pembayaran akhir" amount={ev.final} strong />
              {deal.paid > 0 && (
                <MoneyRow label="Sudah dibayar lewat termin" amount={`−${idr(deal.paid)}`} />
              )}
              <MoneyRow label="Sisa yang harus dibayar" amount={due} strong tone="good" />
            </div>

            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {deal.stage === 'evaluation' && (
                <Btn variant="primary" onClick={() => api.confirmEvaluation(deal.id)}>
                  <span className="material-symbols-outlined text-[15px]">fact_check</span>
                  Konfirmasi evaluasi
                </Btn>
              )}
              {deal.stage === 'payment-pending' && (
                <Btn variant="primary" onClick={() => api.payFinal(deal.id)}>
                  <span className="material-symbols-outlined text-[15px]">payments</span>
                  Catat pelunasan {idr(due)}
                </Btn>
              )}
              {deal.stage === 'paid' && (
                <Btn variant="secondary" onClick={() => api.finish(deal.id)}>
                  <span className="material-symbols-outlined text-[15px]">flag_circle</span>
                  Tutup campaign
                </Btn>
              )}
            </div>

            {deal.stage === 'evaluation' && (
              <div className="mt-3">
                <Note tone="warn">
                  Perhitungan ini memakai hasil yang <b>diisi manual</b> saat campaign ditutup.
                  Konfirmasi evaluasi menjadikannya dasar pelunasan.
                </Note>
              </div>
            )}
          </Panel>
        ) : (
          <Panel title="Perhitungan akhir">
            <EmptyState
              icon="query_stats"
              title="Menunggu campaign ditutup"
              body="Perhitungan berjalan setelah hasil akhir dimasukkan di tab Campaign."
            />
          </Panel>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <Panel title="Struktur deal" sub="Angka yang membeku saat agreement terkunci.">
          <div className="flex flex-col gap-1.5">
            <MoneyRow label="Harga deal" amount={deal.finalPrice} />
            <MoneyRow label="Guaranteed Fee" amount={a.guaranteed} note={`${a.guaranteedPct}% · terlindungi`} />
            <MoneyRow label="Performance Fee" amount={a.performance} note="bertingkat sesuai achievement" />
            <MoneyRow label="Rate card awal" amount={deal.listPrice} strike />
            {deal.listPrice > 0 && deal.finalPrice !== deal.listPrice && (
              <MoneyRow
                label="Selisih dari rate card"
                amount={`${deal.finalPrice < deal.listPrice ? '−' : '+'}${idr(Math.abs(deal.finalPrice - deal.listPrice))}`}
                tone={deal.finalPrice < deal.listPrice ? 'good' : 'bad'}
              />
            )}
          </div>
        </Panel>

        {deal.actuals && (
          <Panel title="Hasil yang dimasukkan" sub="Input manual, bukan data terukur.">
            <div className="flex flex-col gap-1.5">
              <MoneyRow label="Reach" amount={fmtNum(deal.actuals.reach)}
                note={`Target ${fmtNum(a.targets.reach)}`} />
              <MoneyRow label="Engagement" amount={fmtNum(deal.actuals.engagement)}
                note={`Target ${fmtNum(a.targets.engagement)}`} />
              <MoneyRow label="Deliverable lengkap"
                amount={deal.actuals.delivered ? 'Ya' : `${Math.round(deal.actuals.deliveredRatio * 100)}%`} />
            </div>
          </Panel>
        )}

        {deal.payments.length > 0 && (
          <Panel title="Riwayat pembayaran" sub={`${deal.payments.length} transaksi tercatat`}>
            <div className="flex flex-col gap-2">
              {[...deal.payments].reverse().map(p => (
                <div key={p.receipt} className="rounded-xl border border-[#e5e7eb] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span style={PJ} className="text-[10.5px] font-extrabold text-[#111827]">{p.receipt}</span>
                    <span style={PJ} className="text-[11.5px] font-extrabold tabular-nums text-[#2f7d63]">
                      {idr(p.amount)}
                    </span>
                  </div>
                  <p className="text-[10px] text-[#6b7280] mt-0.5 leading-relaxed">{p.label}</p>
                  <span className="text-[9.5px] text-[#9ca3af]">{p.at}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  )
}

/**
 * A named group of rules, with how many of them fired.
 *
 * The count in the heading is the part worth reading first: "Penalti · 0 kena" is
 * the answer, and the rows below it are the evidence.
 */
function RuleBlock({
  title, hit, children,
}: { title: string; hit: number; children: React.ReactNode }) {
  return (
    <div className="mt-2 pt-2 border-t border-[#f3f4f6]">
      <div className="flex items-center gap-1.5 mb-0.5">
        <span style={PJ} className="text-[9.5px] font-bold uppercase tracking-widest text-[#9ca3af]">
          {title}
        </span>
        <span className={`text-[9.5px] font-bold tabular-nums ${hit ? 'text-[#285D6E]' : 'text-[#c8ced6]'}`}>
          {hit ? `${hit} kena` : 'tidak ada yang kena'}
        </span>
      </div>
      {children}
    </div>
  )
}

/** One rule and whether it fired — the ones that did not still show their price. */
function RuleLine({
  label, amount, hit, sign,
}: { label: string; amount: number; hit: boolean; sign: '+' | '−' }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`material-symbols-outlined text-[13px] ${hit ? 'text-[#2f7d63]' : 'text-[#d1d5db]'}`}>
          {hit ? 'check_circle' : 'radio_button_unchecked'}
        </span>
        <span className={`text-[11px] truncate ${hit ? 'text-[#374151]' : 'text-[#9ca3af]'}`}>{label}</span>
      </div>
      <span style={PJ} className={`text-[11px] font-bold tabular-nums whitespace-nowrap ${
        hit ? (sign === '+' ? 'text-[#2f7d63]' : 'text-[#c2553f]') : 'text-[#d1d5db]'
      }`}>
        {hit ? `${sign}${idr(amount)}` : idr(amount)}
      </span>
    </div>
  )
}
