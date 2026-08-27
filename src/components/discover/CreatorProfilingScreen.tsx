'use client'

/**
 * Profiling — the dedicated progress screen.
 *
 * A screen rather than a modal, because profiling takes minutes: an Apify run
 * is 20 seconds on a good day and several on a bad one, and holding a dialog
 * open over it makes the user guard a process they cannot help. Here they can
 * navigate away, come back, or open the same URL on another machine — the run
 * lives in `discover_creator_runs`, not in this component.
 *
 * Everything drawn is stored state. Each step shows the state the server wrote
 * and the line it wrote about what it found, so a skipped step says *why* it was
 * skipped ("account is private — its posts are not readable") instead of quietly
 * looking like a pass. The poll stops the moment the run settles.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { PJ, TOKENS as T, fmtNum, RosterAvatar } from './ui'
import { platformLabel } from '@/lib/discover/creatorInput'
import {
  PROFILING_STEPS, PROFILING_STEP_COUNT, progressLabel,
  type CreatorProfile, type FlowStep,
} from '@/lib/discover/creatorFlow'

const POLL_MS = 2_500

export interface CreatorProfilingScreenProps {
  orgId: string
  creatorId: string
  onViewProfile: (creatorId: string) => void
  /** Start another intake run — reopen the Add KOL dialog with an empty field. */
  onAddAnother: () => void
  /** Out of intake entirely, to the Discovery this creator is now part of. */
  onGoToDiscovery: () => void
  onFindSimilar: (creatorId: string) => void
  onBackToRoster: () => void
}

export default function CreatorProfilingScreen({
  orgId, creatorId, onViewProfile, onAddAnother, onGoToDiscovery, onFindSimilar, onBackToRoster,
}: CreatorProfilingScreenProps) {
  const [creator, setCreator] = useState<CreatorProfile | null>(null)
  const [error, setError] = useState('')
  const [retrying, setRetrying] = useState(false)
  // Held in a ref as well as in state: the poll's callback closes over its own
  // render, and reading the live value from a ref is what lets one interval
  // decide whether to keep going without being re-created on every tick.
  const settled = useRef(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/creators/${creatorId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'The creator could not be loaded.')
      const next = data.creator as CreatorProfile
      setCreator(next)
      setError('')
      settled.current = next.profilingStatus === 'ready' || next.profilingStatus === 'failed'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }, [orgId, creatorId])

  useEffect(() => {
    settled.current = false
    load()
    const timer = setInterval(() => { if (!settled.current) load() }, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  async function retry() {
    setRetrying(true)
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/creators/${creatorId}/refresh`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'The run could not be started.')
      settled.current = false
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setRetrying(false)
    }
  }

  if (!creator) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-2">
        <span className="material-symbols-outlined text-[26px] text-[#A7C8D4] animate-spin">progress_activity</span>
        <span className="text-[12px] text-[#9ca3af]">{error || 'Loading the profiling run…'}</span>
        {error && (
          <button type="button" onClick={onBackToRoster} style={PJ}
            className="text-[12px] font-bold text-[#285D6E] underline mt-2 cursor-pointer">
            Back to My Creators
          </button>
        )}
      </div>
    )
  }

  const run = creator.run
  const done = creator.profilingStatus === 'ready'
  const failed = creator.profilingStatus === 'failed'
  const running = !done && !failed

  /**
   * The six steps as the run recorded them, with anything the run has not
   * reached yet filled in as pending. The run's own array is the source; this
   * only guarantees six rows so the list does not grow as the run progresses.
   */
  const steps: FlowStep[] = PROFILING_STEPS.map(def => {
    const recorded = run?.steps.find(s => s.key === def.key)
    return recorded ?? { key: def.key, label: def.label, state: 'pending', detail: null, at: null }
  })
  const settledCount = steps.filter(s => s.state === 'done' || s.state === 'skipped').length

  return (
    <div className="max-w-[860px]">
      {/* ── the creator being profiled ─────────────────────────────────── */}
      <div className="flex items-start gap-3.5 mb-5">
        <div className="w-14 h-14 rounded-2xl overflow-hidden flex items-center justify-center flex-shrink-0"
          style={{ background: T.gradient }}>
          <RosterAvatar src={creator.avatarUrl} username={creator.username} textClass="text-[17px]" />
        </div>
        <div className="min-w-0">
          <h2 style={PJ} className="text-[17px] font-extrabold text-[#111827] tracking-[-0.02em]">
            {creator.displayName || `@${creator.username}`}
          </h2>
          <div className="flex items-center gap-1.5 text-[12px] text-[#6b7280] mt-0.5 flex-wrap">
            <span className="material-symbols-outlined text-[14px] text-[#9ca3af]">
              {creator.platform === 'tiktok' ? 'music_note' : creator.platform === 'facebook' ? 'thumb_up' : 'photo_camera'}
            </span>
            {platformLabel(creator.platform)} · @{creator.username}
            {creator.profileUrl && (
              <a href={creator.profileUrl} target="_blank" rel="noreferrer"
                className="text-[#285D6E] hover:underline inline-flex items-center gap-0.5">
                open
                <span className="material-symbols-outlined text-[13px]">open_in_new</span>
              </a>
            )}
          </div>
        </div>
      </div>

      {/* ── status banner ──────────────────────────────────────────────── */}
      <div className={`rounded-2xl border px-5 py-4 mb-4 ${
        done ? 'border-[#cde5d7] bg-[#eaf5ef]'
          : failed ? 'border-[#f3d9d9] bg-[#fdf2f2]'
          : 'border-[#cfe3ea] bg-[#f0f7fa]'
      }`}>
        <div className="flex items-start gap-3">
          <span className={`material-symbols-outlined text-[22px] ${
            done ? 'text-[#3d8a5f]' : failed ? 'text-[#a04545]' : 'text-[#327488] animate-spin'
          }`}>
            {done ? 'task_alt' : failed ? 'error' : 'progress_activity'}
          </span>
          <div className="min-w-0 flex-1">
            <h3 style={PJ} className={`text-[14px] font-extrabold ${
              done ? 'text-[#2f6f4b]' : failed ? 'text-[#a04545]' : 'text-[#285D6E]'
            }`}>
              {done ? 'Creator Profile Ready'
                : failed ? 'Profiling did not finish'
                : `Profiling in progress — ${progressLabel(settledCount)}`}
            </h3>
            <p className="text-[12px] text-[#6b7280] mt-0.5 leading-snug">
              {done
                ? 'Creator successfully added to the database. The profile is searchable on the Discovery Dashboard and listed in My Creators from now on. Everything below was read from the platform — anything it could not read is left empty rather than estimated.'
                : failed
                  ? creator.profilingError || run?.error || 'The run stopped before it finished.'
                  : 'You can leave this page — the run continues on the server and this screen picks it up again.'}
            </p>

            {running && (
              <div className="mt-3 h-1.5 rounded-full bg-white/70 overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${(settledCount / PROFILING_STEP_COUNT) * 100}%`, background: T.gradient }}
                />
              </div>
            )}
          </div>

          {failed && (
            <button type="button" onClick={retry} disabled={retrying} style={PJ}
              className={`inline-flex items-center gap-1.5 rounded-lg text-[12px] font-bold px-3.5 h-9 border bg-white border-[#e5e7eb] text-[#374151] hover:bg-[#f9fafb] ${
                retrying ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
              }`}>
              <span className={`material-symbols-outlined text-[15px] ${retrying ? 'animate-spin' : ''}`}>
                {retrying ? 'progress_activity' : 'refresh'}
              </span>
              Try again
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
        {/* ── the six steps ────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-[#e5e7eb] bg-white p-5" style={{ boxShadow: T.shadow }}>
          <h4 style={PJ} className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af] mb-3.5">
            Profiling steps
          </h4>
          <ol className="flex flex-col">
            {steps.map((s, i) => (
              <StepRow key={s.key} step={s} index={i} last={i === steps.length - 1} />
            ))}
          </ol>
          {run && (
            <p className="text-[10.5px] text-[#c4cbd4] mt-4 pt-3 border-t border-[#f3f4f6]">
              {run.kind === 'refresh' ? 'Refresh run' : 'First profiling run'} started{' '}
              {new Date(run.startedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
              {run.finishedAt && ` · finished ${new Date(run.finishedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
            </p>
          )}
        </section>

        {/* ── the profile as it stands ─────────────────────────────────── */}
        <aside className="rounded-2xl border border-[#e5e7eb] bg-white p-5 h-fit" style={{ boxShadow: T.shadow }}>
          <h4 style={PJ} className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af] mb-3.5">
            Profile preview
          </h4>
          <Field label="Creator name" value={creator.displayName} />
          <Field label="Platform" value={platformLabel(creator.platform)} />
          <Field label="Username" value={`@${creator.username}`} />
          <Field label="Category" value={creator.category} />
          <Field label="Location" value={creator.city} />
          <Field label="Followers" value={creator.followers !== null ? fmtNum(creator.followers) : null} />
          <Field
            label="Engagement rate"
            value={creator.erPct !== null ? `${creator.erPct.toFixed(2)}%` : null}
          />
          <Field label="Tier" value={creator.tier} />
          <Field label="Visibility" value={creator.visibility === 'unknown' ? null : creator.visibility} />
          <Field
            label="Content"
            value={creator.content
              ? `${creator.content.postsAnalyzed} posts · ${creator.content.formats[0]?.label ?? 'mixed formats'}`
              : null}
          />
          <Field
            label="Last updated"
            value={creator.lastRefreshedAt
              ? new Date(creator.lastRefreshedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
              : null}
          />
        </aside>
      </div>

      {/* ── what to do next ────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap mt-4">
        {done ? (
          <>
            <Primary icon="person" onClick={() => onViewProfile(creator.id)}>View Full Profile</Primary>
            <Secondary icon="person_add" onClick={onAddAnother}>Add Another Creator</Secondary>
            <Secondary icon="travel_explore" onClick={onGoToDiscovery}>Go to Discovery</Secondary>
            {/* The bridge into Smart Discovery, from the one creator who is
                freshest in mind. Not one of the three the flow promises, but the
                reference search is exactly what a just-profiled creator is good
                for, and it is one click from here or six from anywhere else. */}
            <Secondary icon="hub" onClick={() => onFindSimilar(creator.id)}>Find similar creators</Secondary>
          </>
        ) : (
          <>
            <Secondary icon="list" onClick={onBackToRoster}>Back to My Creators</Secondary>
            {!failed && <Secondary icon="person_add" onClick={onAddAnother}>Add another while this runs</Secondary>}
          </>
        )}
      </div>

      {error && (
        <p className="text-[11.5px] text-[#a04545] mt-3">
          Could not reach the server for the latest state: {error}
        </p>
      )}
    </div>
  )
}

/* ── pieces ───────────────────────────────────────────────────────────────── */

const STEP_LOOK: Record<FlowStep['state'], { icon: string; fg: string; bg: string }> = {
  done: { icon: 'check', fg: '#3d8a5f', bg: '#eaf5ef' },
  skipped: { icon: 'remove', fg: '#b5761f', bg: '#fdf3e7' },
  failed: { icon: 'close', fg: '#a04545', bg: '#fdf2f2' },
  running: { icon: 'progress_activity', fg: '#327488', bg: '#f0f7fa' },
  pending: { icon: 'more_horiz', fg: '#c4cbd4', bg: '#f9fafb' },
}

function StepRow({ step, index, last }: { step: FlowStep; index: number; last: boolean }) {
  const look = STEP_LOOK[step.state] ?? STEP_LOOK.pending
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0"
          style={{ background: look.bg }}>
          <span
            className={`material-symbols-outlined text-[15px] ${step.state === 'running' ? 'animate-spin' : ''}`}
            style={{ color: look.fg }}
          >
            {look.icon}
          </span>
        </span>
        {!last && <span className="w-px flex-1 bg-[#f3f4f6] my-1" />}
      </div>
      <div className={`min-w-0 flex-1 ${last ? '' : 'pb-4'}`}>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span style={PJ} className={`text-[12.5px] font-bold ${
            step.state === 'pending' ? 'text-[#c4cbd4]' : 'text-[#374151]'
          }`}>
            {index + 1}. {step.label}
          </span>
          {step.state === 'skipped' && (
            <span style={PJ} className="text-[9px] font-extrabold uppercase tracking-wide text-[#b5761f] bg-[#fdf3e7] rounded px-1.5 py-0.5">
              skipped
            </span>
          )}
        </div>
        {step.detail && <p className="text-[11.5px] text-[#9ca3af] leading-snug mt-0.5">{step.detail}</p>}
      </div>
    </li>
  )
}

/**
 * One line of the preview.
 *
 * A field with no value says so, and says it in grey. That is the whole point of
 * this panel while a run is going: it fills in as the steps settle, and what is
 * still missing is visibly missing rather than shown as a zero.
 */
function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-[#f9fafb] last:border-0">
      <span className="text-[11px] text-[#9ca3af]">{label}</span>
      <span style={PJ} className={`text-[12px] font-bold text-right truncate ${value ? 'text-[#374151]' : 'text-[#d1d5db]'}`}>
        {value || 'not measured yet'}
      </span>
    </div>
  )
}

function Primary({ children, icon, onClick }: { children: React.ReactNode; icon: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={PJ}
      className="inline-flex items-center gap-1.5 rounded-lg text-[12px] font-bold px-4 h-9 border bg-[#327488] border-[#327488] text-white hover:bg-[#285D6E] cursor-pointer">
      <span className="material-symbols-outlined text-[16px]">{icon}</span>
      {children}
    </button>
  )
}

function Secondary({ children, icon, onClick }: { children: React.ReactNode; icon: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={PJ}
      className="inline-flex items-center gap-1.5 rounded-lg text-[12px] font-bold px-4 h-9 border bg-white border-[#e5e7eb] text-[#374151] hover:bg-[#f9fafb] cursor-pointer">
      <span className="material-symbols-outlined text-[16px]">{icon}</span>
      {children}
    </button>
  )
}
