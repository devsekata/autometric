'use client'

/**
 * Brand Fit, AI Insights and Report sections of the KOL workspace.
 *
 * Brand Fit shows the formula's own inputs rather than a bare score, because a
 * suitability number nobody can interrogate does not survive a procurement
 * conversation.
 *
 * AI Insights is rule-derived, not model-generated, and says so. Every line is
 * produced by a stated threshold over this account's metrics. Wiring an LLM
 * here would produce more fluent text and strictly less accountable text, and
 * nothing in the data would justify the extra confidence it implies.
 */

import { useMemo } from 'react'
import { Card, CardHead } from '@/components/dashboard/ui'
import { Donut, HBars } from '@/components/dashboard/charts'
import { Btn, EmptyState, PJ, fmtNum } from './ui'
import { ConfidenceBadge, DataSourceStrip, MetricValue } from './credibility'
import { exportCsv, exportExcel, exportPrintable, type ExportColumn } from './exportData'
import type { KolProfile } from '@/lib/discover/profile'
import type { AccountDetailPayload } from '@/lib/discover/account'

const idr = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID')
const PALETTE = ['#285D6E', '#4E96AC', '#e0a458', '#5fa783', '#8b7fc7', '#d97a7a']

/* ── Brand Fit ────────────────────────────────────────────────────────────── */

export function BrandFitSection({ profile }: { profile: KolProfile }) {
  // Mirrors the weights in profile.ts; shown so the score can be audited.
  const inputs = [
    { label: 'Audience quality', value: profile.audienceQuality.value, weight: 0.35, basis: profile.audienceQuality.basis },
    { label: 'Authenticity', value: profile.authenticity.value, weight: 0.3, basis: profile.authenticity.basis },
    { label: 'Engagement rate', value: Math.min(100, profile.erPct.value * 12), weight: 0.2, basis: 'ER terukur, diskalakan ke 0–100' },
    { label: 'Konsistensi posting', value: Math.min(100, profile.postFrequency.value * 6), weight: 0.15, basis: 'Frekuensi post per 30 hari' },
  ]
  const fit = profile.brandFit.value
  const verdict = fit >= 80 ? 'Sangat cocok' : fit >= 65 ? 'Cocok' : fit >= 50 ? 'Cukup' : 'Kurang cocok'
  const color = fit >= 80 ? '#3d8a5f' : fit >= 65 ? '#4E96AC' : fit >= 50 ? '#e0a458' : '#c2553f'

  return (
    <div className="flex flex-col gap-3.5">
      <Card>
        <CardHead title="Brand fit" sub="Kecocokan akun ini untuk brand kamu saat ini" />
        <div className="px-4 pb-4 flex items-center gap-6 flex-wrap">
          <div className="text-center">
            <div style={{ ...PJ, color }} className="text-[38px] font-extrabold leading-none">{fit}</div>
            <div style={{ ...PJ, color }} className="text-[12px] font-bold mt-1">{verdict}</div>
            <ConfidenceBadge confidence={profile.brandFit.confidence} basis={profile.brandFit.basis} />
          </div>
          <div className="flex-1 min-w-[280px] flex flex-col gap-2">
            {inputs.map(i => (
              <div key={i.label}>
                <div className="flex items-center justify-between text-[11.5px]">
                  <span className="text-[#374151]">
                    {i.label} <span className="text-[#9ca3af]">· bobot {Math.round(i.weight * 100)}%</span>
                  </span>
                  <b style={PJ} className="tabular-nums text-[#111827]">{Math.round(i.value)}</b>
                </div>
                <div className="h-1.5 rounded-full bg-[#f3f4f6] mt-1 overflow-hidden">
                  <div className="h-full rounded-full bg-[#4E96AC]" style={{ width: `${Math.min(100, i.value)}%` }} />
                </div>
                <p className="text-[10px] text-[#9ca3af] mt-0.5">{i.basis}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <CardHead title="Pertimbangan" sub="Hal yang mendukung dan yang perlu diperhatikan" />
        <div className="px-4 pb-4 grid grid-cols-2 gap-4">
          <div>
            <Label tone="good">Mendukung</Label>
            <ul className="flex flex-col gap-1">
              {profile.erPct.value >= 3 && <Li tone="good">Engagement rate {profile.erPct.value.toFixed(2)}% di atas rata-rata pasar</Li>}
              {profile.authenticity.value >= 85 && <Li tone="good">Autentisitas audiens tinggi ({profile.authenticity.value})</Li>}
              {profile.postFrequency.value >= 8 && <Li tone="good">Posting konsisten, {profile.postFrequency.value.toFixed(1)} post per 30 hari</Li>}
              {profile.paidRatio.value > 0 && profile.paidErPct.value >= profile.organicErPct.value &&
                <Li tone="good">Konten berbayar tetap perform sebaik organik</Li>}
              {profile.audienceQuality.value >= 70 && <Li tone="good">Kualitas audiens baik ({profile.audienceQuality.value})</Li>}
            </ul>
          </div>
          <div>
            <Label tone="bad">Perlu diperhatikan</Label>
            <ul className="flex flex-col gap-1">
              {profile.erPct.value < 2 && <Li tone="bad">Engagement rate rendah ({profile.erPct.value.toFixed(2)}%)</Li>}
              {profile.authenticity.value < 80 && <Li tone="bad">Autentisitas belum terverifikasi sumber nyata</Li>}
              {profile.paidRatio.value > 60 && <Li tone="bad">Rasio konten berbayar tinggi ({profile.paidRatio.value.toFixed(0)}%) — risiko audience fatigue</Li>}
              {profile.postFrequency.value < 4 && <Li tone="bad">Frekuensi posting rendah</Li>}
              {!profile.hasRate && <Li tone="bad">Belum ada rate card, biaya belum bisa dihitung</Li>}
              {profile.account.relation === 'competitor' && <Li tone="bad">Ini akun kompetitor — data terbatas pada post publik</Li>}
            </ul>
          </div>
        </div>
      </Card>
    </div>
  )
}

/* ── AI Insights ──────────────────────────────────────────────────────────── */

interface Insight { icon: string; tone: 'good' | 'warn' | 'info'; title: string; body: string }

export function AiInsightsSection({
  profile, data,
}: { profile: KolProfile; data: AccountDetailPayload }) {
  const insights = useMemo<Insight[]>(() => {
    const out: Insight[] = []
    const p = profile

    if (p.paidRatio.value > 0 && p.organicErPct.value > 0) {
      const ratio = p.paidErPct.value / p.organicErPct.value
      out.push(ratio >= 0.9
        ? { icon: 'verified', tone: 'good', title: 'Konten berbayar tidak menurunkan engagement',
            body: `ER berbayar ${p.paidErPct.value.toFixed(2)}% vs organik ${p.organicErPct.value.toFixed(2)}% — audiens tidak menolak konten sponsor.` }
        : { icon: 'trending_down', tone: 'warn', title: 'Engagement turun pada konten berbayar',
            body: `ER berbayar ${p.paidErPct.value.toFixed(2)}% hanya ${Math.round(ratio * 100)}% dari organik ${p.organicErPct.value.toFixed(2)}%. Pertimbangkan format yang lebih native.` })
    } else {
      out.push({ icon: 'help', tone: 'info', title: 'Belum ada rekam jejak konten berbayar',
        body: 'Akun ini belum pernah menandai post sebagai campaign atau boosted, jadi performa berbayar belum bisa dinilai.' })
    }

    const bestFormat = data.byFormat.slice().sort((a, b) => b.erPct - a.erPct)[0]
    if (bestFormat) {
      out.push({ icon: 'movie', tone: 'good', title: `Format ${bestFormat.label} paling efektif`,
        body: `ER rata-rata ${bestFormat.erPct.toFixed(2)}% dari ${bestFormat.posts} post. Prioritaskan format ini di brief.` })
    }

    const bestPillar = data.byPillar.slice().sort((a, b) => b.erPct - a.erPct)[0]
    if (bestPillar) {
      out.push({ icon: 'category', tone: 'good', title: `Pillar ${bestPillar.label} paling direspons`,
        body: `ER rata-rata ${bestPillar.erPct.toFixed(2)}%. Sesuaikan angle campaign ke arah ini.` })
    }

    const peak = data.postingTimes.slice().sort((a, b) => b.avgEr - a.avgEr)[0]
    if (peak && peak.posts > 0) {
      const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
      out.push({ icon: 'schedule', tone: 'info', title: 'Waktu posting dengan ER terbaik',
        body: `${DAYS[peak.day]} jam ${String(peak.bucket * 4).padStart(2, '0')}.00–${String(peak.bucket * 4 + 4).padStart(2, '0')}.00, ER rata-rata ${peak.avgEr.toFixed(2)}%.` })
    }

    if (p.postFrequency.value < 4) {
      out.push({ icon: 'event_busy', tone: 'warn', title: 'Frekuensi posting rendah',
        body: `${p.postFrequency.value.toFixed(1)} post per 30 hari. Jadwal campaign perlu ruang lebih longgar.` })
    }

    if (p.tier.value === 'Mega' || p.tier.value === 'Macro') {
      out.push({ icon: 'groups', tone: 'info', title: `Tier ${p.tier.value}`,
        body: `Perkiraan ${fmtNum(p.followers.value)} follower. Cocok untuk objective awareness; untuk konversi pertimbangkan kombinasi dengan tier lebih kecil.` })
    }

    return out
  }, [profile, data])

  const TONE = {
    good: { bg: '#eaf5ef', fg: '#3d8a5f' },
    warn: { bg: '#fdf3e7', fg: '#b5761f' },
    info: { bg: '#f0f7fa', fg: '#285D6E' },
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-start gap-2 bg-[#f3f0fb] border border-[#ddd6f3] rounded-xl px-3.5 py-2.5">
        <span className="material-symbols-outlined text-[16px] text-[#6b5bb5] mt-0.5">auto_awesome</span>
        <p className="text-[11.5px] text-[#6b5bb5] leading-relaxed">
          Insight di bawah dihasilkan dari <b>aturan tetap atas metrik akun ini</b>, bukan dari model bahasa.
          Setiap poin bisa ditelusuri ke angka yang mendasarinya, jadi tidak ada kalimat yang tidak punya dasar data.
        </p>
      </div>

      {insights.length === 0 ? (
        <EmptyState icon="auto_awesome" title="Belum cukup data" body="Perlu lebih banyak post untuk menghasilkan insight." />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {insights.map((i, idx) => (
            <Card key={idx} className="p-3.5">
              <div className="flex items-start gap-2.5">
                <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: TONE[i.tone].bg }}>
                  <span className="material-symbols-outlined text-[16px]" style={{ color: TONE[i.tone].fg }}>{i.icon}</span>
                </span>
                <div className="min-w-0">
                  <div style={PJ} className="text-[12.5px] font-bold text-[#111827]">{i.title}</div>
                  <p className="text-[11px] text-[#6b7280] leading-relaxed mt-0.5">{i.body}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Report ───────────────────────────────────────────────────────────────── */

export function KolReportSection({
  profile, data,
}: { profile: KolProfile; data: AccountDetailPayload }) {
  type Row = { metric: string; value: string; confidence: string; basis: string }

  const rows: Row[] = [
    ['Akun', profile.account.username, 'live', 'Dari akun yang terhubung'],
    ['Platform', profile.account.platform, 'live', 'Dari akun yang terhubung'],
    ['Tipe', profile.account.relation === 'owned' ? 'Brand' : 'Kompetitor', 'live', 'Dari relasi organisasi'],
    ['Posts', String(profile.posts.value), profile.posts.confidence, profile.posts.basis],
    ['Total views', String(profile.totalViews.value), profile.totalViews.confidence, profile.totalViews.basis],
    ['Rata-rata views', String(profile.avgViews.value), profile.avgViews.confidence, profile.avgViews.basis],
    ['Engagement rate %', profile.erPct.value.toFixed(2), profile.erPct.confidence, profile.erPct.basis],
    ['Estimated reach', String(profile.estimatedReach.value), profile.estimatedReach.confidence, profile.estimatedReach.basis],
    ['Followers', String(profile.followers.value), profile.followers.confidence, profile.followers.basis],
    ['Tier', profile.tier.value, profile.tier.confidence, profile.tier.basis],
    ['Kategori', profile.category.value, profile.category.confidence, profile.category.basis],
    ['Lokasi', profile.location.value, profile.location.confidence, profile.location.basis],
    ['Lifestyle', profile.lifestyle.value, profile.lifestyle.confidence, profile.lifestyle.basis],
    ['Umur dominan', profile.topAge.value, profile.topAge.confidence, profile.topAge.basis],
    ['Gender (P/L)', `${profile.genderSplit.value.female}/${profile.genderSplit.value.male}`, profile.genderSplit.confidence, profile.genderSplit.basis],
    ['Authenticity', String(profile.authenticity.value), profile.authenticity.confidence, profile.authenticity.basis],
    ['Audience quality', String(profile.audienceQuality.value), profile.audienceQuality.confidence, profile.audienceQuality.basis],
    ['Brand fit', String(profile.brandFit.value), profile.brandFit.confidence, profile.brandFit.basis],
    ['Paid ratio %', profile.paidRatio.value.toFixed(1), profile.paidRatio.confidence, profile.paidRatio.basis],
    ['Paid ER %', profile.paidErPct.value.toFixed(2), profile.paidErPct.confidence, profile.paidErPct.basis],
    ['Organic ER %', profile.organicErPct.value.toFixed(2), profile.organicErPct.confidence, profile.organicErPct.basis],
    ['Top format', profile.topFormat.value, profile.topFormat.confidence, profile.topFormat.basis],
    ['EMV', String(profile.emv.value), profile.emv.confidence, profile.emv.basis],
    ['Base rate', profile.hasRate ? String(profile.baseRate) : '—', 'live', 'Rate card organisasi'],
  ].map(([metric, value, confidence, basis]) => ({ metric, value, confidence, basis }))

  const COLS: ExportColumn<Row>[] = [
    { key: 'metric', header: 'Metrik', value: r => r.metric },
    { key: 'value', header: 'Nilai', value: r => r.value },
    { key: 'confidence', header: 'Keyakinan', value: r => r.confidence },
    { key: 'basis', header: 'Dasar', value: r => r.basis },
  ]

  const name = `kol-${profile.account.username.replace(/[^a-z0-9]/gi, '-')}`

  const print = () => exportPrintable(`KOL Report — ${profile.account.username}`,
    `<h1>${profile.account.username}</h1>
     <div class="sub">${profile.account.platform} · ${profile.account.relation === 'owned' ? 'Brand' : 'Kompetitor'}
     · sumber ${profile.dataSource} · sinkron terakhir ${profile.lastSyncAt?.slice(0, 10) ?? '—'}</div>
     <table><thead><tr><th>Metrik</th><th>Nilai</th><th>Keyakinan</th><th>Dasar</th></tr></thead>
     <tbody>${rows.map(r =>
       `<tr><td>${r.metric}</td><td class="num">${r.value}</td><td>${r.confidence}</td><td>${r.basis}</td></tr>`).join('')}
     </tbody></table>`)

  return (
    <div className="flex flex-col gap-3.5">
      <Card>
        <CardHead title="Individual KOL report"
          sub="Semua metrik beserta tingkat keyakinannya"
          action={
            <div className="flex items-center gap-1.5">
              <Btn size="sm" onClick={() => exportCsv(rows, COLS, name)}>
                <span className="material-symbols-outlined text-[14px]">download</span>CSV
              </Btn>
              <Btn size="sm" onClick={() => exportExcel(rows, COLS, name)}>
                <span className="material-symbols-outlined text-[14px]">table_view</span>Excel
              </Btn>
              <Btn size="sm" onClick={print}>
                <span className="material-symbols-outlined text-[14px]">picture_as_pdf</span>PDF
              </Btn>
            </div>
          } />
        <div className="px-4 pb-3">
          <DataSourceStrip source={profile.dataSource} lastSyncAt={profile.lastSyncAt} confidence={profile.confidence} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px]">
            <thead>
              <tr className="border-b border-[#e5e7eb]">
                {['Metrik', 'Nilai', 'Keyakinan', 'Dasar'].map((h, i) => (
                  <th key={h} style={PJ}
                    className={`text-[10px] font-bold uppercase tracking-wider text-[#9ca3af] px-3 py-2 ${i === 1 ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.metric} className="border-b border-[#f3f4f6] last:border-0">
                  <td className="px-3 py-1.5 text-[11.5px] text-[#374151]">{r.metric}</td>
                  <td style={PJ} className="px-3 py-1.5 text-[11.5px] font-bold text-[#111827] text-right tabular-nums">{r.value}</td>
                  <td className="px-3 py-1.5">
                    <ConfidenceBadge confidence={r.confidence as 'live' | 'calculated' | 'estimated'} basis={r.basis} />
                  </td>
                  <td className="px-3 py-1.5 text-[10.5px] text-[#9ca3af]">{r.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3.5">
        <Card>
          <CardHead title="Demografi umur" sub="Dimodelkan — sumber belum tersedia" />
          <div className="px-4 pb-4">
            <HBars items={profile.ageSplit.value.map((b, i) => ({
              label: b.band, value: b.pct, display: `${b.pct}%`, color: PALETTE[i % PALETTE.length],
            }))} />
          </div>
        </Card>
        <Card>
          <CardHead title="Gender" sub="Dimodelkan — sumber belum tersedia" />
          <div className="px-4 pb-4">
            <Donut segments={[
              { label: 'Perempuan', value: profile.genderSplit.value.female, color: PALETTE[5] },
              { label: 'Laki-laki', value: profile.genderSplit.value.male, color: PALETTE[1] },
            ]} centerLabel={`${profile.genderSplit.value.female}%`} centerSub="perempuan" />
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="Ringkasan komersial" />
        <div className="px-4 pb-4 grid grid-cols-4 gap-3">
          <Mini label="Base rate" value={profile.hasRate ? idr(profile.baseRate) : 'belum diatur'} />
          <Mini label="EMV" node={<MetricValue metric={profile.emv} format={idr} />} />
          <Mini label="Est. reach / post" node={<MetricValue metric={profile.estimatedReach} format={fmtNum} />} />
          <Mini label="Brand fit" node={<MetricValue metric={profile.brandFit} format={v => String(v)} />} />
        </div>
      </Card>
    </div>
  )
}

/* ── bits ─────────────────────────────────────────────────────────────────── */

function Label({ children, tone }: { children: React.ReactNode; tone: 'good' | 'bad' }) {
  return (
    <div style={PJ} className={`text-[10px] font-bold uppercase tracking-widest mb-1.5 ${
      tone === 'good' ? 'text-[#3d8a5f]' : 'text-[#c2553f]'
    }`}>{children}</div>
  )
}

function Li({ children, tone }: { children: React.ReactNode; tone: 'good' | 'bad' }) {
  return (
    <li className="flex items-start gap-1.5 text-[11.5px] text-[#6b7280] leading-relaxed">
      <span className={`material-symbols-outlined text-[13px] mt-0.5 ${
        tone === 'good' ? 'text-[#3d8a5f]' : 'text-[#c2553f]'
      }`}>{tone === 'good' ? 'check_circle' : 'warning'}</span>
      {children}
    </li>
  )
}

function Mini({ label, value, node }: { label: string; value?: string; node?: React.ReactNode }) {
  return (
    <div className="bg-[#f9fafb] rounded-lg px-3 py-2.5">
      <div style={PJ} className="text-[13px] font-extrabold text-[#111827] tabular-nums">{node ?? value}</div>
      <div className="text-[10px] text-[#9ca3af] mt-0.5">{label}</div>
    </div>
  )
}
