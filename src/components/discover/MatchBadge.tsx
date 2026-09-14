'use client'

/**
 * Brand Match, as it appears on a creator.
 *
 * One component for every surface that shows a match — the Creator Database
 * grid and table, Compare, the creator report — so a creator cannot be a Strong
 * Match on one screen and a Good Match on the next, and so the five bands are
 * drawn the same way wherever they land.
 *
 * ── What it refuses to draw ────────────────────────────────────────────────
 * A missing score renders as "Not scored", never as 0% and never as a grey bar
 * at the left edge. Those read as "this creator scored badly", which is a
 * different and false claim: an unmeasured creator is one the database has
 * nothing on, not one the brand should reject. `Not Scored` gets its own
 * neutral treatment for exactly that reason.
 *
 * No weight is shown, here or in the detail panel. Coverage is — "scored on 60%
 * of the model" is the honest caveat on a partial score — but the weights that
 * make up that 60% are not the user's to see or to argue with.
 */

import { useState } from 'react'
import { PJ, TOKENS as T } from './ui'
import type { MatchExplanation, MatchSignal } from '@/lib/discover/brandMatch/explain'
import { LEVEL_TONE } from '@/lib/discover/brandMatch/explain'

/**
 * The five bands plus the unscored state.
 *
 * Deliberately one hue with five steps rather than a red-to-green ramp. A match
 * score is not a safety rating, and painting a Low Match red tells the buyer
 * something the model never said — plenty of Low Match creators are simply
 * creators nobody has measured yet.
 */
const TONE: Record<string, { bg: string; fg: string; bd: string; icon: string }> = {
  excellent: { bg: '#e3f2f8', fg: '#1E4A58', bd: '#7DB4C6', icon: 'workspace_premium' },
  strong: { bg: '#EDF4F7', fg: '#285D6E', bd: '#A7C8D4', icon: 'verified' },
  good: { bg: '#f5f9fb', fg: '#327488', bd: '#cfe0e8', icon: 'thumb_up' },
  moderate: { bg: '#f9fafb', fg: '#6b7280', bd: '#e5e7eb', icon: 'radio_button_partial' },
  low: { bg: '#f9fafb', fg: '#9ca3af', bd: '#f3f4f6', icon: 'remove' },
  none: { bg: '#ffffff', fg: '#9ca3af', bd: '#f3f4f6', icon: 'help' },
}

/** The compact badge a card or a table cell wears. */
export function MatchBadge({
  match, size = 'md', showScore = true,
}: { match: MatchExplanation | null; size?: 'sm' | 'md'; showScore?: boolean }) {
  const tone = TONE[match ? LEVEL_TONE[match.level] : 'none']
  const sm = size === 'sm'

  // No profile saved, or this creator was not in the scored set at all.
  if (!match) {
    return (
      <span
        style={{ ...PJ, background: tone.bg, color: tone.fg, borderColor: tone.bd }}
        className={`inline-flex items-center gap-1 rounded-full border font-bold ${
          sm ? 'text-[10px] px-2 h-[20px]' : 'text-[11px] px-2.5 h-[24px]'}`}
        title="No brand profile has been saved for this workspace yet."
      >
        <span className="material-symbols-outlined text-[12px]">{tone.icon}</span>
        No match yet
      </span>
    )
  }

  const unscored = match.score === null
  return (
    <span
      style={{ ...PJ, background: tone.bg, color: tone.fg, borderColor: tone.bd }}
      className={`inline-flex items-center gap-1 rounded-full border font-bold ${
        sm ? 'text-[10px] px-2 h-[20px]' : 'text-[11px] px-2.5 h-[24px]'}`}
      title={match.summary}
    >
      <span className="material-symbols-outlined text-[12px]">{tone.icon}</span>
      {unscored ? 'Not scored' : (
        <>
          {showScore && <span className="tabular-nums">{match.score}</span>}
          {match.level.replace(' Match', '')}
        </>
      )}
    </span>
  )
}

/** One dimension's bar, or the reason there is no bar. */
function SignalRow({ s }: { s: MatchSignal }) {
  if (s.pct === null) {
    return (
      <div className="flex items-start gap-2 py-1">
        <span style={{ ...PJ, color: T.t4 }} className="text-[11px] font-bold w-[92px] shrink-0">
          {s.label}
        </span>
        <span className="text-[10.5px] leading-snug" style={{ color: T.t4 }}>
          <span className="material-symbols-outlined text-[12px] align-[-2px] mr-0.5">do_not_disturb_on</span>
          Not measured — {s.unavailable}
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 py-1">
      <span style={{ ...PJ, color: T.t3 }} className="text-[11px] font-bold w-[92px] shrink-0">{s.label}</span>
      <span className="flex-1 h-[6px] rounded-full overflow-hidden" style={{ background: T.outlineSoft }}>
        <span
          className="block h-full rounded-full"
          style={{ width: `${s.pct}%`, background: T.gradient }}
        />
      </span>
      <span style={{ ...PJ, color: T.t2 }} className="text-[11px] font-bold tabular-nums w-[28px] text-right">
        {s.pct}
      </span>
    </div>
  )
}

/**
 * The full explanation — the four bars, the sentence, and the coverage caveat.
 * Used inline on the creator report and inside the directory's quick-look panel.
 *
 * Renders whatever `match.signals` carries and computes nothing: the bars, their
 * labels and their 0–100 values all arrive from the engine. A second opinion
 * here is how a card and a report start disagreeing about one creator.
 */
export function MatchExplanationPanel({ match }: { match: MatchExplanation | null }) {
  if (!match) {
    return (
      <p className="text-[11.5px] leading-relaxed" style={{ color: T.t3 }}>
        No brand profile has been saved for this workspace, so no creator can be matched yet.
        Set one up in <b style={PJ}>Settings → Brand Profile</b> and every creator here will
        carry a real score against it.
      </p>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <MatchBadge match={match} />
        <span style={{ ...PJ, color: T.t4 }} className="text-[10.5px] font-bold uppercase tracking-wider">
          {match.confidence === 'Limited Data' ? 'Limited data' : `${match.confidence} confidence`}
        </span>
      </div>

      <p className="text-[11.5px] leading-relaxed mb-2" style={{ color: T.t2 }}>{match.summary}</p>

      <div className="rounded-xl border p-2.5" style={{ borderColor: T.outline, background: T.surfaceLow }}>
        {match.signals.map(s => <SignalRow key={s.id} s={s} />)}
      </div>

      {match.coverage < 100 && (
        <p className="text-[10.5px] mt-2 leading-snug" style={{ color: T.t4 }}>
          <span className="material-symbols-outlined text-[12px] align-[-2px] mr-0.5">info</span>
          This creator was scored on {match.coverage}% of the model. The dimensions marked
          “not measured” did not count against them — the remaining ones were re-weighted to
          make up the whole.
        </p>
      )}
    </div>
  )
}

/**
 * The strip shown above a list when the workspace has no scoreable profile.
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
          Match scores are off until you describe your brand
        </div>
        <div className="text-[11px] leading-snug" style={{ color: T.t3 }}>
          The Brand Match Engine compares every creator against your brand’s category, audience
          and keywords. Without a saved profile there is nothing to compare them to, so no score
          is shown rather than a made-up one.
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
