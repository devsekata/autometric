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
    /**
     * The criteria Brand Match can average, served by the API rather than
     * listed here. The form offers exactly these and nothing else, so a
     * criterion the engine cannot score — `brand_safety` above all — is not
     * offerable rather than offered and silently dropped on save.
     */
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
  'Professional', 'Innovative', 'Friendly', 'Educational', 'Authentic', 'Caring', 'Modern',
]

/**
 * Brand Values, as the product prototype lists them. Saved to
 * `brand_profile.brand_values` (migrations/kol/008) together with any custom
 * value typed below them. Stored and shown only — no Brand Match, What Matters
 * or Brand Fit code reads it, and the hint under the field says so.
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

/**
 * The Target Audience criteria, and what fills each one in.
 *
 * A criterion enters Brand Match only when its field says something — the same
 * rule `selectedAudienceCriteria` applies server-side. This list is what lets
 * the form SHOW that rule instead of leaving the user to discover it: a
 * criterion nothing selects is drawn as unselected and unselectable, never as a
 * chip that looks pickable and then contributes nothing.
 */
const AUDIENCE_CRITERIA: { label: string; from: string; on: (p: BrandProfile) => boolean }[] = [
  { label: 'Audience Gender', from: 'Audience gender', on: p => ['Female', 'Male', 'Balanced'].includes(p.genderMajority) },
  { label: 'Audience Age', from: 'Age range', on: p => p.targetAgeMin !== null || p.targetAgeMax !== null },
  { label: 'Audience Country', from: 'Target country', on: p => !!p.targetCountry?.trim() },
  { label: 'Audience City', from: 'Target city', on: p => !!p.targetCity?.trim() },
  { label: 'Audience Interest', from: 'Audience interests', on: p => p.audienceInterests.length > 0 },
]

/* ── small inputs ─────────────────────────────────────────────────────────── */

/**
 * A chip that can be UNSELECTABLE, with the reason attached.
 *
 * `Chip` in `./ui` has no disabled state, and a criterion Brand Match cannot
 * score must not be pickable: picking it would either do nothing, or — worse —
 * invite the reader to believe the creators who lack it were scored zero on it.
 * They are not. An unmeasured criterion leaves the DENOMINATOR; it is never
 * counted as a zero, by the engine or by this form.
 */
function PickChip({
  label, on, disabled, reason, onClick,
}: { label: string; on: boolean; disabled?: boolean; reason?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={() => { if (!disabled) onClick() }}
      disabled={disabled}
      aria-disabled={disabled}
      title={reason}
      style={{ ...PJ, cursor: disabled ? 'not-allowed' : 'pointer' }}
      className={`inline-flex items-center gap-1 rounded-full text-[11px] font-bold px-2.5 h-[26px] border transition-colors ${
        disabled
          ? 'bg-[#f9fafb] border-[#f3f4f6] text-[#c3c9d0]'
          : on
            ? 'bg-[#f0f7fa] border-[#327488] text-[#285D6E]'
            : 'bg-white border-[#e5e7eb] text-[#6b7280] hover:border-[#A7C8D4] hover:text-[#374151]'
      }`}
    >
      {disabled && <span className="material-symbols-outlined text-[13px]">do_not_disturb_on</span>}
      {label}
    </button>
  )
}

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

  const toggle = (key: 'brandPersonality' | 'brandValues' | 'audienceInterests'
    | 'preferredCategories' | 'preferredPlatforms' | 'preferredTiers' | 'contentStyles'
    | 'whatMatters', v: string) => {
    setDraft(d => {
      if (!d) return d
      // Widened to `string[]` because `whatMatters` is a union-keyed list: the
      // server is what validates the vocabulary (`cleanWhatMatters` drops
      // anything unknown), and the chips can only ever send one of its own
      // options anyway.
      const list = d[key] as readonly string[]
      return { ...d, [key]: list.includes(v) ? list.filter(x => x !== v) : [...list, v] }
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
        body: JSON.stringify(draft),
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
  /**
   * Whether this draft would produce a Match % — the same question
   * `isScoreable` answers server-side, and the same answer: has anything been
   * SELECTED. It used to be `!!draft.brandCategory`, because the weighted
   * scorer's Category Match was the one component that reached the whole
   * roster. That scorer is gone and a brand category now moves no Match %, so
   * gating the strip on it would promise scoring that a category alone cannot
   * turn on.
   */
  const scoreableNow = draft.whatMatters.length > 0 || AUDIENCE_CRITERIA.some(c => c.on(draft))

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
              ? 'Match scoring is on for the Creator Database'
              : 'Choose what matters to turn match scoring on'}
          </div>
          <div className="text-[11px] leading-snug" style={{ color: T.t3 }}>
            {scoreableNow
              ? 'Every creator is scored against this profile on the next request — no restart needed.'
              : 'Brand Match is the average of the criteria you choose below (plus any Target Audience you fill in). With none chosen, creators are listed and show “Match —”, rather than a number averaged over nothing.'}
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

      {/* ── Brand Identity ── Brand Values is deliberately not here. ── */}
      <Section
        icon="storefront"
        title="Brand Identity"
        subtitle="Who the brand is. Category is what every creator is compared against."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <Field label="Brand name">
            <input
              className={inputCls} style={inputStyle} disabled={ro}
              value={draft.brandName ?? ''}
              placeholder="e.g. LumiSkin"
              onChange={e => set('brandName', e.target.value)}
            />
          </Field>
          <Field
            label="Brand category"
            hint="One of the nine categories the creator database itself uses, so both sides of every comparison speak one vocabulary."
          >
            <select
              className={inputCls} style={inputStyle} disabled={ro}
              value={draft.brandCategory ?? ''}
              onChange={e => set('brandCategory', e.target.value || null)}
            >
              <option value="">— Not set —</option>
              {data.vocabulary.categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>

        <Field
          label="Brand description"
          hint="For your team. It is not scored — no creator-side column can be compared against prose."
        >
          <textarea
            className="w-full rounded-lg border text-[12px] px-2.5 py-2 outline-none focus:border-[#4E96AC] min-h-[64px]"
            style={inputStyle} disabled={ro}
            value={draft.brandDescription ?? ''}
            placeholder="What the brand sells, and to whom."
            onChange={e => set('brandDescription', e.target.value)}
          />
        </Field>

        <Field
          label="Company website (optional)"
          hint="Stored and shown only. Nothing fetches it and no score reads it."
        >
          <input
            className={inputCls} style={inputStyle} disabled={ro}
            value={draft.companyWebsite ?? ''} placeholder="e.g. https://lumiskin.id"
            onChange={e => set('companyWebsite', e.target.value || null)}
          />
        </Field>

        <Field
          label="Brand personality"
          hint="Stored and shown, not yet scored: the creator database has no personality or tone reading for anyone, so this dimension is reported as unmeasured rather than guessed at."
        >
          <div className="flex flex-wrap gap-1.5">
            {PERSONALITIES.map(p => (
              <Chip
                key={p} label={p} on={draft.brandPersonality.includes(p)}
                onClick={() => { if (!ro) toggle('brandPersonality', p) }}
              />
            ))}
          </div>
        </Field>

        <Field
          label="Brand values"
          hint="Stored and shown only (migrations/kol/008). No Brand Match, What Matters or Brand Fit code reads it — it is here because it is real brand configuration, not because it changes a score."
        >
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

      {/*
        ── Brand Keywords & Topics is gone ──
        Keywords, hashtags and caption terms were inputs to the weighted Brand
        Match scorer, which is gone; `migrations/kol/009` dropped their columns
        with it. Nothing reads them, so the fields are removed rather than left
        on screen writing to nowhere — a preference a buyer can still type is a
        preference they will believe is doing something.
      */}

      {/* ── Target audience ── */}
      <Section
        icon="group"
        title="Target Audience"
        subtitle="Compared against measured audience data. Only 24 creators carry a full audience analysis today — the rest report this dimension as unmeasured, and are not penalised for it."
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
          <Field label="Audience gender" hint="“Any” means gender does not enter the decision.">
            <select
              className={inputCls} style={inputStyle} disabled={ro}
              value={draft.genderMajority}
              onChange={e => set('genderMajority', e.target.value as GenderMajority)}
            >
              {data.vocabulary.genderMajorities.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="Target country">
            <input
              className={inputCls} style={inputStyle} disabled={ro}
              value={draft.targetCountry ?? ''} placeholder="e.g. Indonesia"
              onChange={e => set('targetCountry', e.target.value)}
            />
          </Field>
          <Field label="Target city">
            <input
              className={inputCls} style={inputStyle} disabled={ro}
              value={draft.targetCity ?? ''} placeholder="e.g. Jakarta"
              onChange={e => set('targetCity', e.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Audience interests"
          hint="The interest keys the audience pipeline actually records. Sports is kept separate from fitness because the data keeps them separate."
        >
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

      {/* ── Ideal Creator Profile ── narrows, never scores ── */}
      <Section
        icon="person_search"
        title="Ideal Creator Profile"
        subtitle="Which creators you want to see at all. These narrow the Creator Database; they never change a creator's score, so nobody is penalised twice for the same thing."
      >
        <Field label="Preferred creator categories">
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
          <Field label="Preferred platforms">
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map(p => (
                <Chip
                  key={p.id} label={p.label} on={draft.preferredPlatforms.includes(p.id)}
                  onClick={() => { if (!ro) toggle('preferredPlatforms', p.id) }}
                />
              ))}
            </div>
          </Field>
          <Field label="Preferred creator tier">
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

        <Field
          label="Creator content style"
          hint="Stored for later. The creator database has no content-style column filled, so this cannot narrow results today and is not used as a filter — showing it as active would be a lie about what your results contain."
        >
          <div className="flex flex-wrap gap-1.5">
            {CONTENT_STYLES.map(s => (
              <Chip
                key={s} label={s} on={draft.contentStyles.includes(s)}
                onClick={() => { if (!ro) toggle('contentStyles', s) }}
              />
            ))}
          </div>
        </Field>

        {/*
          "Creator evaluation preferences" — minimum followers, minimum ER, and
          the two eligibility toggles — is gone. They had no column after
          `migrations/kol/009` and nothing read them. The Creator Database's own
          `minFollowers` / `minEr` / `verifiedOnly` filters are URL filters with
          the same names and are still there; these were a second, silent copy.
        */}
      </Section>

      {/* ── What matters most ── the criteria Brand Match averages ──
          This section IS the Brand Match configuration. Match % is the mean of
          what is chosen here plus the Target Audience criteria the fields above
          fill in — equal weight each, and a criterion this creator cannot be
          measured on leaves the denominator rather than scoring zero. Nothing
          else on this page changes a Match %. */}
      <Section
        icon="tune"
        title="What matters most when evaluating creators?"
        subtitle="Brand Match is the average of the criteria you pick here and the Target Audience you filled in above. Equal weight each — there are no weights to tune, and no Excellent / Strong / Good bands: the number is the mean, and it says so."
      >
        <Field
          label="What Matters"
          hint="Only criteria Brand Match can actually score are offered. Brand Safety is not among them — there is no sentiment or risk column on this server, so it is absent rather than shown and quietly ignored."
        >
          <div className="flex flex-wrap gap-1.5">
            {data.vocabulary.whatMatters.map(o => (
              <PickChip
                key={o.key}
                label={PROTOTYPE_WM_LABEL[o.key] ?? o.label}
                on={(draft.whatMatters as readonly string[]).includes(o.key)}
                onClick={() => { if (!ro) toggle('whatMatters', o.key) }}
              />
            ))}
          </div>
        </Field>

        {/* The other half of the mean, shown rather than explained: a Target
            Audience criterion is selected exactly when its field above says
            something, so an empty field draws as unselectable with the field
            that would turn it on named in the tooltip. */}
        <Field
          label="Target Audience criteria"
          hint="Selected by the Target Audience fields above, not picked here. An empty field selects nothing and never reaches the average — it is not a zero."
        >
          <div className="flex flex-wrap gap-1.5">
            {AUDIENCE_CRITERIA.map(c => {
              const on = c.on(draft)
              return (
                <PickChip
                  key={c.label} label={c.label} on={on} disabled={!on}
                  reason={on
                    ? `Selected by “${c.from}” above — it counts toward Match %.`
                    : `Not selected: fill in “${c.from}” above to include it. It is left out of the average, not scored zero.`}
                  onClick={() => {}}
                />
              )
            })}
          </div>
        </Field>

        {!draft.whatMatters.length && !AUDIENCE_CRITERIA.some(c => c.on(draft)) && (
          <p className="text-[10.5px]" style={{ color: T.t4 }}>
            <span className="material-symbols-outlined text-[12px] align-[-2px] mr-0.5">info</span>
            Nothing chosen yet — creators show “Match —” rather than a number, because there is
            nothing to average.
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
            {saved ? `Saved at ${saved} — the Creator Database is already using it.`
              : dirty ? 'Unsaved changes' : 'Up to date'}
          </span>
        </div>
      )}
    </div>
  )
}
