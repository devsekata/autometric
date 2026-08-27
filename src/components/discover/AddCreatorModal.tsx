'use client'

/**
 * Add KOL — the dialog that starts the intake flow.
 *
 * A dialog rather than a page, and deliberately: adding a creator is a short
 * errand you run *from* somewhere, and the somewhere is worth keeping. Opened
 * over the Discovery Dashboard it leaves the list you were reading intact
 * underneath, and closing it costs nothing — no navigation, no lost scroll
 * position, no second trip back. The flag that opens it is `?add=1`, so it
 * still survives a reload and can still be linked to.
 *
 * Three phases in one dialog, because they are one decision: pick a platform
 * and paste a handle, watch the five checks run, then act on what came back.
 * The work that follows — profiling — is deliberately *not* here: it takes
 * minutes, and a modal is the wrong shape for something you are meant to walk
 * away from, so pressing Start Profiling closes this and hands over to the
 * progress screen.
 *
 * Six result screens, one per outcome of `checkCreatorAccount`. They exist as
 * separate screens rather than one screen with a colour-coded banner because the
 * next action differs in each: a wrong-platform URL is fixed by switching
 * platform, a private account is a choice about accepting less data, and a
 * duplicate is not an error at all — it is a creator you already have.
 */

import { useEffect, useRef, useState } from 'react'
import { PJ, TOKENS as T, fmtNum, RosterAvatar } from './ui'
import {
  CREATOR_PLATFORMS, parseCreatorInput, platformLabel, platformOfUrl, type CreatorPlatform,
} from '@/lib/discover/creatorInput'
import {
  VALIDATION_STEPS, type AccountPreview, type CheckResult, type CreatorSummary, type FlowStep,
} from '@/lib/discover/creatorFlow'

type Phase = 'input' | 'checking' | 'result'

export interface AddCreatorModalProps {
  orgId: string
  /**
   * A handle or profile URL to open on (`?url=`), for a link that arrived from
   * somewhere other than this field.
   *
   * It seeds the field, not the check: the run still has to be pressed. The
   * paste happened on another screen, so confirming what was pasted before
   * spending an actor call on it is the honest order, and it leaves room to fix
   * a link that came out of the clipboard wrong.
   */
  initialInput?: string | null
  /** Dismiss without adding anybody — drops `?add=1` and leaves you where you were. */
  onClose: () => void
  /** A brand-new creator was created and its first run started. */
  onProfilingStarted: (creator: CreatorSummary) => void
  /** The handle is already in the database — open what we have. */
  onViewExisting: (creatorId: string) => void
  /** The handle is already in the database — re-run profiling on it. */
  onRefreshExisting: (creatorId: string) => void
}

export default function AddCreatorModal({
  orgId, initialInput, onClose, onProfilingStarted, onViewExisting, onRefreshExisting,
}: AddCreatorModalProps) {
  // A seeded link carries its own platform, so the picker follows it rather than
  // sitting on Instagram and greeting a TikTok URL with a wrong-platform error
  // the user did nothing to earn.
  const [platform, setPlatform] = useState<CreatorPlatform>(
    () => (initialInput ? platformOfUrl(initialInput) : null) ?? 'instagram',
  )
  const [value, setValue] = useState(initialInput ?? '')
  const [phase, setPhase] = useState<Phase>('input')
  const [result, setResult] = useState<CheckResult | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Selected rather than merely focused when it arrives seeded: a link that
  // came from elsewhere is one keystroke from being replaced if it came out
  // wrong.
  useEffect(() => {
    inputRef.current?.focus()
    if (initialInput) inputRef.current?.select()
  }, [initialInput])

  // Escape closes, except while a creator is being written — that request is
  // already in flight and dismissing the dialog would not call it back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !submitting) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, submitting])

  /**
   * Client-side parse, live, so the two mistakes that need no server round trip
   * are caught before one is spent: an empty box and a link belonging to another
   * platform. Anything else is the server's to judge.
   */
  const parsed = value.trim() ? parseCreatorInput(platform, value) : null
  const localProblem = parsed && !parsed.ok ? parsed : null

  /**
   * What the Check Account button does with an input the parser rejected: say
   * so, in place, instead of the button being unclickable.
   */
  function submit() {
    if (parsed?.ok) return runCheck()
    setError(localProblem?.message ?? 'Masukkan username atau URL profil dulu.')
  }

  async function runCheck() {
    setError('')
    setResult(null)
    setPhase('checking')
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/creators/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, input: value.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.detail || data?.error || 'The check could not be completed.')
      setResult(data as CheckResult)
      setPhase('result')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setPhase('input')
    }
  }

  /** Create the creator and start its first profiling run. */
  async function startProfiling(account: AccountPreview) {
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/creators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: account.platform,
          input: account.username,
          visibility: account.visibility,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'The creator could not be added.')

      // `created: false` means someone else added the same handle between the
      // duplicate check and this click. That is not an error — it is the
      // duplicate screen, arriving a few seconds late.
      if (!data.created) {
        onViewExisting(data.creator.id)
        return
      }
      onProfilingStarted(data.creator as CreatorSummary)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setSubmitting(false)
    }
  }

  const backToInput = () => { setPhase('input'); setResult(null); setError('') }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={() => { if (!submitting) onClose() }} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add New KOL"
        className="relative bg-white rounded-2xl w-full max-w-[560px] mx-4 max-h-[88vh] overflow-y-auto border border-[#e5e7eb]"
        style={{ boxShadow: T.shadowLg }}
      >
        <header className="px-6 pt-5 pb-4 border-b border-[#f3f4f6] flex items-start justify-between gap-3">
          <div>
            <h2 style={PJ} className="text-[15px] font-extrabold text-[#111827]">Add New KOL</h2>
            <p className="text-[12px] text-[#9ca3af] mt-0.5">
              Add a creator by entering their social media profile information. We check the account
              before anything is stored.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { if (!submitting) onClose() }}
            className="material-symbols-outlined text-[18px] text-[#9ca3af] hover:text-[#374151] cursor-pointer"
            aria-label="Close"
          >
            close
          </button>
        </header>

        <PhaseRail phase={phase} />

        <div className="px-6 py-5">
          {phase === 'input' && (
            <InputPhase
              platform={platform}
              onPlatform={p => { setPlatform(p); setError('') }}
              value={value}
              onValue={v => { setValue(v); setError('') }}
              inputRef={inputRef}
              problem={localProblem?.message ?? null}
              suggest={localProblem?.suggestPlatform ?? null}
              onSuggest={p => { setPlatform(p); setError('') }}
              error={error}
              onSubmit={submit}
              canSubmit={!!parsed?.ok}
            />
          )}

          {phase === 'checking' && <CheckingPhase />}

          {phase === 'result' && result && (
            <ResultPhase
              result={result}
              submitting={submitting}
              error={error}
              onEdit={backToInput}
              onSwitchPlatform={p => { setPlatform(p); backToInput() }}
              onStartProfiling={startProfiling}
              onViewExisting={onViewExisting}
              onRefreshExisting={onRefreshExisting}
              onCancel={onClose}
            />
          )}
        </div>

        {/* Where the creator ends up once this dialog is done with them. The
            dashboard behind it is the list they will appear in, so saying so
            here is the whole answer to "and then what". */}
        <p className="px-6 pb-5 -mt-1 text-[11px] text-[#9ca3af] flex items-start gap-1.5">
          <span className="material-symbols-outlined text-[14px] mt-px">info</span>
          <span>
            A creator that passes these checks is profiled and saved to this
            organization&apos;s database, and appears on the Discovery Dashboard,
            in My Creators and in search as soon as the run finishes.
          </span>
        </p>
      </div>
    </div>
  )
}

/* ── phase rail ───────────────────────────────────────────────────────────── */

const PHASES: { id: Phase; label: string }[] = [
  { id: 'input', label: 'Account' },
  { id: 'checking', label: 'Validation' },
  { id: 'result', label: 'Result' },
]

function PhaseRail({ phase }: { phase: Phase }) {
  const index = PHASES.findIndex(p => p.id === phase)
  return (
    <div className="px-6 py-3 bg-[#f9fafb] border-b border-[#f3f4f6] flex items-center gap-2">
      {PHASES.map((p, i) => {
        const state = i < index ? 'done' : i === index ? 'now' : 'next'
        return (
          <span key={p.id} className="inline-flex items-center gap-2">
            {i > 0 && <span className="w-5 h-px bg-[#e5e7eb]" />}
            <span
              style={PJ}
              className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${
                state === 'next' ? 'text-[#c4cbd4]' : state === 'now' ? 'text-[#285D6E]' : 'text-[#3d8a5f]'
              }`}
            >
              <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-extrabold ${
                state === 'done' ? 'bg-[#eaf5ef] text-[#3d8a5f]'
                  : state === 'now' ? 'bg-[#327488] text-white'
                  : 'bg-[#f3f4f6] text-[#9ca3af]'
              }`}>
                {state === 'done' ? '✓' : i + 1}
              </span>
              {p.label}
            </span>
          </span>
        )
      })}
    </div>
  )
}

/* ── 1. input ─────────────────────────────────────────────────────────────── */

function InputPhase({
  platform, onPlatform, value, onValue, inputRef, problem, suggest, onSuggest,
  error, onSubmit, canSubmit,
}: {
  platform: CreatorPlatform
  onPlatform: (p: CreatorPlatform) => void
  value: string
  onValue: (v: string) => void
  inputRef: React.RefObject<HTMLInputElement | null>
  problem: string | null
  suggest: CreatorPlatform | null
  onSuggest: (p: CreatorPlatform) => void
  error: string
  onSubmit: () => void
  canSubmit: boolean
}) {
  const def = CREATOR_PLATFORMS.find(p => p.id === platform)!
  return (
    <form
      className="flex flex-col gap-5"
      // Submits whatever is in the box. When the input cannot be parsed the
      // reason is already under the field — the button says so rather than
      // going grey and leaving the user to guess which part is wrong.
      onSubmit={e => { e.preventDefault(); onSubmit() }}
    >
      <div className="flex flex-col gap-2">
        <label style={PJ} className="text-[10.5px] font-bold uppercase tracking-widest text-[#6b7280]">
          Platform
        </label>
        <div className="grid grid-cols-3 gap-2">
          {CREATOR_PLATFORMS.map(p => {
            const on = p.id === platform
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onPlatform(p.id)}
                className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 transition-all cursor-pointer ${
                  on ? 'border-[#327488] bg-[#f0f7fa]' : 'border-[#e5e7eb] bg-white hover:border-[#A7C8D4]'
                }`}
              >
                <span className={`material-symbols-outlined text-[19px] ${on ? 'text-[#285D6E]' : 'text-[#9ca3af]'}`}>
                  {p.icon}
                </span>
                <span style={PJ} className={`text-[11.5px] font-bold ${on ? 'text-[#285D6E]' : 'text-[#6b7280]'}`}>
                  {p.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label style={PJ} htmlFor="creator-handle"
          className="text-[10.5px] font-bold uppercase tracking-widest text-[#6b7280]">
          Username or profile URL
        </label>
        <input
          id="creator-handle"
          ref={inputRef}
          value={value}
          onChange={e => onValue(e.target.value)}
          placeholder={def.handleExample}
          className={`w-full h-10 px-3 rounded-lg border text-[13px] text-[#111827] outline-none transition-colors ${
            problem ? 'border-[#e0b4b4] focus:border-[#c98a8a]' : 'border-[#e5e7eb] focus:border-[#327488]'
          }`}
        />
        <p className="text-[11px] text-[#9ca3af]">
          Accepts <span className="font-semibold text-[#6b7280]">{def.handleExample}</span> or{' '}
          <span className="font-semibold text-[#6b7280]">{def.urlExample}</span>
        </p>
        {problem && (
          <p className="text-[11.5px] text-[#b5561f] flex items-start gap-1.5">
            <span className="material-symbols-outlined text-[14px] mt-px">error</span>
            <span>
              {problem}
              {suggest && (
                <button type="button" onClick={() => onSuggest(suggest)}
                  style={PJ} className="ml-1.5 underline font-bold text-[#285D6E] cursor-pointer">
                  Switch to {platformLabel(suggest)}
                </button>
              )}
            </span>
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-[#fdf2f2] border border-[#f3d9d9] px-3 py-2 text-[11.5px] text-[#a04545]">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="submit"
          style={PJ}
          className={`inline-flex items-center gap-1.5 rounded-lg text-[12px] font-bold px-4 h-9 border transition-colors cursor-pointer ${
            canSubmit
              ? 'bg-[#327488] border-[#327488] text-white hover:bg-[#285D6E]'
              : 'bg-white border-[#e5e7eb] text-[#6b7280] hover:bg-[#f9fafb]'
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">travel_explore</span>
          Check Account
        </button>
      </div>
    </form>
  )
}

/* ── 2. checking ──────────────────────────────────────────────────────────── */

/**
 * The five checks, while the request is in flight.
 *
 * The highlight walks down the list on a timer, and that is all it does: no step
 * is ever shown as passed here. The server runs the checks in one request and
 * returns their real outcomes together, so a tick drawn before that answer
 * arrives would be an invention. What the walk communicates is "these are the
 * checks being worked through", which is true; the outcomes appear on the next
 * screen, each with what it actually found.
 */
function CheckingPhase() {
  const [active, setActive] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => {
      setActive(i => Math.min(i + 1, VALIDATION_STEPS.length - 1))
    }, 1_400)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px] text-[#4E96AC] animate-spin">progress_activity</span>
        <span style={PJ} className="text-[13px] font-bold text-[#285D6E]">Checking the account…</span>
      </div>
      <ol className="flex flex-col gap-2.5">
        {VALIDATION_STEPS.map((s, i) => {
          const state = i < active ? 'seen' : i === active ? 'now' : 'waiting'
          return (
            <li key={s.key} className="flex items-center gap-2.5">
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${
                state === 'waiting' ? 'bg-[#f3f4f6]' : 'bg-[#f0f7fa]'
              }`}>
                <span className={`material-symbols-outlined text-[13px] ${
                  state === 'now' ? 'text-[#327488] animate-spin'
                    : state === 'seen' ? 'text-[#A7C8D4]' : 'text-[#d1d5db]'
                }`}>
                  {state === 'now' ? 'progress_activity' : 'radio_button_unchecked'}
                </span>
              </span>
              <span style={PJ} className={`text-[12.5px] ${
                state === 'waiting' ? 'text-[#c4cbd4]' : state === 'now' ? 'font-bold text-[#374151]' : 'text-[#9ca3af]'
              }`}>
                {s.label}
              </span>
            </li>
          )
        })}
      </ol>
      <p className="text-[11px] text-[#9ca3af] border-t border-[#f3f4f6] pt-3">
        Instagram and Facebook are checked through a scraper, which can take up to a minute. Results appear once every
        check has answered.
      </p>
    </div>
  )
}

/* ── 3. result ────────────────────────────────────────────────────────────── */

function ResultPhase({
  result, submitting, error, onEdit, onSwitchPlatform, onStartProfiling,
  onViewExisting, onRefreshExisting, onCancel,
}: {
  result: CheckResult
  submitting: boolean
  error: string
  onEdit: () => void
  onSwitchPlatform: (p: CreatorPlatform) => void
  onStartProfiling: (a: AccountPreview) => void
  onViewExisting: (id: string) => void
  onRefreshExisting: (id: string) => void
  onCancel: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <StepReport steps={result.steps} />

      {result.state === 'invalid_url' && (
        <Outcome
          tone="warn" icon="link_off" title="Invalid profile URL"
          body={result.message}
          actions={
            <>
              {result.suggestPlatform && (
                <Action onClick={() => onSwitchPlatform(result.suggestPlatform!)} variant="primary">
                  Switch to {platformLabel(result.suggestPlatform)}
                </Action>
              )}
              <Action onClick={onEdit} variant={result.suggestPlatform ? 'secondary' : 'primary'}>Edit URL</Action>
            </>
          }
        />
      )}

      {result.state === 'not_found' && (
        <Outcome
          tone="bad" icon="person_off" title="Account not found"
          body={result.message}
          actions={<Action onClick={onEdit} variant="primary">Try Again</Action>}
        />
      )}

      {result.state === 'unverified' && (
        <Outcome
          tone="warn" icon="cloud_off" title="Could not confirm the account"
          body={result.message}
          preview={result.account}
          actions={
            <>
              <Action onClick={() => onStartProfiling(result.account)} variant="primary" busy={submitting}>
                Add anyway and profile
              </Action>
              <Action onClick={onEdit} variant="secondary">Try Again</Action>
            </>
          }
        />
      )}

      {result.state === 'private' && (
        <Outcome
          tone="warn" icon="lock" title="Private Account Detected"
          body="The account exists, but it is private — only the basic information below is readable. Profiling will store what is public and leave the rest empty rather than estimating it."
          preview={result.account}
          actions={
            <>
              <Action onClick={() => onStartProfiling(result.account)} variant="primary" busy={submitting}>
                Continue with Limited Data
              </Action>
              <Action onClick={onCancel} variant="secondary">Cancel</Action>
            </>
          }
        />
      )}

      {result.state === 'new' && (
        <Outcome
          tone="good" icon="person_add" title="New Creator Detected"
          body="This creator is not in your database yet and is ready to be profiled."
          preview={result.account}
          notes={result.knownElsewhere.map(k => k.label)}
          actions={
            <Action onClick={() => onStartProfiling(result.account)} variant="primary" busy={submitting}>
              Start Profiling
            </Action>
          }
        />
      )}

      {result.state === 'exists' && (
        <Outcome
          tone="info" icon="how_to_reg" title="This creator already exists in your database"
          body={
            result.existing.profilingStatus === 'ready'
              ? 'It has already been profiled, so nothing new will be created. Open it, or refresh its data.'
              : `Profiling is ${result.existing.profilingStatus}. Nothing new will be created.`
          }
          preview={{
            platform: result.account.platform,
            username: result.existing.username,
            profileUrl: result.account.profileUrl,
            displayName: result.existing.displayName,
            avatarUrl: result.existing.avatarUrl,
            followers: result.existing.followers,
            visibility: result.account.visibility,
          }}
          notes={[
            result.existing.category ? `Category: ${result.existing.category}` : null,
            result.existing.erPct !== null ? `Engagement rate: ${result.existing.erPct.toFixed(2)}%` : null,
            result.existing.lastRefreshedAt
              ? `Last updated ${new Date(result.existing.lastRefreshedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`
              : 'Never refreshed',
          ].filter((n): n is string => !!n)}
          actions={
            <>
              <Action onClick={() => onViewExisting(result.existing.id)} variant="primary">View Existing Profile</Action>
              <Action onClick={() => onRefreshExisting(result.existing.id)} variant="secondary">Refresh Profile Data</Action>
            </>
          }
        />
      )}

      {error && (
        <div className="rounded-lg bg-[#fdf2f2] border border-[#f3d9d9] px-3 py-2 text-[11.5px] text-[#a04545]">
          {error}
        </div>
      )}
    </div>
  )
}

/** The five checks with what each one actually found. */
function StepReport({ steps }: { steps: FlowStep[] }) {
  const ICON: Record<FlowStep['state'], { icon: string; color: string }> = {
    done: { icon: 'check_circle', color: '#3d8a5f' },
    skipped: { icon: 'remove_circle', color: '#b5761f' },
    failed: { icon: 'cancel', color: '#a04545' },
    running: { icon: 'progress_activity', color: '#327488' },
    pending: { icon: 'radio_button_unchecked', color: '#d1d5db' },
  }
  return (
    <ol className="rounded-xl border border-[#f3f4f6] bg-[#f9fafb] px-3.5 py-3 flex flex-col gap-2">
      {steps.map(s => {
        const look = ICON[s.state] ?? ICON.pending
        return (
          <li key={s.key} className="flex items-start gap-2">
            <span className="material-symbols-outlined text-[15px] mt-px" style={{ color: look.color }}>
              {look.icon}
            </span>
            <span className="min-w-0">
              <span style={PJ} className="text-[11.5px] font-bold text-[#374151]">{s.label}</span>
              {s.detail && <span className="block text-[11px] text-[#9ca3af] leading-snug">{s.detail}</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

const TONE: Record<'good' | 'warn' | 'bad' | 'info', { bg: string; fg: string; border: string }> = {
  good: { bg: '#eaf5ef', fg: '#3d8a5f', border: '#cde5d7' },
  warn: { bg: '#fdf3e7', fg: '#b5761f', border: '#f0dcc0' },
  bad: { bg: '#fdf2f2', fg: '#a04545', border: '#f3d9d9' },
  info: { bg: '#f0f7fa', fg: '#285D6E', border: '#cfe3ea' },
}

function Outcome({
  tone, icon, title, body, preview, notes, actions,
}: {
  tone: keyof typeof TONE
  icon: string
  title: string
  body: string
  preview?: AccountPreview
  notes?: string[]
  actions: React.ReactNode
}) {
  const t = TONE[tone]
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: t.border }}>
      <div className="px-4 py-3 flex items-start gap-2.5" style={{ background: t.bg }}>
        <span className="material-symbols-outlined text-[19px]" style={{ color: t.fg }}>{icon}</span>
        <div className="min-w-0">
          <h3 style={{ ...PJ, color: t.fg }} className="text-[13px] font-extrabold">{title}</h3>
          <p className="text-[11.5px] text-[#6b7280] mt-0.5 leading-snug">{body}</p>
        </div>
      </div>

      {preview && <AccountCard account={preview} />}

      {!!notes?.length && (
        <ul className="px-4 pt-3 flex flex-col gap-1.5">
          {notes.map(n => (
            <li key={n} className="flex items-start gap-1.5 text-[11.5px] text-[#6b7280]">
              <span className="material-symbols-outlined text-[13px] text-[#9ca3af] mt-px">info</span>
              {n}
            </li>
          ))}
        </ul>
      )}

      <div className="px-4 py-3 flex items-center justify-end gap-2 flex-wrap">{actions}</div>
    </div>
  )
}

/** The basic information the platform gave us, before anything is stored. */
function AccountCard({ account }: { account: AccountPreview }) {
  const stats: [string, string][] = [
    account.followers !== null && account.followers !== undefined ? ['Followers', fmtNum(account.followers)] : null,
    account.following !== null && account.following !== undefined ? ['Following', fmtNum(account.following)] : null,
    account.postsCount !== null && account.postsCount !== undefined ? ['Posts', fmtNum(account.postsCount)] : null,
  ].filter((s): s is [string, string] => !!s)

  return (
    <div className="px-4 pt-3 flex items-start gap-3">
      <div className="w-11 h-11 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0"
        style={{ background: T.gradient }}>
        <RosterAvatar src={account.avatarUrl ?? null} username={account.username} textClass="text-[13px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span style={PJ} className="text-[13px] font-extrabold text-[#111827] truncate">
            {account.displayName || `@${account.username}`}
          </span>
          {account.verified && (
            <span className="material-symbols-outlined text-[14px] text-[#4E96AC]" title="Verified">verified</span>
          )}
          <span className={`inline-flex items-center gap-1 rounded-md text-[9px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 ${
            account.visibility === 'private' ? 'bg-[#fdf3e7] text-[#b5761f]'
              : account.visibility === 'public' ? 'bg-[#eaf5ef] text-[#3d8a5f]'
              : 'bg-[#f3f4f6] text-[#9ca3af]'
          }`}>
            {account.visibility}
          </span>
        </div>
        <a href={account.profileUrl} target="_blank" rel="noreferrer"
          className="text-[11.5px] text-[#6b7280] hover:text-[#285D6E] hover:underline break-all">
          {platformLabel(account.platform)} · @{account.username}
        </a>
        {account.bio && <p className="text-[11px] text-[#9ca3af] mt-1 line-clamp-2">{account.bio}</p>}
        {!!stats.length && (
          <div className="flex items-center gap-4 mt-2">
            {stats.map(([label, v]) => (
              <span key={label} className="flex flex-col">
                <span style={PJ} className="text-[13px] font-extrabold text-[#111827] tabular-nums">{v}</span>
                <span className="text-[9.5px] uppercase tracking-wider text-[#9ca3af] font-bold">{label}</span>
              </span>
            ))}
          </div>
        )}
        {!stats.length && (
          <p className="text-[11px] text-[#9ca3af] mt-1">
            This platform publishes no figures before profiling — they are read from the account during the run.
          </p>
        )}
      </div>
    </div>
  )
}

function Action({
  children, onClick, variant, busy,
}: { children: React.ReactNode; onClick: () => void; variant: 'primary' | 'secondary'; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={PJ}
      className={`inline-flex items-center gap-1.5 rounded-lg text-[12px] font-bold px-3.5 h-9 border transition-colors ${
        busy ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
      } ${
        variant === 'primary'
          ? 'bg-[#327488] border-[#327488] text-white hover:bg-[#285D6E]'
          : 'bg-white border-[#e5e7eb] text-[#374151] hover:bg-[#f9fafb]'
      }`}
    >
      {busy && <span className="material-symbols-outlined text-[15px] animate-spin">progress_activity</span>}
      {children}
    </button>
  )
}
