'use client'

/**
 * Add New KOL — the intake flow for the commercial KOL Directory
 * (`public.kol_directory`, ~7.7k rows, a database separate from this org's).
 *
 * Deliberately a sibling of `AddCreatorModal`, not a variant of it: that modal
 * writes into an organization's own `discover_creators` table through a
 * multi-step profiling pipeline (visibility check, private/public branches,
 * "known elsewhere" notes) — a different table, a different backend, a
 * different owner for the data. This one does one thing: confirm a username or
 * URL is a real, not-yet-listed Instagram or TikTok account, then hand it to
 * the roster to scrape and store. The visual language (PJ/TOKENS, the 3-phase
 * rail, the outcome card) is copied because the two flows should *feel* like
 * one product, but the components stay separate because their data, contracts
 * and lifecycles do not overlap.
 *
 * Four phases: paste a handle, run the check, act on what came back, then —
 * for a `new` account that was just confirmed added — watch it actually get
 * scraped. That last phase polls `GET /api/kol-directory/add/[kolId]/status`,
 * which reads the per-step log tables `addKolScrape.ts` writes
 * (`add_kol_scrape_log`, `add_kol_pipeline_log`) and returns a fixed,
 * platform-specific list of steps with live status — this dialog renders
 * that list, not a generic spinner, and only calls `onKolAdded` once the
 * whole pipeline reports success.
 */

import { useEffect, useRef, useState } from 'react'
import { PJ, TOKENS as T, fmtNum, RosterAvatar } from './ui'
import { parseCreatorInput, platformLabel, platformOfUrl, type CreatorPlatform } from '@/lib/discover/creatorInput'

/** Only the two platforms the commercial roster actually scrapes. */
const KOL_DIR_PLATFORMS: { id: CreatorPlatform; label: string; icon: string; handleExample: string; urlExample: string }[] = [
  { id: 'instagram', label: 'Instagram', icon: 'photo_camera', handleExample: '@raditya_dika', urlExample: 'https://instagram.com/raditya_dika' },
  { id: 'tiktok', label: 'TikTok', icon: 'music_note', handleExample: '@radityadika', urlExample: 'https://tiktok.com/@radityadika' },
]

type Phase = 'input' | 'checking' | 'result' | 'progress'

type StepStatus = 'pending' | 'running' | 'success' | 'failed'

interface StatusStep {
  key: string
  label: string
  kind: 'scrape' | 'pipeline'
  status: StepStatus
  detail?: string | null
}

interface StatusResponse {
  runId: string | null
  overallStatus: StepStatus
  steps: StatusStep[]
  kolDirectory: {
    id: string
    username: string | null
    scrapeStatus: string
    followersCount: number | null
    lastRefreshedAt: string | null
  }
}

const STATUS_POLL_INTERVAL_MS = 2_000

interface AccountPreview {
  platform: string
  username: string
  profileUrl: string
  displayName: string | null
  avatarUrl: string | null
  bio: string | null
  followers: number | null
  /** Set when this handle already has a roster row that was never scraped
   *  through to follower data — see `addKolCheck.ts`. Threaded straight
   *  through to `/api/kol-directory/add` so it reuses that row instead of
   *  creating a duplicate. */
  existingKolDirectoryId?: string | null
  existingSocialAccountId?: string | null
}

interface ExistingKol {
  id: string
  username: string
  scrapeStatus: string | null
  followersCount: number | null
  lastRefreshedAt: string | null
}

type CheckResult =
  | { state: 'invalid_input'; message: string }
  | { state: 'already_in_directory'; kol: ExistingKol }
  | { state: 'not_found'; message: string }
  | { state: 'unverified'; message: string }
  | { state: 'new'; account: AccountPreview }

export interface AddKolDirectoryModalProps {
  /** Dismiss without adding anybody. */
  onClose: () => void
  /** The KOL was created in the directory (scraping continues in the background). */
  onKolAdded: (kolDirectoryId: string) => void
  /** A handle or profile URL to open on, for a link that arrived from elsewhere. */
  initialInput?: string | null
}

export default function AddKolDirectoryModal({ onClose, onKolAdded, initialInput }: AddKolDirectoryModalProps) {
  const [platform, setPlatform] = useState<CreatorPlatform>(
    () => {
      const p = initialInput ? platformOfUrl(initialInput) : null
      return p === 'instagram' || p === 'tiktok' ? p : 'instagram'
    },
  )
  const [value, setValue] = useState(initialInput ?? '')
  const [phase, setPhase] = useState<Phase>('input')
  const [result, setResult] = useState<CheckResult | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [added, setAdded] = useState<{ id: string; username: string } | null>(null)
  const [progress, setProgress] = useState<StatusResponse | null>(null)
  const [progressError, setProgressError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    if (initialInput) inputRef.current?.select()
  }, [initialInput])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !submitting) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, submitting])

  const parsed = value.trim() ? parseCreatorInput(platform, value) : null
  const localProblem = parsed && !parsed.ok ? parsed : null

  function submit() {
    if (parsed?.ok) return runCheck()
    setError(localProblem?.message ?? 'Masukkan username atau URL profil dulu.')
  }

  async function runCheck() {
    setError('')
    setResult(null)
    setPhase('checking')
    try {
      const res = await fetch('/api/kol-directory/add/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, input: value.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'The check could not be completed.')
      setResult(data as CheckResult)
      setPhase('result')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setPhase('input')
    }
  }

  async function addKol(account: AccountPreview) {
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/kol-directory/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: account.platform, username: account.username, profileUrl: account.profileUrl,
          existingKolDirectoryId: account.existingKolDirectoryId ?? null,
          existingSocialAccountId: account.existingSocialAccountId ?? null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'The KOL could not be added.')
      setAdded({ id: data.kolDirectoryId as string, username: account.username })
      setSubmitting(false)
      setProgress(null)
      setProgressError('')
      setPhase('progress')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setSubmitting(false)
    }
  }

  // Poll the per-step status endpoint while the scrape runs in the
  // background. Stops itself once the whole pipeline succeeds (and hands
  // off to the parent) or fails (the failure is shown, never auto-retried).
  useEffect(() => {
    if (phase !== 'progress' || !added) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function poll() {
      try {
        const res = await fetch(`/api/kol-directory/add/${added!.id}/status`)
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(data?.error || 'Could not load progress.')
        setProgressError('')
        setProgress(data as StatusResponse)
        if (data.overallStatus === 'success') {
          onKolAdded(added!.id)
          return
        }
        if (data.overallStatus === 'failed') return
        timer = setTimeout(poll, STATUS_POLL_INTERVAL_MS)
      } catch (err) {
        if (cancelled) return
        setProgressError(err instanceof Error ? err.message : 'Could not load progress.')
        timer = setTimeout(poll, STATUS_POLL_INTERVAL_MS)
      }
    }

    poll()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, added])

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
              Add a KOL to the directory by username or profile URL. We check the account
              exists and is not already listed before anything is stored.
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
              onAdd={addKol}
              onCancel={onClose}
            />
          )}

          {phase === 'progress' && added && (
            <ProgressPhase
              username={added.username}
              progress={progress}
              error={progressError}
              onDone={onClose}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/* ── phase rail ───────────────────────────────────────────────────────────── */

const PHASES: { id: Phase; label: string }[] = [
  { id: 'input', label: 'Account' },
  { id: 'checking', label: 'Validation' },
  { id: 'result', label: 'Result' },
  { id: 'progress', label: 'Scraping' },
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
  platform, onPlatform, value, onValue, inputRef, problem, error, onSubmit, canSubmit,
}: {
  platform: CreatorPlatform
  onPlatform: (p: CreatorPlatform) => void
  value: string
  onValue: (v: string) => void
  inputRef: React.RefObject<HTMLInputElement | null>
  problem: string | null
  error: string
  onSubmit: () => void
  canSubmit: boolean
}) {
  const def = KOL_DIR_PLATFORMS.find(p => p.id === platform)!
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={e => { e.preventDefault(); onSubmit() }}
    >
      <div className="flex flex-col gap-2">
        <label style={PJ} className="text-[10.5px] font-bold uppercase tracking-widest text-[#6b7280]">
          Platform
        </label>
        <div className="grid grid-cols-2 gap-2">
          {KOL_DIR_PLATFORMS.map(p => {
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
        <label style={PJ} htmlFor="kol-directory-handle"
          className="text-[10.5px] font-bold uppercase tracking-widest text-[#6b7280]">
          Username or profile URL
        </label>
        <input
          id="kol-directory-handle"
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
            <span>{problem}</span>
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

const CHECK_STEPS = [
  { key: 'exists', label: 'Confirming the account exists' },
  { key: 'duplicate', label: 'Checking it is not already in the directory' },
]

function CheckingPhase() {
  const [active, setActive] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => {
      setActive(i => Math.min(i + 1, CHECK_STEPS.length - 1))
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
        {CHECK_STEPS.map((s, i) => {
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
        This runs through a scraper, which can take a moment.
      </p>
    </div>
  )
}

/* ── 3. result ────────────────────────────────────────────────────────────── */

function ResultPhase({
  result, submitting, error, onEdit, onAdd, onCancel,
}: {
  result: CheckResult
  submitting: boolean
  error: string
  onEdit: () => void
  onAdd: (a: AccountPreview) => void
  onCancel: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {result.state === 'invalid_input' && (
        <Outcome
          tone="warn" icon="link_off" title="Invalid input"
          body={result.message}
          actions={<Action onClick={onEdit} variant="primary">Edit</Action>}
        />
      )}

      {result.state === 'not_found' && (
        <Outcome
          tone="bad" icon="person_off" title="Username not available"
          body={result.message}
          actions={<Action onClick={onEdit} variant="primary">Try Again</Action>}
        />
      )}

      {result.state === 'unverified' && (
        <Outcome
          tone="warn" icon="cloud_off" title="Could not confirm the account"
          body={result.message}
          actions={<Action onClick={onEdit} variant="primary">Coba Lagi</Action>}
        />
      )}

      {result.state === 'already_in_directory' && (
        <Outcome
          tone="info" icon="how_to_reg" title="KOL sudah ada di directory"
          body={`@${result.kol.username} is already listed in the KOL directory. Nothing new will be created.`}
          notes={[
            result.kol.followersCount !== null ? `Followers: ${fmtNum(result.kol.followersCount)}` : null,
            result.kol.scrapeStatus ? `Scrape status: ${result.kol.scrapeStatus}` : 'Scrape status: unknown',
            result.kol.lastRefreshedAt
              ? `Last updated ${new Date(result.kol.lastRefreshedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`
              : 'Never refreshed',
          ].filter((n): n is string => !!n)}
          actions={<Action onClick={onCancel} variant="primary">Close</Action>}
        />
      )}

      {result.state === 'new' && (
        <Outcome
          tone="good" icon="person_add" title="New KOL Detected"
          body={
            result.account.existingKolDirectoryId
              ? 'This handle has a directory row already, but it was never scraped through to follower data. Adding it will scrape into that existing row rather than creating a duplicate.'
              : 'This account is not in the directory yet and is ready to be added.'
          }
          notes={result.account.existingKolDirectoryId ? ['Belum pernah discrape penuh'] : undefined}
          preview={result.account}
          actions={
            <Action onClick={() => onAdd(result.account)} variant="primary" busy={submitting}>
              Add to Directory
            </Action>
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

/* ── 4. progress ──────────────────────────────────────────────────────────── */

/** Icon and colour per step status, matching the palette `Outcome`/`TONE`
 *  already use elsewhere in this file. */
const STEP_ICON: Record<StepStatus, { icon: string; color: string; spin?: boolean }> = {
  success: { icon: 'check_circle', color: '#3d8a5f' },
  failed: { icon: 'cancel', color: '#a04545' },
  running: { icon: 'progress_activity', color: '#327488', spin: true },
  pending: { icon: 'radio_button_unchecked', color: '#d1d5db' },
}

function ProgressPhase({
  username, progress, error, onDone,
}: {
  username: string
  progress: StatusResponse | null
  error: string
  onDone: () => void
}) {
  const overall = progress?.overallStatus ?? 'running'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {overall === 'failed' ? (
          <span className="material-symbols-outlined text-[18px] text-[#a04545]">error</span>
        ) : (
          <span className="material-symbols-outlined text-[18px] text-[#4E96AC] animate-spin">progress_activity</span>
        )}
        <span style={PJ} className={`text-[13px] font-bold ${overall === 'failed' ? 'text-[#a04545]' : 'text-[#285D6E]'}`}>
          {overall === 'failed' ? `Menambahkan @${username} gagal` : `Menambahkan @${username} ke directory…`}
        </span>
      </div>

      <ol className="rounded-xl border border-[#f3f4f6] bg-[#f9fafb] px-3.5 py-3 flex flex-col gap-2">
        {progress
          ? progress.steps.map(s => {
              const look = STEP_ICON[s.status] ?? STEP_ICON.pending
              return (
                <li key={s.key} className="flex items-start gap-2">
                  <span
                    className={`material-symbols-outlined text-[15px] mt-px ${look.spin ? 'animate-spin' : ''}`}
                    style={{ color: look.color }}
                  >
                    {look.icon}
                  </span>
                  <span className="min-w-0">
                    <span style={PJ} className="text-[11.5px] font-bold text-[#374151]">{s.label}</span>
                    {s.detail && <span className="block text-[11px] text-[#9ca3af] leading-snug">{s.detail}</span>}
                  </span>
                </li>
              )
            })
          : (
            <li className="flex items-center gap-2 text-[11.5px] text-[#9ca3af]">
              <span className="material-symbols-outlined text-[15px] animate-spin">progress_activity</span>
              Loading progress…
            </li>
          )}
      </ol>

      {error && (
        <div className="rounded-lg bg-[#fdf3e7] border border-[#f0dcc0] px-3 py-2 text-[11.5px] text-[#b5761f]">
          {error} — retrying…
        </div>
      )}

      {overall === 'failed' ? (
        <div className="flex items-center justify-end gap-2 pt-1 border-t border-[#f3f4f6]">
          <Action onClick={onDone} variant="primary">Close</Action>
        </div>
      ) : (
        <p className="text-[11px] text-[#9ca3af] border-t border-[#f3f4f6] pt-3">
          This can take a minute or two — you can close this dialog and the KOL will keep being added in the background.
        </p>
      )}
    </div>
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
        </div>
        <a href={account.profileUrl} target="_blank" rel="noreferrer"
          className="text-[11.5px] text-[#6b7280] hover:text-[#285D6E] hover:underline break-all">
          {platformLabel(account.platform)} · @{account.username}
        </a>
        {account.bio && <p className="text-[11px] text-[#9ca3af] mt-1 line-clamp-2">{account.bio}</p>}
        {account.followers !== null && account.followers !== undefined && (
          <div className="flex items-center gap-4 mt-2">
            <span className="flex flex-col">
              <span style={PJ} className="text-[13px] font-extrabold text-[#111827] tabular-nums">
                {fmtNum(account.followers)}
              </span>
              <span className="text-[9.5px] uppercase tracking-wider text-[#9ca3af] font-bold">Followers</span>
            </span>
          </div>
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
