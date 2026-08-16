'use client'

/**
 * Profile — the creator navigation's default section, and the two sections that
 * only appear here: Insights, and the AI Snapshot that teases AI Insights.
 *
 * Layout follows the brief: About on the left with its six-field grid,
 * Connected Platforms beside it on the right, and the AI Snapshot full width
 * underneath as the hook into the full analysis.
 *
 * Most of this section is real. About's Category, Niche and Agency come from the
 * roster and its agency tables; Connected Platforms is the creator's actual
 * follower split across the accounts they hold. Collab status and Match are the
 * only sampled fields, and they are marked.
 */

import { PJ, TOKENS as T, PLATFORM_ICON, fmtNum } from './ui'
import { SampleTag, Split, VIZ, VizCard } from './kolViz'
import { platformLabel, type SectionProps } from './KolCreatorSections'

/* ── Profile ──────────────────────────────────────────────────────────────── */

export function ProfileSection({
  creator, identity, rank, platforms, similar, intel, onGoTo,
}: SectionProps & { onGoTo: (id: string) => void }) {
  const name = identity.displayName ?? `@${creator.username}`
  const niche = creator.categories.slice(1).join(' · ')

  return (
    <div className="flex flex-col gap-4">
      <Split
        main={
          <VizCard title="About" subtitle="Creator overview">
            <p className="text-[12.5px] leading-[1.7]" style={{ color: T.t2 }}>
              {creator.bio || (
                <>
                  {name} adalah creator{' '}
                  {creator.categories.length ? <b>{creator.categories.join(' · ')}</b> : 'di roster ini'}
                  {creator.tier && <> di tier <b>{creator.tier}</b></>}
                  {creator.followers !== null && <> dengan <b>{fmtNum(creator.followers)}</b> followers</>}
                  {platforms.length > 1
                    ? <> di {platforms.map(p => platformLabel(p.platform)).join(' dan ')}.</>
                    : <> di {platformLabel(creator.platform)}.</>}
                  {identity.agency && <> Dikelola oleh <b>{identity.agency}</b>.</>}
                </>
              )}
            </p>

            {/* The six fields the brief asks for, as a grid rather than a
                paragraph: each is a lookup, and a lookup reads faster as a cell. */}
            <div className="grid gap-2 mt-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
              <MiniField label="Category" value={creator.categories[0] ?? 'belum diisi'} />
              <MiniField label="Niche" value={niche || 'belum diisi'} />
              <MiniField label="Location" value={creator.city || 'belum diisi'} />
              <MiniField label="Agency" value={identity.agency ?? 'belum diisi'} />
              <MiniField label="Collab" value="Open" sample />
              <MiniField label="Match" value={`${intel.brandFit.score}%`} sample />
            </div>
          </VizCard>
        }
        aside={
          <VizCard title="Connected Platforms" subtitle="Followers by channel">
            <ConnectedPlatforms platforms={platforms} />
          </VizCard>
        }
      />

      {/* Full width, as the brief has it: the teaser that earns the click. */}
      <VizCard title="✦ AI Snapshot" sample
        subtitle={`Why ${identity.displayName ?? `@${creator.username}`} fits your brand`}
        action={
          <button type="button" onClick={() => onGoTo('ai')} style={{ ...PJ, color: T.primary }}
            className="text-[10.5px] font-bold hover:underline whitespace-nowrap">
            Full analysis →
          </button>
        }>
        <div className="flex items-start gap-2.5">
          <span className="material-symbols-outlined text-[18px] mt-px" style={{ color: VIZ.good }}>trending_up</span>
          <p className="text-[12.5px] leading-[1.65]" style={{ color: T.t2 }}>
            {creator.erPct !== null && rank.categoryErPercentile !== null && rank.categoryName ? (
              <>
                Engagement <b>{creator.erPct.toFixed(2)}%</b> menempatkannya di{' '}
                <b>top {Math.max(1, Math.round(100 - rank.categoryErPercentile))}%</b> kategori{' '}
                {rank.categoryName}, dengan audiens autentik{' '}
                <b>{intel.audience.authenticity}%</b> — profil creator papan atas untuk niche ini.
              </>
            ) : (
              <>
                {intel.ai.summary}
              </>
            )}
          </p>
        </div>
      </VizCard>

      {similar.length > 0 && (
        <VizCard title="Similar Creators"
          subtitle={rank.categoryName
            ? `Kategori ${rank.categoryName}, ukuran audiens terdekat — data asli roster`
            : 'Ukuran audiens terdekat di roster — data asli'}>
          <SimilarRow similar={similar} onOpen={id => onGoTo(`creator:${id}`)} />
        </VizCard>
      )}
    </div>
  )
}

function MiniField({ label, value, sample }: { label: string; value: string; sample?: boolean }) {
  return (
    <div className="rounded-[12px] border px-3 py-2.5" style={{ borderColor: T.outline, background: T.surfaceLow }}>
      <div className="flex items-center gap-1">
        <span style={{ ...PJ, color: T.t4 }} className="text-[9px] font-extrabold uppercase tracking-widest">
          {label}
        </span>
        {sample && <SampleTag compact />}
      </div>
      <div style={{ ...PJ, color: T.t1 }} className="text-[12px] font-bold mt-1 break-words">{value}</div>
    </div>
  )
}

/**
 * Followers by channel — a real split, so the bars are proportional to the
 * creator's own largest account rather than to a fixed scale.
 */
function ConnectedPlatforms({ platforms }: { platforms: SectionProps['platforms'] }) {
  const max = Math.max(...platforms.map(p => p.followers ?? 0), 1)
  return (
    <div className="flex flex-col gap-3">
      {platforms.map(p => (
        <div key={p.id}>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="material-symbols-outlined text-[15px]" style={{ color: T.primary }}>
              {PLATFORM_ICON[p.platform ?? ''] ?? 'public'}
            </span>
            <span className="text-[11.5px] flex-1" style={{ color: T.t2 }}>{platformLabel(p.platform)}</span>
            <span style={{ ...PJ, color: T.t1 }} className="text-[11.5px] font-extrabold tabular-nums">
              {p.followers === null ? '—' : fmtNum(p.followers)}
            </span>
          </div>
          <div className="h-[10px] rounded-[4px]" style={{ background: T.outlineSoft }}>
            <div className="h-full rounded-r-[4px]"
              style={{ width: `${Math.max(3, ((p.followers ?? 0) / max) * 100)}%`, background: VIZ.series }} />
          </div>
        </div>
      ))}
      {platforms.length === 1 && (
        <p className="text-[9.5px] leading-[1.45]" style={{ color: T.t4 }}>
          Roster hanya punya satu akun untuk username ini. 277 creator di roster
          terhubung di dua platform.
        </p>
      )}
    </div>
  )
}

function SimilarRow({
  similar, onOpen,
}: { similar: SectionProps['similar']; onOpen: (id: string) => void }) {
  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
      {similar.map(s => (
        <button key={s.id} type="button" onClick={() => onOpen(s.id)}
          style={{ borderColor: T.outline }}
          className="rounded-[14px] border p-3 text-left hover:bg-[#f9fbfc] transition-colors">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0 overflow-hidden"
              style={{ background: T.gradient }}>
              {s.avatarUrl
                // eslint-disable-next-line @next/next/no-img-element -- roster avatars come from CDNs not in next.config
                ? <img src={s.avatarUrl} alt="" className="w-full h-full object-cover" />
                : <span style={PJ} className="text-white text-[11px] font-extrabold">
                    {(s.username.replace(/[^a-z0-9]/gi, '').slice(0, 2) || '?').toUpperCase()}
                  </span>}
            </span>
            <div className="min-w-0">
              <div style={{ ...PJ, color: T.t1 }} className="text-[11.5px] font-bold truncate">@{s.username}</div>
              <div className="text-[10px]" style={{ color: T.t4 }}>
                {platformLabel(s.platform)}{s.tier ? ` · ${s.tier}` : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between mt-2.5">
            <span className="text-[10.5px]" style={{ color: T.t3 }}>
              {s.followers === null ? '—' : fmtNum(s.followers)}
            </span>
            <span style={{ ...PJ, color: T.primaryDeep }} className="text-[10.5px] font-extrabold tabular-nums">
              {s.erPct === null ? 'ER —' : `ER ${s.erPct.toFixed(2)}%`}
            </span>
          </div>
        </button>
      ))}
    </div>
  )
}

/* ── Insights ─────────────────────────────────────────────────────────────── */

/**
 * Key Opportunities — deliberately the most measured section on the page.
 *
 * "Insights" elsewhere in this product means a model's opinion. Here it means
 * what the roster can actually establish about this creator: where they sit,
 * where their audience is concentrated across platforms, whether their rate has
 * ever been measured, and how fresh the row is. Only the last item is sampled,
 * and it says so.
 */
export function InsightsSection({ creator, rank, platforms, similar, intel }: SectionProps) {
  const items: { icon: string; tone: string; title: string; body: React.ReactNode; sample?: boolean }[] = []

  items.push({
    icon: 'leaderboard',
    tone: VIZ.good,
    title: `Peringkat #${rank.followersRank.toLocaleString('id-ID')} dari ${rank.rosterTotal.toLocaleString('id-ID')} creator`,
    body: <>Di atas <b>{rank.followersPercentile}%</b> roster berdasarkan jumlah followers.</>,
  })

  if (rank.categoryName && rank.categoryFollowersRank !== null) {
    items.push({
      icon: 'category',
      tone: VIZ.series,
      title: `Nomor #${rank.categoryFollowersRank} di kategori ${rank.categoryName}`,
      body: <>Dari <b>{rank.categoryTotal.toLocaleString('id-ID')}</b> creator di kategori yang sama —
        pembanding paling relevan saat menyusun shortlist.</>,
    })
  }

  if (creator.erPct !== null && rank.categoryErPercentile !== null && rank.categoryName) {
    const top = Math.max(1, Math.round(100 - rank.categoryErPercentile))
    items.push({
      icon: 'bolt',
      tone: top <= 25 ? VIZ.good : VIZ.warning,
      title: `Engagement ${creator.erPct.toFixed(2)}% — top ${top}% di ${rank.categoryName}`,
      body: <>Diukur terhadap <b>{rank.categoryErTotal.toLocaleString('id-ID')}</b> creator kategori ini
        yang engagement rate-nya pernah diukur.</>,
    })
  } else {
    items.push({
      icon: 'help',
      tone: T.t4,
      title: 'Engagement rate belum pernah diukur',
      body: <>Hanya <b>{rank.erMeasuredTotal.toLocaleString('id-ID')}</b> dari{' '}
        {rank.rosterTotal.toLocaleString('id-ID')} creator yang punya angka ini. Tanpa itu,
        creator ini tidak bisa dibandingkan pada kualitas engagement.</>,
    })
  }

  if (platforms.length > 1) {
    const top = [...platforms].sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0))[0]
    items.push({
      icon: 'hub',
      tone: VIZ.series,
      title: `Audiens terbesar ada di ${platformLabel(top.platform)}`,
      body: <>Terhubung di {platforms.length} platform — {platforms.map(p =>
        `${platformLabel(p.platform)} ${p.followers === null ? '—' : fmtNum(p.followers)}`).join(' · ')}.
        Pilih platform sesuai objektif campaign, bukan sesuai yang paling dikenal.</>,
    })
  }

  if (similar.length > 0) {
    items.push({
      icon: 'group',
      tone: T.t4,
      title: `${similar.length} creator sekelas tersedia di roster`,
      body: <>Kategori dan ukuran audiens serupa — layak dibandingkan sebelum harga disepakati.</>,
    })
  }

  items.push({
    icon: 'movie',
    tone: VIZ.warning,
    title: `Format ${intel.content.formats[0]?.label ?? 'video'} paling kuat`,
    body: <>Menyumbang <b>{intel.content.formats[0]?.pct ?? 0}%</b> performa kontennya.</>,
    sample: true,
  })

  return (
    <div className="flex flex-col gap-4">
      <VizCard title="✦ Key Opportunities"
        subtitle="Kecuali yang bertanda, seluruhnya dihitung dari roster">
        <ol className="flex flex-col">
          {items.map((it, i) => (
            <li key={it.title} className="flex items-start gap-3 py-3"
              style={{ borderBottom: i < items.length - 1 ? `1px solid ${T.outlineSoft}` : undefined }}>
              <span style={{ ...PJ, background: T.surfaceVariant, color: T.primaryDeep }}
                className="w-6 h-6 rounded-lg text-[11px] font-extrabold inline-flex items-center justify-center flex-shrink-0">
                {i + 1}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="material-symbols-outlined text-[15px]" style={{ color: it.tone }}>{it.icon}</span>
                  <span style={{ ...PJ, color: T.t1 }} className="text-[12px] font-extrabold">{it.title}</span>
                  {it.sample && <SampleTag compact />}
                </div>
                <p className="text-[11.5px] leading-[1.55] mt-1" style={{ color: T.t3 }}>{it.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </VizCard>
    </div>
  )
}
