'use client'

/**
 * One creator's full profile, and the monitoring that keeps it from going stale.
 *
 * The profile and the monitoring live on one screen because they answer one
 * question together: what do we know about this creator, and how long ago did we
 * learn it. Splitting them would let a page show a two-month-old engagement rate
 * with nothing beside it saying so.
 *
 * Every figure comes from `discover_creators` and its snapshots — measured
 * during a profiling run, never estimated. A field profiling could not read is
 * drawn as "not measured" rather than as a zero, and the run log at the bottom
 * says which step failed or was skipped and why.
 */

import { useCallback, useEffect, useState } from 'react'
import { PJ, TOKENS as T, fmtNum, RosterAvatar } from './ui'
import { StatTile, TrendChart } from './kolViz'
import { platformLabel } from '@/lib/discover/creatorInput'
import { PROFILING_STEPS, VISIBILITY_LABEL, type CreatorProfile, type FlowStep } from '@/lib/discover/creatorFlow'

export interface CreatorDetailProps {
  orgId: string
  creatorId: string
  onBack: () => void
  onFollowRun: (creatorId: string) => void
  onFindSimilar: (creatorId: string) => void
  onDeleted: () => void
}

export default function CreatorDetail({
  orgId, creatorId, onBack, onFollowRun, onFindSimilar, onDeleted,
}: CreatorDetailProps) {
  const [creator, setCreator] = useState<CreatorProfile | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'refresh' | 'monitor' | 'delete' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/creators/${creatorId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'The creator could not be loaded.')
      setCreator(data.creator as CreatorProfile)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }, [orgId, creatorId])

  useEffect(() => { load() }, [load])

  async function refresh() {
    setBusy('refresh')
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/creators/${creatorId}/refresh`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'The refresh could not be started.')
      // The run takes minutes, so the progress screen is where it is watched —
      // this page would otherwise sit on a stale profile with a spinner.
      onFollowRun(creatorId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(null)
    }
  }

  async function toggleMonitoring() {
    if (!creator) return
    setBusy('monitor')
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/creators/${creatorId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitoringEnabled: !creator.monitoringEnabled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'The change could not be saved.')
      setCreator(data.creator as CreatorProfile)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    setBusy('delete')
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/creators/${creatorId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json())?.error || 'The creator could not be removed.')
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setBusy(null)
    }
  }

  if (!creator) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-2">
        <span className="material-symbols-outlined text-[26px] text-[#A7C8D4] animate-spin">progress_activity</span>
        <span className="text-[12px] text-[#9ca3af]">{error || 'Loading the creator…'}</span>
        {error && (
          <button type="button" onClick={onBack} style={PJ}
            className="text-[12px] font-bold text-[#285D6E] underline mt-2 cursor-pointer">
            Back to My Creators
          </button>
        )}
      </div>
    )
  }

  const c = creator
  const content = c.content
  const inFlight = c.profilingStatus === 'running' || c.profilingStatus === 'queued'

  return (
    <div className="max-w-[1100px]">
      {/* ── identity ───────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[#e5e7eb] bg-white overflow-hidden mb-4" style={{ boxShadow: T.shadow }}>
        <div className="h-16" style={{ background: T.gradient }} />
        <div className="px-5 pb-4 -mt-8 flex items-end justify-between gap-4 flex-wrap">
          <div className="flex items-end gap-3.5 min-w-0">
            <div className="w-[68px] h-[68px] rounded-2xl overflow-hidden border-4 border-white flex items-center justify-center flex-shrink-0"
              style={{ background: T.gradient }}>
              <RosterAvatar src={c.avatarUrl} username={c.username} textClass="text-[20px]" />
            </div>
            <div className="min-w-0 pb-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h2 style={PJ} className="text-[18px] font-extrabold text-[#111827] tracking-[-0.02em] truncate">
                  {c.displayName || `@${c.username}`}
                </h2>
                {c.verified && <span className="material-symbols-outlined text-[16px] text-[#4E96AC]" title="Verified">verified</span>}
              </div>
              <div className="flex items-center gap-1.5 text-[12px] text-[#6b7280] flex-wrap">
                <span>{platformLabel(c.platform)} · @{c.username}</span>
                {c.profileUrl && (
                  <a href={c.profileUrl} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-[#285D6E] hover:underline">
                    open profile
                    <span className="material-symbols-outlined text-[13px]">open_in_new</span>
                  </a>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <Tag>{VISIBILITY_LABEL[c.visibility]}</Tag>
                {c.category && <Tag tone="teal">{c.category}</Tag>}
                {c.tier && <Tag tone="teal">{c.tier}</Tag>}
                {c.city && <Tag>{c.city}</Tag>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap pb-1">
            <Action icon="arrow_back" label="Back" onClick={onBack} />
            {inFlight ? (
              <Action icon="timeline" label="Follow run" onClick={() => onFollowRun(c.id)} primary />
            ) : (
              <Action icon="refresh" label="Refresh Data" onClick={refresh} busy={busy === 'refresh'} primary />
            )}
            <Action
              icon={c.monitoringEnabled ? 'notifications_active' : 'notifications_off'}
              label={c.monitoringEnabled ? 'Monitoring on' : 'Monitoring paused'}
              onClick={toggleMonitoring}
              busy={busy === 'monitor'}
            />
            <Action icon="hub" label="Find similar" onClick={() => onFindSimilar(c.id)} />
            <Action icon="delete" label="Remove" onClick={() => setConfirmDelete(true)} />
          </div>
        </div>

        {c.bio && (
          <p className="px-5 pb-4 text-[12px] text-[#6b7280] leading-relaxed max-w-[80ch]">{c.bio}</p>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-[#fdf2f2] border border-[#f3d9d9] px-3 py-2 text-[11.5px] text-[#a04545] mb-4">
          {error}
        </div>
      )}

      {/* ── measured figures ───────────────────────────────────────────── */}
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))] mb-4">
        <StatTile label="Followers" value={c.followers !== null ? fmtNum(c.followers) : 'not measured'} />
        <StatTile label="Engagement rate" value={c.erPct !== null ? `${c.erPct.toFixed(2)}%` : 'not measured'}
          hint={c.erPct !== null ? 'interactions per post ÷ followers' : undefined} />
        <StatTile label="Avg. likes" value={c.avgLikes !== null ? fmtNum(c.avgLikes) : 'not measured'} />
        <StatTile label="Avg. comments" value={c.avgComments !== null ? fmtNum(c.avgComments) : 'not measured'} />
        <StatTile label="Avg. views" value={c.avgViews !== null ? fmtNum(c.avgViews) : 'not measured'} />
        <StatTile label="Posts" value={c.postsCount !== null ? fmtNum(c.postsCount) : 'not measured'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-4">
        <div className="flex flex-col gap-4">
          {/* ── content characteristics ────────────────────────────────── */}
          <Panel title="Content characteristics"
            subtitle={content
              ? `From ${content.postsAnalyzed} posts in the last ${content.windowDays} days`
              : 'Nothing analysed yet'}>
            {content ? (
              <>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <MiniStat label="Posting cadence"
                    value={content.postsPerWeek !== null ? `${content.postsPerWeek}/week` : null} />
                  <MiniStat label="Most active hour"
                    value={content.peakHour !== null ? `${String(content.peakHour).padStart(2, '0')}:00 WIB` : null} />
                </div>

                {!!content.formats.length && (
                  <div className="mb-4">
                    <Label>Formats</Label>
                    <div className="flex h-2.5 rounded-full overflow-hidden bg-[#f3f4f6] mb-2">
                      {content.formats.map((f, i) => (
                        <span key={f.label} style={{
                          width: `${f.share}%`,
                          background: ['#327488', '#4E96AC', '#A7C8D4', '#cfe3ea'][i % 4],
                        }} />
                      ))}
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      {content.formats.map((f, i) => (
                        <span key={f.label} className="inline-flex items-center gap-1.5 text-[11.5px] text-[#6b7280]">
                          <span className="w-2 h-2 rounded-full"
                            style={{ background: ['#327488', '#4E96AC', '#A7C8D4', '#cfe3ea'][i % 4] }} />
                          {f.label} <span className="font-bold text-[#374151]">{f.share}%</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {!!content.hashtags.length && (
                  <div className="mb-4">
                    <Label>Recurring hashtags</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {content.hashtags.map(h => (
                        <span key={h.tag} style={PJ}
                          className="inline-flex items-center gap-1 rounded-full bg-[#f0f7fa] text-[#285D6E] text-[11px] font-bold px-2 py-0.5">
                          {h.tag}
                          <span className="text-[9.5px] text-[#4E96AC]">×{h.count}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {!!content.topPosts.length && (
                  <div>
                    <Label>Top posts by engagement</Label>
                    <ul className="flex flex-col gap-2">
                      {content.topPosts.map((p, i) => (
                        <li key={p.url ?? i} className="rounded-xl border border-[#f3f4f6] px-3 py-2.5">
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-[11.5px] text-[#6b7280] line-clamp-2 min-w-0">
                              {p.caption || 'No caption'}
                            </p>
                            {p.url && (
                              <a href={p.url} target="_blank" rel="noreferrer"
                                className="material-symbols-outlined text-[15px] text-[#9ca3af] hover:text-[#285D6E] flex-shrink-0">
                                open_in_new
                              </a>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1.5 text-[10.5px] text-[#9ca3af]">
                            {p.likes !== null && <span>{fmtNum(p.likes)} likes</span>}
                            {p.comments !== null && <span>{fmtNum(p.comments)} comments</span>}
                            {p.views !== null && <span>{fmtNum(p.views)} views</span>}
                            {p.date && <span>{new Date(p.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p className="text-[12px] text-[#9ca3af]">
                {c.visibility === 'private'
                  ? 'This account is private, so its posts cannot be read. Followers and identity are all that profiling could collect.'
                  : 'No posts were readable in the profiling window. Refresh once the creator has published something recent.'}
              </p>
            )}
          </Panel>

          {/* ── monitoring history ─────────────────────────────────────── */}
          <Panel title="Monitoring"
            subtitle={c.monitoringEnabled
              ? 'Every completed run adds a point here, so growth stays visible across refreshes.'
              : 'Monitoring is paused — refreshes still work, they just are not expected.'}>
            {c.history.length > 1 ? (
              <TrendChart
                points={c.history
                  .filter(h => h.followers !== null)
                  .map(h => ({
                    x: new Date(h.capturedOn).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
                    y: h.followers as number,
                  }))}
                format={n => fmtNum(n)}
                label="Followers"
              />
            ) : (
              <p className="text-[12px] text-[#9ca3af]">
                One data point so far, recorded {c.lastRefreshedAt
                  ? new Date(c.lastRefreshedAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })
                  : 'when the creator was profiled'}. A trend needs a second refresh — nothing is drawn from a single point.
              </p>
            )}

            {c.history.length > 0 && (
              <div className="overflow-x-auto mt-4">
                <table className="w-full text-[11.5px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-[#9ca3af]">
                      <th className="py-1.5 font-bold">Date</th>
                      <th className="py-1.5 font-bold text-right">Followers</th>
                      <th className="py-1.5 font-bold text-right">ER</th>
                      <th className="py-1.5 font-bold text-right">Avg. likes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...c.history].reverse().slice(0, 8).map(h => (
                      <tr key={h.capturedOn} className="border-t border-[#f3f4f6]">
                        <td className="py-1.5 text-[#6b7280]">
                          {new Date(h.capturedOn).toLocaleDateString('en-GB', { dateStyle: 'medium' })}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-[#374151]">
                          {h.followers !== null ? fmtNum(h.followers) : '—'}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-[#374151]">
                          {h.erPct !== null ? `${h.erPct.toFixed(2)}%` : '—'}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-[#374151]">
                          {h.avgLikes !== null ? fmtNum(h.avgLikes) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        {/* ── the run that produced this ───────────────────────────────── */}
        <aside className="flex flex-col gap-4">
          <Panel title="Data status" subtitle={null}>
            <Field label="Profiling" value={c.profilingStatus} />
            <Field label="Last updated" value={c.lastRefreshedAt
              ? new Date(c.lastRefreshedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
              : null} />
            <Field label="Added" value={new Date(c.createdAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })} />
            <Field label="Monitoring" value={c.monitoringEnabled ? 'active' : 'paused'} />
            <Field label="Visibility" value={VISIBILITY_LABEL[c.visibility]} />
            {c.profilingError && (
              <p className="mt-2 rounded-lg bg-[#fdf2f2] border border-[#f3d9d9] px-2.5 py-1.5 text-[11px] text-[#a04545]">
                {c.profilingError}
              </p>
            )}
          </Panel>

          <Panel title="Last profiling run"
            subtitle={c.run
              ? `${c.run.kind === 'refresh' ? 'Refresh' : 'First run'} · ${new Date(c.run.startedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`
              : 'No run recorded yet'}>
            <ol className="flex flex-col gap-2">
              {PROFILING_STEPS.map(def => {
                const step: FlowStep = c.run?.steps.find(s => s.key === def.key)
                  ?? { key: def.key, label: def.label, state: 'pending', detail: null, at: null }
                const look = {
                  done: { icon: 'check_circle', color: '#3d8a5f' },
                  skipped: { icon: 'remove_circle', color: '#b5761f' },
                  failed: { icon: 'cancel', color: '#a04545' },
                  running: { icon: 'progress_activity', color: '#327488' },
                  pending: { icon: 'radio_button_unchecked', color: '#d1d5db' },
                }[step.state]
                return (
                  <li key={def.key} className="flex items-start gap-2">
                    <span className="material-symbols-outlined text-[14px] mt-px" style={{ color: look.color }}>
                      {look.icon}
                    </span>
                    <span className="min-w-0">
                      <span style={PJ} className="text-[11.5px] font-bold text-[#374151]">{step.label}</span>
                      {step.detail && <span className="block text-[10.5px] text-[#9ca3af] leading-snug">{step.detail}</span>}
                    </span>
                  </li>
                )
              })}
            </ol>
          </Panel>
        </aside>
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setConfirmDelete(false)} />
          <div className="relative bg-white rounded-2xl w-full max-w-[420px] mx-4 p-5 border border-[#e5e7eb]"
            style={{ boxShadow: T.shadowLg }}>
            <h3 style={PJ} className="text-[14px] font-extrabold text-[#111827]">
              Remove @{c.username} from your database?
            </h3>
            <p className="text-[12px] text-[#6b7280] mt-1.5 leading-snug">
              The profile, its profiling runs and its monitoring history are deleted. The creator can be added again
              later, but the history collected so far does not come back.
            </p>
            <div className="flex items-center justify-end gap-2 mt-4">
              <Action icon="close" label="Cancel" onClick={() => setConfirmDelete(false)} />
              <Action icon="delete" label="Remove creator" onClick={remove} busy={busy === 'delete'} danger />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── pieces ───────────────────────────────────────────────────────────────── */

function Panel({
  title, subtitle, children,
}: { title: string; subtitle: string | null; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#e5e7eb] bg-white p-5" style={{ boxShadow: T.shadow }}>
      <h3 style={PJ} className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af]">{title}</h3>
      {subtitle && <p className="text-[11.5px] text-[#9ca3af] mt-0.5 mb-3.5">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
      {children}
    </section>
  )
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <div style={PJ} className="text-[10px] font-bold uppercase tracking-widest text-[#c4cbd4] mb-2">{children}</div>
)

function MiniStat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-xl bg-[#f9fafb] px-3 py-2.5">
      <div style={PJ} className={`text-[15px] font-extrabold ${value ? 'text-[#111827]' : 'text-[#d1d5db]'}`}>
        {value ?? 'not measured'}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-[#9ca3af] font-bold mt-0.5">{label}</div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-[#f9fafb] last:border-0">
      <span className="text-[11px] text-[#9ca3af]">{label}</span>
      <span style={PJ} className={`text-[12px] font-bold text-right truncate ${value ? 'text-[#374151]' : 'text-[#d1d5db]'}`}>
        {value || 'not recorded'}
      </span>
    </div>
  )
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: 'teal' }) {
  return (
    <span style={PJ} className={`rounded-md text-[9px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 ${
      tone === 'teal' ? 'bg-[#EDF4F7] text-[#285D6E]' : 'bg-[#f3f4f6] text-[#6b7280]'
    }`}>
      {children}
    </span>
  )
}

function Action({
  icon, label, onClick, busy, primary, danger,
}: {
  icon: string; label: string; onClick: () => void
  busy?: boolean; primary?: boolean; danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={PJ}
      className={`inline-flex items-center gap-1.5 rounded-lg text-[11.5px] font-bold px-3 h-8 border transition-colors ${
        busy ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
      } ${
        primary ? 'bg-[#327488] border-[#327488] text-white hover:bg-[#285D6E]'
          : danger ? 'bg-[#fdf2f2] border-[#f3d9d9] text-[#a04545] hover:bg-[#fbe9e9]'
          : 'bg-white border-[#e5e7eb] text-[#374151] hover:bg-[#f9fafb]'
      }`}
    >
      <span className={`material-symbols-outlined text-[15px] ${busy ? 'animate-spin' : ''}`}>
        {busy ? 'progress_activity' : icon}
      </span>
      {label}
    </button>
  )
}
