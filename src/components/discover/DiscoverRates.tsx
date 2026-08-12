'use client'

/**
 * Rate cards — one base rate per account, the number every deliverable price is
 * derived from.
 *
 * The source had no equivalent screen: its rates were literals in the creator
 * array. Since the whole cart is unusable without them, they need somewhere to
 * be entered, and the multiplier preview is shown inline so it is obvious what
 * a base rate turns into before it is saved.
 */

import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/dashboard/ui'
import {
  Btn, Chip, EmptyState, ErrorState, PJ, PLATFORM_ICON, Spinner, gradientFor,
} from './ui'
import type { DirectoryAccount } from '@/lib/discover/types'
import type { Deliverable, RateCard } from '@/lib/discover/vocab'

const idr = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID')

export default function DiscoverRates({ orgId }: { orgId: string }) {
  const [accounts, setAccounts] = useState<DirectoryAccount[]>([])
  const [rates, setRates] = useState<Record<string, RateCard>>({})
  const [deliverables, setDeliverables] = useState<Deliverable[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [relation, setRelation] = useState('all')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/organizations/${orgId}/discover/rates`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { rates: Record<string, RateCard>; deliverables: Deliverable[]; accounts: DirectoryAccount[] }) => {
        if (cancelled) return
        setRates(d.rates); setDeliverables(d.deliverables); setAccounts(d.accounts)
      })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [orgId])

  const save = async (accountId: string) => {
    const raw = drafts[accountId]
    // Accept "10.000.000" or "10000000" — Indonesian thousands separators are
    // the natural thing to type here.
    const baseRate = Number(String(raw ?? '').replace(/[^\d]/g, ''))
    if (!Number.isFinite(baseRate) || baseRate < 0) { setError('Tarif harus angka positif.'); return }

    setSavingId(accountId); setError(null)
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/rates`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socialAccountId: accountId, baseRate }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      setRates(body.rates)
      setDrafts(d => { const n = { ...d }; delete n[accountId]; return n })
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setSavingId(null)
    }
  }

  const rows = useMemo(
    () => accounts.filter(a => relation === 'all' || a.relation === relation),
    [accounts, relation])

  if (loading) return <Spinner />
  if (error && accounts.length === 0) return <ErrorState message={error} />

  const priced = accounts.filter(a => rates[a.id]?.baseRate > 0).length

  return (
    <div>
      <p className="text-[11.5px] text-[#6b7280] mb-3">
        {priced} dari {accounts.length} akun sudah punya tarif. Harga tiap deliverable dihitung
        dari base rate x pengali, dan ikut terpakai di tab Cart.
      </p>

      {error && (
        <div className="flex items-start gap-2 bg-[#fcefec] border border-[#f0c8bf] rounded-xl px-3.5 py-2.5 mb-3.5">
          <span className="material-symbols-outlined text-[16px] text-[#c2553f] mt-0.5">error</span>
          <p className="text-[11.5px] text-[#c2553f]">{error}</p>
        </div>
      )}

      <div className="flex gap-1.5 mb-3.5">
        <Chip label="Semua" on={relation === 'all'} onClick={() => setRelation('all')} />
        <Chip label="Brand kamu" on={relation === 'owned'} onClick={() => setRelation('owned')} />
        <Chip label="Kompetitor" on={relation === 'competitor'} onClick={() => setRelation('competitor')} />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="payments" title="Tidak ada akun" body="Belum ada akun pada filter ini." />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map(a => {
            const current = rates[a.id]?.baseRate ?? 0
            const draft = drafts[a.id]
            const pending = draft !== undefined && Number(draft.replace(/[^\d]/g, '')) !== current
            const preview = Number((draft ?? String(current)).replace(/[^\d]/g, '')) || 0
            const opts = deliverables.filter(d => d.platform === a.platform)

            return (
              <Card key={`${a.relation}:${a.id}`}>
                <div className="flex items-center gap-2.5 px-4 pt-3.5">
                  <div style={{ ...PJ, background: gradientFor(a.username) }}
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-[11px] font-extrabold">
                    {a.username.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '??'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div style={PJ} className="text-[12.5px] font-extrabold text-[#111827] truncate">{a.username}</div>
                    <div className="flex items-center gap-1 text-[10.5px] text-[#9ca3af]">
                      <span className="material-symbols-outlined text-[12px]">{PLATFORM_ICON[a.platform]}</span>
                      <span className="capitalize">{a.platform}</span>
                      <span className="text-[#d1d5db]">·</span>
                      <span>{a.relation === 'owned' ? 'Brand' : 'Kompetitor'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-[#9ca3af]">Rp</span>
                    <input
                      value={draft ?? (current > 0 ? current.toLocaleString('id-ID') : '')}
                      onChange={e => setDrafts(d => ({ ...d, [a.id]: e.target.value }))}
                      placeholder="0"
                      inputMode="numeric"
                      className="w-36 h-8 px-2.5 rounded-lg border border-[#e5e7eb] text-[12px] text-right text-[#374151] tabular-nums focus:outline-none focus:border-[#327488]"
                    />
                    <Btn size="sm" variant={pending ? 'primary' : 'secondary'}
                      disabled={!pending || savingId === a.id} onClick={() => save(a.id)}>
                      {savingId === a.id ? '…' : 'Simpan'}
                    </Btn>
                  </div>
                </div>

                <div className="px-4 pb-3.5 pt-2.5">
                  {preview <= 0 ? (
                    <p className="text-[11px] text-[#9ca3af]">Isi base rate untuk melihat harga per deliverable.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {opts.map(d => (
                        <span key={d.id} style={PJ}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] px-2.5 h-7 text-[11px] font-bold text-[#6b7280]">
                          <span className="material-symbols-outlined text-[13px] text-[#9ca3af]">{d.icon}</span>
                          {d.label}
                          <span className="text-[#285D6E]">
                            {idr(Math.round((preview * d.mult) / 1000) * 1000)}
                          </span>
                          <span className="text-[9.5px] text-[#b6bcc4]">×{d.mult}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
