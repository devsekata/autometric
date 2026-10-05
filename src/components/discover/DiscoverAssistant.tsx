'use client'

/**
 * AI Assistant — port of the source platform's `pages/assistant.js`.
 *
 * Same three steps: platform → content type → three concept cards, with "start
 * over", "change content type" and "regenerate" wired the same way.
 *
 * The difference is where the concepts come from. The source shipped hardcoded
 * strings about running shoes — identical for every user, and unchanged by
 * anything the account had ever posted. Here the server generates them from the
 * org's own Discover summary: which pillars and formats actually perform, which
 * posts led, which accounts they came from. Every card therefore carries a
 * `rationale` naming the numbers behind it, so the suggestion can be argued with
 * rather than merely accepted.
 */

import { useCallback, useState } from 'react'
import { Card } from '@/components/dashboard/ui'
import { Btn, DiscoverHeader, PJ, Spinner } from './ui'
import { ASSISTANT_PLATFORMS, contentTypesFor, type ContentConcept } from '@/lib/discover/assistant'

export default function DiscoverAssistant({
  orgId, embedded = false,
}: { orgId: string; embedded?: boolean }) {
  const [platform, setPlatform] = useState<string | null>(null)
  const [contentType, setContentType] = useState<string | null>(null)
  const [concepts, setConcepts] = useState<ContentConcept[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)

  const platformMeta = ASSISTANT_PLATFORMS.find(p => p.id === platform)
  const typeMeta = contentTypesFor(platform ?? '').find(t => t.id === contentType)

  const generate = useCallback(async (p: string, ct: string) => {
    setBusy(true); setError(null); setConcepts(null)
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: p, contentType: ct }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      setConcepts(body.concepts as ContentConcept[])
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }, [orgId])

  const reset = () => { setPlatform(null); setContentType(null); setConcepts(null); setError(null) }
  const backToTypes = () => { setContentType(null); setConcepts(null); setError(null) }

  const copy = async (c: ContentConcept, i: number) => {
    const text = `${c.title}\n\n${c.description}\n\nHook: ${c.hook}`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(i)
      window.setTimeout(() => setCopied(null), 1600)
    } catch {
      setError('Browser menolak akses clipboard. Salin manual dari kartu di atas.')
    }
  }

  const step = !platform ? 1 : !contentType ? 2 : 3

  return (
    <div className={embedded ? '' : 'p-5 max-w-[1500px] mx-auto'}>
      <DiscoverHeader
        title="AI Assistant"
        subtitle="Buat konsep konten on-brand — pilih platform, lalu tipe konten. Ide disusun dari data performa akun kamu sendiri."
        actions={platform ? (
          <Btn variant="ghost" onClick={reset}>
            <span className="material-symbols-outlined text-[15px]">restart_alt</span>Start over
          </Btn>
        ) : undefined}
      />

      {/* step banner — the source's `.ai-card` */}
      <Card className="p-3.5 mb-4">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-[#f3f0fb] flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-[19px] text-[#6b5bb5]">auto_awesome</span>
          </span>
          <div className="min-w-0">
            <div style={PJ} className="text-[12.5px] font-extrabold text-[#111827]">
              Step {step} ·{' '}
              {step === 1 ? 'Platform' : step === 2 ? 'Content type' : 'Concepts'}
            </div>
            <div className="text-[11.5px] text-[#6b7280]">
              {step === 1 ? 'Pilih platform yang mau kamu buatkan konten.'
                : step === 2 ? `Pilih bentuk konten di ${platformMeta?.label}.`
                : `Dibuat untuk ${platformMeta?.label} · ${typeMeta?.label}`}
            </div>
          </div>
        </div>
      </Card>

      {error && (
        <div className="flex items-start gap-2 bg-[#fcefec] border border-[#f0c8bf] rounded-xl px-3.5 py-2.5 mb-3.5">
          <span className="material-symbols-outlined text-[16px] text-[#c2553f] mt-0.5">error</span>
          <p className="text-[11.5px] text-[#c2553f] flex-1">{error}</p>
          {step === 3 && (
            <Btn size="sm" variant="secondary"
              onClick={() => platform && contentType && generate(platform, contentType)}>
              Coba lagi
            </Btn>
          )}
        </div>
      )}

      {/* step 1 — platform */}
      {step === 1 && (
        <div className="grid gap-3 max-w-[720px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          {ASSISTANT_PLATFORMS.map(p => (
            <button key={p.id} type="button" onClick={() => setPlatform(p.id)}
              className="flex flex-col items-center gap-2 rounded-xl border border-[#e5e7eb] bg-white px-4 py-6 transition-colors hover:border-[#327488] hover:bg-[#f0f7fa]">
              <span className="material-symbols-outlined text-[30px] text-[#285D6E]">{p.icon}</span>
              <span style={PJ} className="text-[13px] font-extrabold text-[#111827]">{p.label}</span>
              <span className="text-[10.5px] text-[#9ca3af] text-center">
                {p.types.map(t => t.label).join(' · ')}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* step 2 — content type */}
      {step === 2 && platformMeta && (
        <>
          <div className="grid gap-3 max-w-[820px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            {platformMeta.types.map(t => (
              <button key={t.id} type="button"
                onClick={() => { setContentType(t.id); generate(platformMeta.id, t.id) }}
                className="flex flex-col items-center gap-2 rounded-xl border border-[#e5e7eb] bg-white px-3 py-5 transition-colors hover:border-[#327488] hover:bg-[#f0f7fa]">
                <span className="material-symbols-outlined text-[24px] text-[#285D6E]">{t.icon}</span>
                <span style={PJ} className="text-[12px] font-bold text-[#111827]">{t.label}</span>
              </button>
            ))}
          </div>
          <div className="mt-3.5">
            <Btn size="sm" variant="ghost" onClick={reset}>
              <span className="material-symbols-outlined text-[14px]">arrow_back</span>Ganti platform
            </Btn>
          </div>
        </>
      )}

      {/* step 3 — concepts */}
      {step === 3 && (
        <>
          {busy && <Spinner label="Menyusun konsep dari data kamu…" />}

          {!busy && concepts && (
            <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
              {concepts.map((c, i) => (
                <Card key={`${c.title}-${i}`} className="p-4 flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-[#f3f0fb] flex items-center justify-center flex-shrink-0">
                      <span className="material-symbols-outlined text-[15px] text-[#6b5bb5]">auto_awesome</span>
                    </span>
                    <span style={PJ} className="text-[12.5px] font-extrabold text-[#111827]">{c.title}</span>
                  </div>

                  <p className="text-[11.5px] text-[#374151] leading-relaxed mt-2.5">{c.description}</p>

                  {c.hook && (
                    <div className="mt-2.5 rounded-lg border border-[#cfe4ec] bg-[#eaf4f9] px-2.5 py-2">
                      <div style={PJ} className="text-[9.5px] font-bold uppercase tracking-widest text-[#4E96AC] mb-0.5">
                        Hook
                      </div>
                      <p className="text-[11px] font-semibold text-[#285D6E]">{c.hook}</p>
                    </div>
                  )}

                  {/* Why this idea and not another — the part the source could not
                      offer, because its concepts were not derived from anything. */}
                  {c.rationale && (
                    <div className="mt-2 flex items-start gap-1.5">
                      <span className="material-symbols-outlined text-[13px] text-[#9ca3af] mt-0.5">insights</span>
                      <p className="text-[10.5px] text-[#9ca3af] leading-relaxed flex-1">{c.rationale}</p>
                    </div>
                  )}

                  <div className="flex-1" />
                  <div className="flex items-center gap-1.5 mt-3">
                    <Btn size="sm" variant="secondary" onClick={() => copy(c, i)}>
                      <span className="material-symbols-outlined text-[14px]">
                        {copied === i ? 'check' : 'content_copy'}
                      </span>
                      {copied === i ? 'Tersalin' : 'Copy'}
                    </Btn>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {!busy && (
            <div className="flex items-center gap-2 mt-4 flex-wrap">
              <Btn size="sm" variant="ghost" onClick={backToTypes}>
                <span className="material-symbols-outlined text-[14px]">arrow_back</span>Ganti tipe konten
              </Btn>
              <Btn size="sm" variant="secondary"
                onClick={() => platform && contentType && generate(platform, contentType)}>
                <span className="material-symbols-outlined text-[14px]">refresh</span>Regenerate
              </Btn>
              <span className="text-[10.5px] text-[#9ca3af]">
                Konsep dibuat AI dari data akunmu — periksa dulu sebelum dikirim ke creator.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
