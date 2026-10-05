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

/** Shown wherever the warehouse holds no reading. Never '0', never 'null'. */
const NOT_MEASURED = 'Belum terukur'

/**
 * Why a demographics chart is missing.
 *
 * Keeps the competitor explanation the Account Signals card already carried:
 * a competitor is scraped from public content, and scraping cannot return an
 * audience breakdown - so this will never fill in, and saying so is kinder than
 * an empty panel that looks like a loading state.
 */
function DemographicsUnavailable({ profile }: { profile: KolProfile }) {
  return (
    <p className="text-[11px] leading-relaxed text-[#6b7280]">
      <b style={PJ}>{NOT_MEASURED}</b> — platform belum melaporkan demografi audiens untuk akun ini.
      {profile.account.relation === 'competitor'
        ? ' Akun kompetitor di-scrape dari konten publik, dan scraping tidak pernah mengembalikan demografi audiens.'
        : ' Meta dan TikTok baru membuka breakdown ini setelah audiens akun melewati ambang minimum mereka.'}
    </p>
  )
}

/* -- Account Signals ------------------------------------------------------- */

/**
 * What this tracked account measurably is - performance, cadence, audience.
 *
 * This was `BrandFitSection`, and it led with a 0-100 "Brand fit" score over a
 * four-input breakdown. Three of those four inputs had no real source for this
 * population: authenticity was a hash of the account id mapped to 68-96,
 * audience quality was 30% that same number, and the headline score was 65% the
 * two of them. The breakdown made it look auditable, which made it worse - a
 * reader could see the weights and reasonably conclude the inputs were real.
 *
 * It is not renamed to be tactful. Brand fit is a property of a creator AND a
 * brand, the Brand Match Engine owns it, and that engine scores creators in
 * `public.kol_directory`. A tracked account is not in that table, so there is no
 * honest brand-fit number to show here at all - not a smaller one, not a hedged
 * one. What is left is what the warehouse actually measured about the account.
 */
export function AccountSignalsSection({ profile }: { profile: KolProfile }) {
  /*
   * Every row is a live measurement from this account's own posts or its
   * profile snapshot. `max` is what the bar is drawn against - a scale, not a
   * target the account is being judged against.
   */
  const signals: {
    label: string; value: number | null; max: number
    fmt: (v: number) => string; basis: string
  }[] = [
    {
      label: 'Engagement rate', value: profile.erPct.value, max: 8,
      fmt: v => `${v.toFixed(2)}%`, basis: profile.erPct.basis,
    },
    {
      label: 'Frekuensi posting', value: profile.postFrequency.value, max: 20,
      fmt: v => `${v.toFixed(1)} / 30 hari`, basis: profile.postFrequency.basis,
    },
    {
      label: 'Rasio konten berbayar', value: profile.paidRatio.value, max: 100,
      fmt: v => `${v.toFixed(0)}%`, basis: profile.paidRatio.basis,
    },
    {
      label: 'Followers', value: profile.followers.value,
      max: Math.max(1, profile.followers.value ?? 1),
      fmt: fmtNum, basis: profile.followers.basis,
    },
  ]

  const demographicsKnown = profile.ageBands.value.length > 0
    || profile.genderBands.value.length > 0
    || profile.location.value !== null

  return (
    <div className="flex flex-col gap-3.5">
      <Card>
        <CardHead title="Sinyal akun" sub="Yang benar-benar terukur dari post dan snapshot profil akun ini" />
        <div className="px-4 pb-4 flex flex-col gap-2.5">
          {signals.map(sig => (
            <div key={sig.label}>
              <div className="flex items-center justify-between text-[11.5px]">
                <span className="text-[#374151]">{sig.label}</span>
                {sig.value === null
                  ? <span className="text-[10.5px] font-semibold text-[#9ca3af]">Belum terukur</span>
                  : <b style={PJ} className="tabular-nums text-[#111827]">{sig.fmt(sig.value)}</b>}
              </div>
              {sig.value !== null && (
                <div className="h-1.5 rounded-full bg-[#f3f4f6] mt-1 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#4E96AC]"
                    style={{ width: `${Math.min(100, (sig.value / sig.max) * 100)}%` }}
                  />
                </div>
              )}
              <p className="text-[10px] text-[#9ca3af] mt-0.5">{sig.basis}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHead title="Audiens" sub="Demografi dari platform insights - hanya tersedia untuk akun yang kamu miliki" />
        <div className="px-4 pb-4">
          {demographicsKnown ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label tone="good">Umur</Label>
                {profile.ageBands.value.length ? (
                  <ul className="flex flex-col gap-1">
                    {profile.ageBands.value.slice(0, 4).map(b => (
                      <li key={b.label} className="flex items-center justify-between text-[11.5px] text-[#374151]">
                        <span>{b.label}</span>
                        <b style={PJ} className="tabular-nums">{b.pct}%</b>
                      </li>
                    ))}
                  </ul>
                ) : <Unmeasured />}
              </div>
              <div>
                <Label tone="good">Gender &amp; lokasi</Label>
                {profile.genderBands.value.length ? (
                  <ul className="flex flex-col gap-1">
                    {profile.genderBands.value.slice(0, 3).map(b => (
                      <li key={b.label} className="flex items-center justify-between text-[11.5px] text-[#374151]">
                        <span>{b.label}</span>
                        <b style={PJ} className="tabular-nums">{b.pct}%</b>
                      </li>
                    ))}
                  </ul>
                ) : <Unmeasured />}
                {profile.location.value && (
                  <p className="text-[11.5px] text-[#374151] mt-1.5">
                    Kota teratas: <b style={PJ}>{profile.location.value}</b>
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[11.5px] leading-relaxed text-[#6b7280]">
              Platform belum melaporkan demografi audiens untuk akun ini.
              {profile.account.relation === 'competitor'
                ? ' Akun kompetitor di-scrape dari konten publik, dan scraping tidak pernah mengembalikan demografi audiens - jadi ini tidak akan terisi.'
                : ' Meta dan TikTok baru membuka breakdown ini setelah audiens akun melewati ambang minimum mereka.'}
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHead title="Pertimbangan" sub="Hal yang mendukung dan yang perlu diperhatikan" />
        <div className="px-4 pb-4 grid grid-cols-2 gap-4">
          <div>
            <Label tone="good">Mendukung</Label>
            <ul className="flex flex-col gap-1">
              {profile.erPct.value >= 3 && <Li tone="good">Engagement rate {profile.erPct.value.toFixed(2)}% di atas rata-rata pasar</Li>}
              {profile.postFrequency.value >= 8 && <Li tone="good">Posting konsisten, {profile.postFrequency.value.toFixed(1)} post per 30 hari</Li>}
              {profile.paidRatio.value > 0 && profile.paidErPct.value >= profile.organicErPct.value &&
                <Li tone="good">Konten berbayar tetap perform sebaik organik</Li>}
              {profile.campaignLift.value !== null && profile.campaignLift.value >= 1 &&
                <Li tone="good">ER campaign {profile.campaignLift.value.toFixed(2)}x baseline akun ini sendiri</Li>}
            </ul>
          </div>
          <div>
            <Label tone="bad">Perlu diperhatikan</Label>
            <ul className="flex flex-col gap-1">
              {profile.erPct.value < 2 && <Li tone="bad">Engagement rate rendah ({profile.erPct.value.toFixed(2)}%)</Li>}
              {profile.paidRatio.value > 60 && <Li tone="bad">Rasio konten berbayar tinggi ({profile.paidRatio.value.toFixed(0)}%) - risiko audience fatigue</Li>}
              {profile.postFrequency.value < 4 && <Li tone="bad">Frekuensi posting rendah</Li>}
              {profile.followers.value === null && <Li tone="bad">Jumlah follower belum tersinkron</Li>}
              {!profile.hasRate && <Li tone="bad">Belum ada rate card, biaya belum bisa dihitung</Li>}
              {profile.account.relation === 'competitor' && <Li tone="bad">Ini akun kompetitor - data terbatas pada post publik</Li>}
            </ul>
          </div>
        </div>
      </Card>
    </div>
  )
}

/** The honest stand-in for a breakdown the platform has not reported. */
function Unmeasured() {
  return <p className="text-[11px] text-[#9ca3af]">Belum terukur</p>
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

    // Tier and followers are both real now, so the copy drops "Perkiraan".
    // Guarded on the follower count rather than on the tier alone: tier is
    // derived from it, so a null count means there is no tier to talk about.
    if (p.followers.value !== null && (p.tier.value === 'Mega' || p.tier.value === 'Macro')) {
      out.push({ icon: 'groups', tone: 'info', title: `Tier ${p.tier.value}`,
        body: `${fmtNum(p.followers.value)} follower. Cocok untuk objective awareness; untuk konversi pertimbangkan kombinasi dengan tier lebih kecil.` })
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
    // Real now, and nullable. "Belum terukur" rather than "null" or a zero:
    // this table is the one a user exports and forwards.
    ['Followers', profile.followers.value === null ? NOT_MEASURED : String(profile.followers.value), profile.followers.confidence, profile.followers.basis],
    ['Tier', profile.tier.value ?? NOT_MEASURED, profile.tier.confidence, profile.tier.basis],
    // Kategori and Lifestyle rows removed: both were a coin flip per account.
    ['Kota audiens teratas', profile.location.value ?? NOT_MEASURED, profile.location.confidence, profile.location.basis],

    ['Umur dominan', profile.topAge.value ?? NOT_MEASURED, profile.topAge.confidence, profile.topAge.basis],
    ['Audiens perempuan %', profile.femalePct.value === null ? NOT_MEASURED : String(profile.femalePct.value), profile.femalePct.confidence, profile.femalePct.basis],
    // Authenticity, Audience quality and Brand fit are gone from this table.
    // All three were generated from a hash of the account id, and a report is
    // the worst place for that: it leaves the screen and outlives its caveats.
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

      {/* Both charts read REAL platform-insight demographics now.
          They previously drew `ageSplit` and `genderSplit` - six random age
          bands and a random female share, both hashed from the account id.
          The card subtitles said "Dimodelkan", which was true and not enough:
          a chart is read as a measurement whatever the subtitle says.

          `ageBands` / `genderBands` come from `l0_raw.*_profile_snapshots` via
          `@/lib/discover/accountFacts`. Empty for every competitor by
          construction - the insights API only answers for an account you hold a
          token for - and for owned accounts below the platform's reporting
          threshold. Empty draws the unavailable state, never a chart. */}
      <div className="grid grid-cols-2 gap-3.5">
        <Card>
          <CardHead title="Demografi umur" sub="Dari platform insights" />
          <div className="px-4 pb-4">
            {profile.ageBands.value.length ? (
              <HBars items={profile.ageBands.value.map((b, i) => ({
                label: b.label, value: b.pct, display: `${b.pct}%`, color: PALETTE[i % PALETTE.length],
              }))} />
            ) : <DemographicsUnavailable profile={profile} />}
          </div>
        </Card>
        <Card>
          <CardHead title="Gender" sub="Dari platform insights" />
          <div className="px-4 pb-4">
            {profile.genderBands.value.length ? (
              <Donut
                segments={profile.genderBands.value.map((b, i) => ({
                  label: b.label, value: b.pct, color: PALETTE[(i + 5) % PALETTE.length],
                }))}
                centerLabel={profile.femalePct.value === null ? '—' : `${profile.femalePct.value}%`}
                centerSub="perempuan" />
            ) : <DemographicsUnavailable profile={profile} />}
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="Ringkasan komersial" />
        <div className="px-4 pb-4 grid grid-cols-4 gap-3">
          <Mini label="Base rate" value={profile.hasRate ? idr(profile.baseRate) : 'belum diatur'} />
          {/* EMV has no real source - see `profile.emv`. Stated as
              unavailable rather than dropped, so the absence is visible. */}
          <Mini label="EMV" node={<span className="text-[10.5px] font-semibold text-[#9ca3af]">{NOT_MEASURED}</span>} />
          {/* `MetricValue` renders a number with its confidence badge and has
              no null branch; the unavailable case is handled here so the badge
              is not drawn over an absent value. */}
          <Mini
            label="Reach / post"
            node={profile.estimatedReach.value === null
              ? <span className="text-[10.5px] font-semibold text-[#9ca3af]">{NOT_MEASURED}</span>
              : <MetricValue metric={{ ...profile.estimatedReach, value: profile.estimatedReach.value }} format={fmtNum} />}
          />
          {/* Was "Brand fit" — generated, no real source for tracked accounts.
              Posting cadence is measured from this account's own posts and is
              the commercial fact this slot can actually answer. */}
          <Mini label="Post / 30 hari" node={<MetricValue metric={profile.postFrequency} format={v => v.toFixed(1)} />} />
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
