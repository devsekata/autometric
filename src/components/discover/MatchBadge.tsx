'use client'

/**
 * Brand Match, as it appears on a creator.
 *
 * One component for every surface that shows a match — the Creator Database
 * grid and table, Compare, the quick-look panel, the creator report — so one
 * creator cannot wear two different Match % a few hundred pixels apart.
 *
 * ── It renders; it never scores ────────────────────────────────────────────
 * Every number here arrives from the API as `BrandMatchResult`
 * (`@/lib/discover/whatMatters/brandMatch`): `matchPct` is the mean of the
 * criteria the workspace's Brand Profile chose — its What Matters plus the
 * Target Audience fields it filled in — computed on the KOL server. Nothing in
 * this file averages, re-weights or rounds its way to a different figure. A
 * second opinion here is how a card and a report start disagreeing.
 *
 * ── What it refuses to draw ────────────────────────────────────────────────
 * There are no bands. There is no Excellent / Strong / Good / Moderate / Low,
 * and no colour ramp standing in for one: the score is a mean of measured
 * criteria, and cutting it into five named tiers would assert a judgement the
 * model never made.
 *
 * A null `matchPct` — every chosen criterion unmeasured for this creator —
 * renders as "Match —", never as 0% and never as a bar at the left edge. Those
 * read as "this creator scored badly", which is a different and false claim: an
 * unmeasured creator is one the database has nothing on, not one the brand
 * should reject. The same rule holds inside the breakdown, where a criterion
 * with no score is marked as not counted rather than drawn as an empty bar.
 */

import { PJ, TOKENS as T } from './ui'
import type { BrandMatchResult } from '@/lib/discover/whatMatters/brandMatch'

const pct = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: 1 })

/**
 * The tooltip every surface shares: what the Match % is the mean OF, and which
 * of the chosen criteria could not be measured for this creator.
 */
function tooltip(m: BrandMatchResult): string {
  const head = m.matchPct === null
    ? 'Brand Match belum bisa dihitung: kriteria yang dipilih (What Matters / Target Audience) belum terukur untuk creator ini.'
    : `Brand Match ${m.matchPct}% = rata-rata ${m.contributing} dari ${m.selected} kriteria yang dipilih (What Matters + Target Audience).`
  const lines = m.breakdown.map(b =>
    `• ${b.label}: ${b.score === null
      ? 'belum terukur (tidak dihitung)'
      : b.score.toLocaleString('id-ID', { maximumFractionDigits: 2 })}`)
  return [head, ...lines].join('\n')
}

/**
 * The compact badge a card or a table cell wears.
 *
 * Renders `m.matchPct` trimmed to one decimal; the tooltip carries the exact
 * value and the breakdown it was averaged from. A null `matchPct` shows a dash.
 */
export function MatchBadge({ m, size = 'md' }: { m: BrandMatchResult; size?: 'sm' | 'md' }) {
  const shown = m.matchPct === null ? null : pct(m.matchPct)
  const sm = size === 'sm'
  return (
    <span
      style={{
        ...PJ,
        background: shown === null ? T.surfaceVariant : '#e8f3f6',
        color: shown === null ? T.t4 : T.primaryDeep,
      }}
      className={`inline-flex items-center gap-1 rounded-[7px] font-extrabold whitespace-nowrap ${
        sm ? 'text-[9.5px] px-2 py-[3px]' : 'text-[11px] px-2.5 py-[4px]'}`}
      title={tooltip(m)}
      aria-label={shown === null ? 'Brand Match belum terukur' : `Brand Match ${shown} persen`}
    >
      <span className="material-symbols-outlined text-[12px]">auto_awesome</span>
      {shown === null ? 'Match —' : `${shown}% match`}
    </span>
  )
}

/** One chosen criterion's bar, or the reason there is no bar. */
function CriterionRow({ label, score }: { label: string; score: number | null }) {
  if (score === null) {
    return (
      <div className="flex items-start gap-2 py-1">
        <span style={{ ...PJ, color: T.t4 }} className="text-[11px] font-bold w-[124px] shrink-0">
          {label}
        </span>
        <span className="text-[10.5px] leading-snug" style={{ color: T.t4 }}>
          <span className="material-symbols-outlined text-[12px] align-[-2px] mr-0.5">do_not_disturb_on</span>
          Belum terukur — tidak dihitung
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 py-1">
      <span style={{ ...PJ, color: T.t3 }} className="text-[11px] font-bold w-[124px] shrink-0">{label}</span>
      <span className="flex-1 h-[6px] rounded-full overflow-hidden" style={{ background: T.outlineSoft }}>
        <span className="block h-full rounded-full"
          style={{ width: `${Math.max(0, Math.min(100, score))}%`, background: T.gradient }} />
      </span>
      <span style={{ ...PJ, color: T.t2 }} className="text-[11px] font-bold tabular-nums w-[34px] text-right">
        {pct(score)}
      </span>
    </div>
  )
}

/**
 * The full breakdown: the Match %, then one row per chosen criterion.
 *
 * Used inline on the creator report and inside the directory's quick-look
 * panel. It renders exactly `m.breakdown` — the criteria the Brand Profile
 * chose, in the order the engine returned them — and computes nothing. A
 * criterion with no score is shown as not counted, which is also what the
 * arithmetic did with it: it left the denominator rather than scoring zero.
 */
export function MatchExplanationPanel({ m }: { m: BrandMatchResult | null }) {
  if (!m || m.unavailable === 'no_selection') {
    return (
      <p className="text-[11.5px] leading-relaxed" style={{ color: T.t3 }}>
        Workspace ini belum memilih kriteria apa pun pada Brand Profile, jadi belum ada yang
        bisa dirata-ratakan. Pilih What Matters (dan isi Target Audience bila relevan) di{' '}
        <b style={PJ}>Settings → Brand Profile</b>, dan setiap creator di sini akan membawa
        Match % sungguhan.
      </p>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <MatchBadge m={m} />
        <span style={{ ...PJ, color: T.t4 }} className="text-[10.5px] font-bold uppercase tracking-wider">
          {m.contributing} / {m.selected} kriteria terukur
        </span>
      </div>

      <div className="rounded-xl border p-2.5" style={{ borderColor: T.outline, background: T.surfaceLow }}>
        {m.breakdown.map(b => <CriterionRow key={b.key} label={b.label} score={b.score} />)}
      </div>

      {m.contributing < m.selected && (
        <p className="text-[10.5px] mt-2 leading-snug" style={{ color: T.t4 }}>
          <span className="material-symbols-outlined text-[12px] align-[-2px] mr-0.5">info</span>
          {m.selected - m.contributing} kriteria belum terukur untuk creator ini. Kriteria itu
          keluar dari pembagi — tidak dihitung sebagai nol, dan tidak merugikan creator ini.
        </p>
      )}
    </div>
  )
}

/**
 * The strip shown above a list when the workspace has chosen no criteria.
 * A prompt, not an error: nothing is broken, something has not been said yet.
 */
export function NoBrandProfileNotice({ href }: { href: string }) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5 mb-3"
      style={{ borderColor: '#A7C8D4', background: TEAL_WASH }}
    >
      <span className="material-symbols-outlined text-[18px]" style={{ color: T.primary }}>handshake</span>
      <div className="flex-1 min-w-0">
        <div style={{ ...PJ, color: T.primaryDeep }} className="text-[12px] font-bold">
          Match scores are off until you say what matters
        </div>
        <div className="text-[11px] leading-snug" style={{ color: T.t3 }}>
          Brand Match is the average of the criteria you choose — What Matters, plus any Target
          Audience you fill in. With nothing chosen there is nothing to average, so no score is
          shown rather than a made-up one.
        </div>
      </div>
      <a
        href={href}
        style={PJ}
        className="shrink-0 inline-flex items-center gap-1 rounded-lg border text-[11.5px] font-bold px-3 h-8 bg-[#327488] border-[#327488] text-white hover:bg-[#285D6E]"
      >
        Set up Brand Profile
      </a>
    </div>
  )
}

const TEAL_WASH = '#f0f7fa'
