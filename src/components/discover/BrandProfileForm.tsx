'use client'

/**
 * Brand Profile — the configuration the Brand Match Engine scores against.
 *
 *     Brand Profile → Brand Match Engine → Creator Database → Match Score
 *
 * Everything a brand states here changes how every creator in the Creator
 * Database is ranked, on the next request, with no restart and no cache to
 * clear.
 *
 * ── What this form does NOT contain, and why ───────────────────────────────
 *
 *   **Brand Values.** Absent from Brand Identity by design. The engine's Values
 *   Match scores against a creator-values column that does not exist on the KOL
 *   server, so the whole Brand Personality component is N/A for every creator
 *   and renormalises away. A field that cannot move any score is a field that
 *   wastes the user's time and implies a precision the product does not have.
 *
 *   **Weights, sliders, priorities, totals, reset.** No control here sets how
 *   much a signal is worth. The brand says what it wants; the system decides
 *   what that is worth. A score each user has tuned until it agreed with them
 *   is not a match score.
 *
 * ── Honest about reach ─────────────────────────────────────────────────────
 * Three inputs are sparse on the creator side today, and each says so where it
 * is collected rather than in a footnote. Telling someone their keywords will
 * be searched across 7.400 creators, when bios are filled for ~12% of them, is
 * how a feature earns a complaint it did not deserve.
 *
 * ── Ported from `origin/engkol_v2` ──────────────────────────────────────────
 * Three changes. The Brand Fit inputs `migrations/kol/002` added — brand tone,
 * target age range and performance targets — get fields here; v2 stored them
 * but had no way to enter them. The form never sends `brandId`,
 * `organizationId` or `updatedAt`: the organization comes from the session and
 * `brand_id` is not settable. And nothing claims a score is live, because the
 * Brand Match and Brand Fit engines are not on this branch yet.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Btn, Chip, PJ, Spinner, ErrorState, TOKENS as T } from './ui'
import type { BrandProfile, GenderMajority } from '@/lib/discover/brandMatch/profile'

interface Payload {
  profile: BrandProfile
  scoreable: boolean
  canEdit: boolean
  vocabulary: {
    categories: readonly string[]
    interests: readonly string[]
    genderMajorities: readonly string[]
    whatMatters: readonly { key: string; label: string }[]
  }
}

/**
 * The tiers and platforms the Ideal Creator Profile offers.
 *
 * Hardcoded vocabularies, not hardcoded data: these are the KOL platform's own
 * `kol_tiers` band names and the two platforms `public.platforms` carries for
 * the roster. They are the same values the directory's own filters send, which
 * is what lets "apply my ideal creator profile" become a filter set rather than
 * a second, parallel definition of a tier.
 */
const TIERS = ['Nano', 'Micro', 'Mid-tier', 'Macro', 'Mega']
const PLATFORMS = [{ id: 'instagram', label: 'Instagram' }, { id: 'tiktok', label: 'TikTok' }]

/**
 * Content styles, collected and stored but not scored.
 *
 * `feature.*_post_analysis.content_category` is NULL in all 212 rows, so
 * Content Style Match is N/A for every creator today. The field is here because
 * it is real brand configuration that survives until the column is filled, and
 * the note under it says exactly that — rather than letting a buyer believe a
 * preference is narrowing their results when it is not.
 */
const CONTENT_STYLES = [
  'Tutorial', 'Review', 'Vlog', 'Storytelling', 'Comedy', 'Educational',
  'Unboxing', 'Behind the scenes', 'Testimonial', 'Livestream',
]

const PERSONALITIES = [
  'Playful', 'Premium', 'Warm', 'Bold', 'Minimal', 'Energetic',
  'Trustworthy', 'Youthful', 'Confident', 'Down-to-earth',
]

/**
 * Brand Values, as the prototype lists them. Saved to `brand_profile.brand_values`
 * (migrations/kol/008) together with any custom value typed below them. Stored
 * and shown only — no Brand Match, What Matters or Brand Fit code reads it.
 */
const BRAND_VALUES = [
  'Innovation', 'Trust', 'Authenticity', 'Creativity', 'Community', 'Sustainability',
  'Inclusivity', 'Quality', 'Transparency', 'Accessibility', 'Empowerment',
]

/**
 * The prototype's wording for a What Matters option, where it differs from the
 * criterion label What Matters itself uses. Display only: the key sent and
 * stored is unchanged, and the Brand Match breakdown keeps its own label.
 */
const PROTOTYPE_WM_LABEL: Record<string, string> = {
  strong_community: 'Strong Community',
}

/** Server-owned keys the form must never send. */
const NOT_SENT = ['organizationId', 'brandId', 'updatedAt'] as const

/* ── small inputs ─────────────────────────────────────────────────────────── */

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label style={{ ...PJ, color: T.t2 }} className="block text-[11.5px] font-bold mb-1">{label}</label>
      {hint && <p className="text-[10.5px] leading-snug mb-1.5" style={{ color: T.t4 }}>{hint}</p>}
      {children}
    </div>
  )
}

const inputCls = 'w-full rounded-lg border text-[12px] px-2.5 h-9 outline-none focus:border-[#4E96AC]'
const inputStyle = { borderColor: T.outline, color: T.t1, background: T.surface }

/**
 * A free-text list, edited as chips.
 *
 * Comma and Enter both commit, because people paste comma-separated lists and
 * type one term at a time, and a field that only honours one of those gets one
 * long keyword with commas in it.
 */
function TagInput({
  value, onChange, placeholder, disabled, max = 25,
}: {
  value: string[]; onChange: (v: string[]) => void
  placeholder: string; disabled?: boolean; max?: number
}) {
  const [draft, setDraft] = useState('')

  const commit = (raw: string) => {
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean)
    if (!parts.length) return
    const seen = new Set(value.map(v => v.toLowerCase()))
    const next = [...value]
    for (const p of parts) {
      if (seen.has(p.toLowerCase()) || next.length >= max) continue
      seen.add(p.toLowerCase())
      next.push(p)
    }
    onChange(next)
    setDraft('')
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {value.map(v => (
          <span
            key={v}
            style={{ ...PJ, background: '#f0f7fa', borderColor: '#A7C8D4', color: T.primaryDeep }}
            className="inline-flex items-center gap-1 rounded-full border text-[11px] font-bold px-2.5 h-[24px]"
          >
            {v}
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(value.filter(x => x !== v))}
                className="material-symbols-outlined text-[13px] cursor-pointer opacity-60 hover:opacity-100"
                aria-label={`Remove ${v}`}
              >
                close
              </button>
            )}
          </span>
        ))}
        {!value.length && (
          <span className="text-[11px] italic" style={{ color: T.t4 }}>None yet</span>
        )}
      </div>
      {!disabled && (
        <input
          className={inputCls}
          style={inputStyle}
          placeholder={value.length >= max ? `Limit of ${max} reached` : placeholder}
          disabled={value.length >= max}
          value={draft}
          onChange={e => {
            if (e.target.value.includes(',')) commit(e.target.value)
            else setDraft(e.target.value)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(draft) }
            if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
          }}
          onBlur={() => commit(draft)}
        />
      )}
    </div>
  )
}

function Section({
  icon, title, subtitle, children,
}: { icon: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl border p-4 mb-4"
      style={{ borderColor: T.outline, background: T.surface, boxShadow: T.shadow }}
    >
      <div className="flex items-start gap-2.5 mb-3">
        <span
          className="shrink-0 w-[26px] h-[26px] rounded-lg flex items-center justify-center"
          style={{ background: T.gradient }}
        >
          <span className="material-symbols-outlined text-[15px] text-white">{icon}</span>
        </span>
        <div className="min-w-0">
          <h3 style={{ ...PJ, color: T.t1 }} className="text-[13px] font-extrabold">{title}</h3>
          {subtitle && <p className="text-[10.5px] leading-snug mt-0.5" style={{ color: T.t4 }}>{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

/* ── the form ─────────────────────────────────────────────────────────────── */

export default function BrandProfileForm({ orgId }: { orgId: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [draft, setDraft] = useState<BrandProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/organizations/${orgId}/discover/brand-profile`)
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(new Error(j.error ?? `HTTP ${r.status}`))))
      .then((d: Payload) => { setData(d); setDraft(d.profile) })
      .catch(e => setError(String(e.message ?? e)))
  }, [orgId])

  useEffect(load, [load])

  const set = <K extends keyof BrandProfile>(key: K, value: BrandProfile[K]) => {
    setDraft(d => (d ? { ...d, [key]: value } : d))
    setSaved(null)
  }

  const toggle = (key: 'brandPersonality' | 'brandValues' | 'audienceInterests' | 'preferredCategories'
    | 'preferredPlatforms' | 'preferredTiers' | 'contentStyles' | 'whatMatters', v: string) => {
    setDraft(d => {
      if (!d) return d
      const list = d[key]
      return { ...d, [key]: (list as string[]).includes(v)
        ? (list as string[]).filter(x => x !== v) : [...list, v] }
    })
    setSaved(null)
  }

  const dirty = useMemo(
    () => !!data && !!draft && JSON.stringify(data.profile) !== JSON.stringify(draft),
    [data, draft],
  )

  const save = async () => {
    if (!draft) return
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/brand-profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(
          Object.entries(draft).filter(([k]) => !(NOT_SENT as readonly string[]).includes(k)),
        )),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setData(json); setDraft(json.profile)
      setSaved(new Date().toLocaleTimeString())
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setSaving(false)
    }
  }

  if (error && !data) return <ErrorState message={error} />
  if (!data || !draft) return <Spinner label="Loading brand profile…" />

  const ro = !data.canEdit
  const scoreableNow = !!draft.brandCategory

  return (
    <div className="max-w-[880px]">
      {/* Status strip — what the current profile does to the directory. */}
      <div
        className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5 mb-4"
        style={{
          borderColor: scoreableNow ? '#A7C8D4' : T.outline,
          background: scoreableNow ? '#f0f7fa' : T.surfaceLow,
        }}
      >
        <span
          className="material-symbols-outlined text-[18px]"
          style={{ color: scoreableNow ? T.primary : T.t4 }}
        >
          {scoreableNow ? 'check_circle' : 'info'}
        </span>
        <div className="flex-1 min-w-0">
          <div style={{ ...PJ, color: scoreableNow ? T.primaryDeep : T.t2 }} className="text-[12px] font-bold">
            {scoreableNow
              ? 'Brand category is set — the profile has what matching needs'
              : 'Choose a brand category — it is the one field matching needs'}
          </div>
          <div className="text-[11px] leading-snug" style={{ color: T.t3 }}>
            {scoreableNow
              ? 'Saved to the KOL database. Brand Match and Brand Fit are not switched on yet, so no score reads it today.'
              : 'Without it, creators would be listed but not scored, rather than scored against nothing. Brand Match and Brand Fit are not switched on yet.'}
            {data.profile.updatedAt && ` Last saved ${new Date(data.profile.updatedAt).toLocaleString()}.`}
          </div>
        </div>
      </div>

      {ro && (
        <p className="text-[11px] mb-3 rounded-lg border px-3 py-2"
          style={{ borderColor: T.outline, background: T.surfaceLow, color: T.t3 }}>
          <span className="material-symbols-outlined text-[13px] align-[-2px] mr-1">lock</span>
          Only an organization admin can change the brand profile. Everything below is the saved
          configuration your match scores are computed from.
        </p>
      )}

      {error && (
        <p className="text-[11.5px] mb-3 rounded-lg border px-3 py-2"
          style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#991b1b' }}>{error}</p>
      )}

      {/* ── 1. Company Profile ── */}
      <Section icon="storefront" title="Company Profile">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <Field label="Company / Brand Name">
            <input
              className={inputCls} style={inputStyle} disabled={ro}
              value={draft.brandName ?? ''}
              placeholder="e.g. LumiSkin"
              onChange={e => set('brandName', e.target.value)}
            />
          </Field>
          <Field label="Industry" hint="Saved as the brand category — one of the categories the creator database uses.">
            <select
              className={inputCls} style={inputStyle} disabled={ro}
              value={draft.brandCategory ?? ''}
              onChange={e => set('brandCategory', e.target.value || null)}
            >
              <option value="">Select industry…</option>
              {data.vocabulary.categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Company Website (optional)">
          <input
            className={inputCls} style={inputStyle} disabled={ro}
            value={draft.companyWebsite ?? ''}
            placeholder="e.g. autometric.io"
            onChange={e => set('companyWebsite', e.target.value)}
          />
        </Field>

        <Field label="Company Description">
          <textarea
            className="w-full rounded-lg border text-[12px] px-2.5 py-2 outline-none focus:border-[#4E96AC] min-h-[64px]"
            style={inputStyle} disabled={ro}
            value={draft.brandDescription ?? ''}
            placeholder="What the brand sells, and to whom."
            onChange={e => set('brandDescription', e.target.value)}
          />
        </Field>
      </Section>

      {/* ── 2. Target Audience ── */}
      <Section icon="group" title="Target Audience">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <Field label="Age Range">
            <div className="flex items-center gap-2">
              <input
                type="number" min={0} max={120} className={inputCls} style={inputStyle} disabled={ro}
                value={draft.targetAgeMin ?? ''} placeholder="From, e.g. 18" aria-label="Age from"
                onChange={e => set('targetAgeMin', e.target.value === '' ? null : Number(e.target.value))}
              />
              <span style={{ color: T.t4 }}>–</span>
              <input
                type="number" min={0} max={120} className={inputCls} style={inputStyle} disabled={ro}
                value={draft.targetAgeMax ?? ''} placeholder="To, e.g. 34" aria-label="Age to"
                onChange={e => set('targetAgeMax', e.target.value === '' ? null : Number(e.target.value))}
              />
            </div>
          </Field>
          <Field label="Gender">
            <select
              className={inputCls} style={inputStyle} disabled={ro}
              value={draft.genderMajority}
              onChange={e => set('genderMajority', e.target.value as GenderMajority)}
            >
              {data.vocabulary.genderMajorities.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Primary Locations">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input
              className={inputCls} style={inputStyle} disabled={ro}
              value={draft.targetCountry ?? ''} placeholder="Country, e.g. Indonesia" aria-label="Country"
              onChange={e => set('targetCountry', e.target.value)}
            />
            <input
              className={inputCls} style={inputStyle} disabled={ro}
              value={draft.targetCity ?? ''} placeholder="City, e.g. Jakarta" aria-label="City"
              onChange={e => set('targetCity', e.target.value)}
            />
          </div>
        </Field>

        <Field label="Audience Interests">
          <div className="flex flex-wrap gap-1.5">
            {data.vocabulary.interests.map(i => (
              <Chip
                key={i} label={i} on={draft.audienceInterests.includes(i)}
                onClick={() => { if (!ro) toggle('audienceInterests', i) }}
              />
            ))}
          </div>
        </Field>
      </Section>

      {/* ── 3. Brand Identity ── */}
      <Section icon="auto_awesome" title="Brand Identity">
        <Field label="Brand Personality">
          <div className="flex flex-wrap gap-1.5">
            {PERSONALITIES.map(p => (
              <Chip
                key={p} label={p} on={draft.brandPersonality.includes(p)}
                onClick={() => { if (!ro) toggle('brandPersonality', p) }}
              />
            ))}
          </div>
        </Field>

        <Field label="Brand Values">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {BRAND_VALUES.map(v => (
              <Chip
                key={v} label={v} on={draft.brandValues.includes(v)}
                onClick={() => { if (!ro) toggle('brandValues', v) }}
              />
            ))}
          </div>
          {/* Custom values: anything saved that is not one of the prototype's. */}
          <TagInput
            value={draft.brandValues.filter(v => !BRAND_VALUES.includes(v))} disabled={ro}
            onChange={custom => set('brandValues', [
              ...draft.brandValues.filter(v => BRAND_VALUES.includes(v)), ...custom,
            ])}
            placeholder="Add another value and press Enter"
          />
        </Field>
      </Section>

      {/* ── 4. Ideal Creator Profile ── */}
      <Section icon="person_search" title="Ideal Creator Profile">
        <Field label="Preferred Creator Categories">
          <div className="flex flex-wrap gap-1.5">
            {data.vocabulary.categories.map(c => (
              <Chip
                key={c} label={c} on={draft.preferredCategories.includes(c)}
                onClick={() => { if (!ro) toggle('preferredCategories', c) }}
              />
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <Field label="Preferred Platforms">
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map(p => (
                <Chip
                  key={p.id} label={p.label} on={draft.preferredPlatforms.includes(p.id)}
                  onClick={() => { if (!ro) toggle('preferredPlatforms', p.id) }}
                />
              ))}
            </div>
          </Field>
          <Field label="Preferred Creator Tier">
            <div className="flex flex-wrap gap-1.5">
              {TIERS.map(t => (
                <Chip
                  key={t} label={t} on={draft.preferredTiers.includes(t)}
                  onClick={() => { if (!ro) toggle('preferredTiers', t) }}
                />
              ))}
            </div>
          </Field>
        </div>

        <Field label="Creator Content Style">
          <div className="flex flex-wrap gap-1.5">
            {CONTENT_STYLES.map(s => (
              <Chip
                key={s} label={s} on={draft.contentStyles.includes(s)}
                onClick={() => { if (!ro) toggle('contentStyles', s) }}
              />
            ))}
          </div>
        </Field>
      </Section>

      {/* ── 5. What matters most ── the six criteria Brand Match averages ── */}
      <Section icon="tune" title="What matters most when evaluating creators?">
        <div className="flex flex-wrap gap-1.5">
          {data.vocabulary.whatMatters.map(o => (
            <Chip
              key={o.key} label={PROTOTYPE_WM_LABEL[o.key] ?? o.label} on={draft.whatMatters.includes(o.key as never)}
              onClick={() => { if (!ro) toggle('whatMatters', o.key) }}
            />
          ))}
        </div>
        {!draft.whatMatters.length && (
          <p className="text-[10.5px] mt-2" style={{ color: T.t4 }}>
            Nothing picked yet — creators show no Brand Match until you choose at least one.
          </p>
        )}
      </Section>

      {!ro && (
        <div
          className="sticky bottom-0 flex items-center gap-2.5 py-3 border-t"
          style={{ borderColor: T.outline, background: 'rgba(255,255,255,.92)', backdropFilter: 'blur(8px)' }}
        >
          <Btn variant="primary" onClick={save} disabled={saving || !dirty}>
            <span className="material-symbols-outlined text-[15px]">check</span>
            {saving ? 'Saving…' : 'Save brand profile'}
          </Btn>
          {dirty && (
            <Btn variant="ghost" onClick={() => { setDraft(data.profile); setSaved(null) }} disabled={saving}>
              Discard changes
            </Btn>
          )}
          <span className="text-[11px]" style={{ color: T.t4 }}>
            {saved ? `Saved at ${saved}.`
              : dirty ? 'Unsaved changes' : 'Up to date'}
          </span>
        </div>
      )}
    </div>
  )
}
