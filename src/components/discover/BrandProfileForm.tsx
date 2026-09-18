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
 * The five metrics `brand_profile.performance_targets` recognises, verbatim from
 * the column's COMMENT. A metric left blank is NOT MEASURED, and no targets at
 * all means Past Performance as a whole is NOT MEASURED — so blank is a real,
 * valid answer here, not a missing one.
 */
const PERFORMANCE_TARGETS: { key: string; label: string; step: string }[] = [
  { key: 'engagement_rate', label: 'Engagement rate (%)', step: '0.1' },
  { key: 'median_views', label: 'Median views', step: '1' },
  { key: 'followers_growth', label: 'Followers growth', step: 'any' },
  { key: 'post_frequency_reliability', label: 'Post frequency reliability', step: 'any' },
  { key: 'performance_stability', label: 'Performance stability', step: 'any' },
]

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

  const toggle = (key: 'brandPersonality' | 'audienceInterests' | 'preferredCategories'
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
          label="Brand tone"
          hint="How the brand speaks, as opposed to who it is. Brand Fit joins it with personality to form the brand attributes Values Alignment is measured against."
        >
          <TagInput
            value={draft.brandTone} disabled={ro}
            onChange={v => set('brandTone', v)}
            placeholder="e.g. warm, straightforward"
          />
        </Field>
      </Section>

      {/* ── What the brand talks about ── */}
      <Section
        icon="tag"
        title="Brand Keywords & Topics"
        subtitle="Searched in what creators actually write — their bio, captions and hashtags."
      >
        <Field
          label="Brand keywords"
          hint="Searched in creator bios, captions and category names. Sparse today: bios are filled for about 12% of the roster, so this lifts the creators it reaches rather than ranking everyone. Adding terms your creators never use lowers this signal for all of them equally — keep the list tight."
        >
          <TagInput
            value={draft.brandKeywords} disabled={ro}
            onChange={v => set('brandKeywords', v)}
            placeholder="Type a keyword and press Enter, or paste a comma-separated list"
          />
        </Field>

        <Field
          label="Brand hashtags"
          hint="Searched in the creator's own hashtags. Sparser still — only part of the post harvest carries any hashtag. The leading # is optional."
        >
          <TagInput
            value={draft.brandHashtags} disabled={ro}
            onChange={v => set('brandHashtags', v.map(x => x.replace(/^#+/, '')))}
            placeholder="e.g. skincare, glowup"
          />
        </Field>

        <Field
          label="Content topics"
          hint="Searched in creator captions for the Content dimension. Leave blank to reuse your brand keywords."
        >
          <TagInput
            value={draft.captionTerms} disabled={ro}
            onChange={v => set('captionTerms', v)}
            placeholder="e.g. morning routine, serum, sunscreen"
          />
        </Field>
      </Section>

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
          <Field
            label="Target country"
            hint="Format not decided yet: audience data uses ISO-2 codes (ID), one engine expects the country name. Stored as typed."
          >
            {/* TODO(BLOCKED): pick one format; see `targetCountry` in brandMatch/profile.ts. */}
            <input
              className={inputCls} style={inputStyle} disabled={ro}
              value={draft.targetCountry ?? ''}
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
          <Field label="Target age — from" hint="Inclusive. Blank means no age target: age is then not measured, not scored 0.">
            <input
              type="number" min={0} max={120} className={inputCls} style={inputStyle} disabled={ro}
              value={draft.targetAgeMin ?? ''} placeholder="e.g. 18"
              onChange={e => set('targetAgeMin', e.target.value === '' ? null : Number(e.target.value))}
            />
          </Field>
          <Field label="Target age — to" hint="Inclusive.">
            <input
              type="number" min={0} max={120} className={inputCls} style={inputStyle} disabled={ro}
              value={draft.targetAgeMax ?? ''} placeholder="e.g. 34"
              onChange={e => set('targetAgeMax', e.target.value === '' ? null : Number(e.target.value))}
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

        <div style={{ ...PJ, color: T.t4 }} className="text-[10.5px] font-bold uppercase tracking-wider mt-4 mb-2">
          Creator evaluation preferences
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <Field label="Minimum followers" hint="Leave blank for no floor. 0 is a real value and is not the same as blank.">
            <input
              type="number" min={0} className={inputCls} style={inputStyle} disabled={ro}
              value={draft.minFollowers ?? ''} placeholder="e.g. 10000"
              onChange={e => set('minFollowers', e.target.value === '' ? null : Number(e.target.value))}
            />
          </Field>
          <Field label="Minimum engagement rate (%)" hint="Measured for about a quarter of the roster; setting this excludes creators whose rate was never measured.">
            <input
              type="number" min={0} step="0.1" className={inputCls} style={inputStyle} disabled={ro}
              value={draft.minErPct ?? ''} placeholder="e.g. 3"
              onChange={e => set('minErPct', e.target.value === '' ? null : Number(e.target.value))}
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 mb-2 cursor-pointer">
          <input
            type="checkbox" disabled={ro} checked={draft.requireCategory}
            onChange={e => set('requireCategory', e.target.checked)}
          />
          <span style={{ ...PJ, color: T.t2 }} className="text-[11.5px] font-bold">
            Only show creators that carry a category
          </span>
          <span className="text-[10.5px]" style={{ color: T.t4 }}>
            — about 54% of the roster does
          </span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox" disabled={ro} checked={draft.verifiedOnly}
            onChange={e => set('verifiedOnly', e.target.checked)}
          />
          <span style={{ ...PJ, color: T.t2 }} className="text-[11.5px] font-bold">
            Only show verified creators
          </span>
          <span className="text-[10.5px]" style={{ color: T.t4 }}>
            — about 8% of the roster is
          </span>
        </label>
      </Section>

      {/* ── What Matters Most ── the criteria Brand Match averages ── */}
      <Section
        icon="tune"
        title="What Matters Most"
        subtitle="What matters most when evaluating creators. Brand Match is the average of a creator's scores on the ones you pick — every pick counts equally, and a score that could not be measured is left out rather than counted as zero."
      >
        <div className="flex flex-wrap gap-1.5">
          {data.vocabulary.whatMatters.map(o => (
            <Chip
              key={o.key} label={o.label} on={draft.whatMatters.includes(o.key as never)}
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

      {/* ── Performance targets ── Brand Fit, Past Performance (Option B) ── */}
      <Section
        icon="trending_up"
        title="Performance Targets"
        subtitle="A target per metric, compared directly against the creator's own number. Leave a metric blank to leave it unmeasured."
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
          {PERFORMANCE_TARGETS.map(m => (
            <Field key={m.key} label={m.label}>
              <input
                type="number" min={0} step={m.step} className={inputCls} style={inputStyle} disabled={ro}
                value={draft.performanceTargets[m.key] ?? ''}
                onChange={e => {
                  const next = { ...draft.performanceTargets }
                  if (e.target.value === '') delete next[m.key]
                  else next[m.key] = Number(e.target.value)
                  set('performanceTargets', next)
                }}
              />
            </Field>
          ))}
        </div>
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
