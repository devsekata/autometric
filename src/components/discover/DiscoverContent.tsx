'use client'

/**
 * Discovery Content — port of the source platform's `pages/discovery.js`.
 *
 * Structure is preserved 1:1 (format tabs, search, collapsible right-hand
 * filter panel with a vertical re-open tab, sortable grid of post cards,
 * bookmark-to-Inspirations), but the content is live: it browses this org's own
 * brand posts and its tracked competitors' posts instead of the source's
 * hardcoded 12-item CONTENT array.
 *
 * Filtering and sorting run server-side. The source filtered a client-side
 * array; here the corpus is ~1k+ rows per org and grows with every sync, so the
 * query layer does the work and this component only holds filter state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Btn, Chip, DiscoverHeader, EmptyState, ErrorState, FilterGroup, FORMAT_ICON,
  PLATFORM_ICON, PJ, SelectPill, SourceTag, Spinner, TabStrip,
  fmtAge, fmtNum, gradientFor,
} from './ui'
import type {
  DiscoverContentPayload, DiscoverFilters, DiscoverFormat, DiscoverPost,
} from '@/lib/discover/types'
import { DEFAULT_DISCOVER_FILTERS } from '@/lib/discover/types'

const FORMAT_TABS: { id: DiscoverFormat | 'All'; label: string; icon: string }[] = [
  { id: 'All', label: 'All', icon: 'apps' },
  { id: 'Reel', label: 'Reels', icon: 'movie' },
  { id: 'Carousel', label: 'Carousel', icon: 'collections' },
  { id: 'Image', label: 'Image', icon: 'image' },
  { id: 'Video', label: 'Video', icon: 'smart_display' },
  { id: 'Post', label: 'Other', icon: 'article' },
]

const SORT_LABEL: Record<DiscoverFilters['sort'], string> = {
  views: 'Most viewed', likes: 'Most liked', er: 'Highest ER', new: 'Newest', old: 'Oldest',
}

const ER_OPTS = [
  { label: 'Any engagement', value: 0 }, { label: '≥ 1% ER', value: 1 },
  { label: '≥ 3% ER', value: 3 }, { label: '≥ 5% ER', value: 5 },
]
const LIKE_OPTS = [
  { label: 'Any likes', value: 0 }, { label: '≥ 1K likes', value: 1000 },
  { label: '≥ 10K likes', value: 10000 }, { label: '≥ 50K likes', value: 50000 },
]
const VIEW_OPTS = [
  { label: 'Any views', value: 0 }, { label: '≥ 100K views', value: 100000 },
  { label: '≥ 500K views', value: 500000 }, { label: '≥ 1M views', value: 1000000 },
]
const DATE_OPTS: { label: string; value: number | 'all' }[] = [
  { label: 'Any date', value: 'all' }, { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 }, { label: 'Last 180 days', value: 180 },
]

export default function DiscoverContent({
  orgId, orgSlug, embedded = false,
}: { orgId: string; orgSlug: string; embedded?: boolean }) {
  const [filters, setFilters] = useState<DiscoverFilters>(DEFAULT_DISCOVER_FILTERS)
  const [panelOpen, setPanelOpen] = useState(true)
  const [data, setData] = useState<DiscoverContentPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [savedCount, setSavedCount] = useState(0)

  // Debounced so typing in the search box doesn't fire a query per keystroke.
  const [queryInput, setQueryInput] = useState('')
  useEffect(() => {
    const t = setTimeout(() => set({ q: queryInput, page: 1 }), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryInput])

  const set = useCallback((patch: Partial<DiscoverFilters>) => {
    // Any filter change invalidates the current page number unless the caller
    // is explicitly paging.
    setFilters(f => ({ ...f, page: 1, ...patch }))
  }, [])

  const qs = useMemo(() => {
    const p = new URLSearchParams()
    p.set('q', filters.q)
    p.set('format', filters.format)
    p.set('platform', filters.platform)
    p.set('pillar', filters.pillar)
    p.set('type', filters.type)
    p.set('source', filters.source)
    p.set('erMin', String(filters.erMin))
    p.set('likesMin', String(filters.likesMin))
    p.set('viewsMin', String(filters.viewsMin))
    p.set('days', String(filters.days))
    p.set('sort', filters.sort)
    p.set('page', String(filters.page))
    p.set('pageSize', String(filters.pageSize))
    return p.toString()
  }, [filters])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetch(`/api/organizations/${orgId}/discover/content?${qs}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: DiscoverContentPayload) => {
        if (cancelled) return
        setData(d); setSavedCount(d.savedCount)
      })
      .catch(e => { if (!cancelled) setError(String(e.message ?? e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [orgId, qs])

  /** Optimistic bookmark toggle; reverts if the request fails. */
  const toggleSave = useCallback(async (post: DiscoverPost) => {
    setData(d => d && ({
      ...d,
      posts: d.posts.map(p => (p.key === post.key ? { ...p, saved: !p.saved } : p)),
    }))
    setSavedCount(c => c + (post.saved ? -1 : 1))
    try {
      const res = await fetch(`/api/organizations/${orgId}/discover/inspirations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: post.source, postRowId: post.rowId, platform: post.platform }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { saved, count } = await res.json()
      setData(d => d && ({
        ...d, posts: d.posts.map(p => (p.key === post.key ? { ...p, saved } : p)),
      }))
      setSavedCount(count)
    } catch {
      setData(d => d && ({
        ...d, posts: d.posts.map(p => (p.key === post.key ? { ...p, saved: post.saved } : p)),
      }))
      setSavedCount(c => c + (post.saved ? 1 : -1))
    }
  }, [orgId])

  const activeCount =
    (filters.platform !== 'all' ? 1 : 0) + (filters.pillar !== 'all' ? 1 : 0) +
    (filters.type !== 'all' ? 1 : 0) + (filters.source !== 'all' ? 1 : 0) +
    (filters.erMin > 0 ? 1 : 0) + (filters.likesMin > 0 ? 1 : 0) +
    (filters.viewsMin > 0 ? 1 : 0) + (filters.days !== 'all' ? 1 : 0)

  const clearAll = () => {
    setQueryInput('')
    setFilters({ ...DEFAULT_DISCOVER_FILTERS, sort: filters.sort })
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className={embedded ? '' : 'p-5 max-w-[1500px] mx-auto'}>
      <DiscoverHeader
        title="Discovery Content"
        subtitle={
          data
            ? `${data.total} of ${data.grandTotal} pieces · cari caption, hashtag & akun, lalu simpan inspirasi untuk brief kamu`
            : 'Cari caption, hashtag & akun dari konten brand dan kompetitor kamu'
        }
        actions={
          <>
            <Btn variant="secondary" onClick={() => set({ source: filters.source === 'brand' ? 'all' : 'brand' })}>
              <span className="material-symbols-outlined text-[15px]">bookmarks</span>
              Inspirations ({savedCount})
            </Btn>
            {/* Goes to the Ordering Flow, which is where a campaign is actually
                created. It used to point at Campaign Content — a read-only
                analytics page — so the button never created anything. */}
            <Btn variant="primary" onClick={() => { window.location.href = `/organizations/${orgSlug}/discover/kol?tab=ordering` }}>
              <span className="material-symbols-outlined text-[15px]">campaign</span>
              Create Campaign
            </Btn>
          </>
        }
      />

      <TabStrip
        tabs={FORMAT_TABS}
        value={filters.format}
        onChange={v => set({ format: v })}
      />

      <div className="flex items-center gap-2.5 flex-wrap my-3">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-[#9ca3af]">search</span>
          <input
            value={queryInput}
            onChange={e => setQueryInput(e.target.value)}
            placeholder="Cari caption, hashtag, nama akun…"
            className="w-[320px] max-w-full h-8 pl-8 pr-3 rounded-lg border border-[#e5e7eb] text-[12px] text-[#374151] placeholder:text-[#9ca3af] focus:outline-none focus:border-[#327488]"
          />
        </div>
        <span className="text-[11px] text-[#9ca3af]">
          {SORT_LABEL[filters.sort]}
          {activeCount > 0 && ` · ${activeCount} filter${activeCount > 1 ? 's' : ''} aktif`}
        </span>
        {(activeCount > 0 || filters.q) && (
          <Btn variant="ghost" size="sm" onClick={clearAll}>
            <span className="material-symbols-outlined text-[14px]">close</span>Clear
          </Btn>
        )}
      </div>

      <div
        className="grid items-start gap-4"
        style={{ gridTemplateColumns: `minmax(0,1fr) ${panelOpen ? '248px' : '32px'}` }}
      >
        <div className="min-w-0">
          {error ? <ErrorState message={error} />
            : loading && !data ? <Spinner />
            : !data || data.posts.length === 0 ? (
              <EmptyState
                title="Tidak ada konten yang cocok"
                body="Coba kata kunci lain, ganti tab format, atau hapus filternya."
                action={<Btn variant="secondary" size="sm" onClick={clearAll}>Clear all filters</Btn>}
              />
            ) : (
              <>
                <div
                  className={`grid gap-3.5 ${loading ? 'opacity-60 transition-opacity' : ''}`}
                  style={{ gridTemplateColumns: `repeat(${panelOpen ? 3 : 4}, minmax(0,1fr))` }}
                >
                  {data.posts.map(p => (
                    <PostCard key={p.key} post={p} onToggleSave={() => toggleSave(p)} />
                  ))}
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-5">
                    <Btn size="sm" disabled={filters.page <= 1}
                      onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}>
                      <span className="material-symbols-outlined text-[14px]">chevron_left</span>Prev
                    </Btn>
                    <span style={PJ} className="text-[11.5px] font-bold text-[#6b7280]">
                      {filters.page} / {totalPages}
                    </span>
                    <Btn size="sm" disabled={filters.page >= totalPages}
                      onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}>
                      Next<span className="material-symbols-outlined text-[14px]">chevron_right</span>
                    </Btn>
                  </div>
                )}
              </>
            )}
        </div>

        {panelOpen
          ? <FilterPanel filters={filters} pillars={data?.pillars ?? []} set={set}
              onClear={clearAll} onCollapse={() => setPanelOpen(false)} />
          : <CollapsedTab active={activeCount} onOpen={() => setPanelOpen(true)} />}
      </div>
    </div>
  )
}

/* ── grid card ────────────────────────────────────────────────────────────── */

function PostCard({ post, onToggleSave }: { post: DiscoverPost; onToggleSave: () => void }) {
  // Brand cover URLs point at an external CDN that may 404; fall back to the
  // deterministic gradient rather than showing a broken image box.
  const [imgOk, setImgOk] = useState(true)
  const showImg = !!post.coverImage && imgOk

  return (
    <div className="bg-white border border-[#e5e7eb] rounded-xl overflow-hidden hover:shadow-md hover:border-[#A7C8D4] transition-all">
      <div className="relative h-[118px]" style={{ background: gradientFor(post.key) }}>
        {showImg && (
          // eslint-disable-next-line @next/next/no-img-element -- external CDN host is not in next.config remotePatterns
          <img src={post.coverImage!} alt="" className="w-full h-full object-cover"
            onError={() => setImgOk(false)} />
        )}
        <span className="absolute top-2 left-2 w-6 h-6 rounded-md bg-white/90 flex items-center justify-center">
          <span className="material-symbols-outlined text-[14px] text-[#285D6E]">
            {PLATFORM_ICON[post.platform] ?? 'public'}
          </span>
        </span>
        {!showImg && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="material-symbols-outlined text-[30px] text-white/70">
              {FORMAT_ICON[post.format] ?? 'article'}
            </span>
          </span>
        )}
        <span className="absolute bottom-2 left-2 text-[10px] font-bold text-white bg-black/45 rounded px-1.5 py-0.5">
          {fmtNum(post.views)} views
        </span>
        <button
          type="button"
          onClick={onToggleSave}
          title={post.saved ? 'Tersimpan di Inspirations' : 'Simpan ke Inspirations'}
          className={`absolute top-2 right-2 w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
            post.saved ? 'bg-[#327488] text-white' : 'bg-white/90 text-[#6b7280] hover:text-[#285D6E]'
          }`}
        >
          <span className="material-symbols-outlined text-[14px]">
            {post.saved ? 'bookmark_added' : 'bookmark_add'}
          </span>
        </button>
      </div>

      <div className="p-2.5">
        <div className="flex items-center gap-1.5">
          <span style={PJ} className="flex-1 truncate text-[12px] font-bold text-[#111827]">
            {post.author}
          </span>
          <SourceTag source={post.source} />
        </div>

        <p className="text-[10.5px] text-[#6b7280] leading-[1.45] mt-1 h-[30px] overflow-hidden">
          {post.caption || '—'}
        </p>

        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <span className="text-[10px] text-[#9ca3af]">{post.format}</span>
          <span className="text-[10px] text-[#d1d5db]">·</span>
          <span className="text-[10px] text-[#9ca3af]">{fmtAge(post.ageDays)}</span>
          {post.pillar && (
            <>
              <span className="text-[10px] text-[#d1d5db]">·</span>
              <span className="text-[10px] text-[#285D6E] font-semibold">{post.pillar}</span>
            </>
          )}
          {post.sponsored && (
            <span className="text-[9px] font-extrabold uppercase bg-[#fdf3e7] text-[#b5761f] rounded px-1.5 py-0.5">
              Sponsored
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-[#f3f4f6]">
          <Metric icon="favorite" value={fmtNum(post.likes)} />
          <Metric icon="chat_bubble" value={fmtNum(post.comments)} />
          <Metric icon="bolt" value={`${post.erPct.toFixed(1)}%`} />
        </div>
      </div>
    </div>
  )
}

function Metric({ icon, value }: { icon: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-[#6b7280]">
      <span className="material-symbols-outlined text-[13px] text-[#9ca3af]">{icon}</span>
      {value}
    </span>
  )
}

/* ── filter panel ─────────────────────────────────────────────────────────── */

function FilterPanel({
  filters, pillars, set, onClear, onCollapse,
}: {
  filters: DiscoverFilters; pillars: string[]
  set: (p: Partial<DiscoverFilters>) => void; onClear: () => void; onCollapse: () => void
}) {
  return (
    <aside className="bg-white border border-[#e5e7eb] rounded-xl p-3 sticky top-4 self-start">
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-[17px] text-[#327488]">tune</span>
        <span style={PJ} className="flex-1 text-[12.5px] font-extrabold text-[#111827]">Filters &amp; Sort</span>
        <button type="button" onClick={onClear}
          className="text-[10.5px] font-bold text-[#327488] hover:underline">Clear</button>
        <button type="button" onClick={onCollapse} title="Collapse"
          className="material-symbols-outlined text-[17px] text-[#9ca3af] hover:text-[#374151] cursor-pointer">
          chevron_right
        </button>
      </div>

      <div className="max-h-[640px] overflow-y-auto pr-1">
        <FilterGroup icon="sort" title="Sort by">
          {(['new', 'old', 'views', 'likes', 'er'] as const).map(s => (
            <Chip key={s} label={SORT_LABEL[s]} on={filters.sort === s} onClick={() => set({ sort: s })} />
          ))}
        </FilterGroup>

        <FilterGroup icon="inventory_2" title="Source">
          {([['all', 'Semua'], ['brand', 'Brand kamu'], ['competitor', 'Kompetitor']] as const).map(([v, l]) => (
            <Chip key={v} label={l} on={filters.source === v} onClick={() => set({ source: v })} />
          ))}
        </FilterGroup>

        <FilterGroup icon="hub" title="Platform">
          {([['all', 'All Platform'], ['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['facebook', 'Facebook']] as const).map(([v, l]) => (
            <Chip key={v} label={l} on={filters.platform === v} onClick={() => set({ platform: v })}
              icon={v === 'all' ? undefined : PLATFORM_ICON[v]} />
          ))}
        </FilterGroup>

        <FilterGroup icon="sell" title="Type">
          {([['all', 'Organic + Sponsored'], ['organic', 'Organic'], ['sponsored', 'Sponsored']] as const).map(([v, l]) => (
            <Chip key={v} label={l} on={filters.type === v} onClick={() => set({ type: v })} />
          ))}
        </FilterGroup>

        {pillars.length > 0 && (
          <FilterGroup icon="category" title="Content Pillar">
            <Chip label="All" on={filters.pillar === 'all'} onClick={() => set({ pillar: 'all' })} />
            {pillars.map(p => (
              <Chip key={p} label={p} on={filters.pillar === p} onClick={() => set({ pillar: p })} />
            ))}
          </FilterGroup>
        )}

        <div className="mb-1">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="material-symbols-outlined text-[14px] text-[#9ca3af]">filter_alt</span>
            <span style={PJ} className="text-[10.5px] font-bold uppercase tracking-widest text-[#9ca3af]">
              Performance &amp; Date
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <SelectPill icon="bolt" label="Engagement" value={filters.erMin}
              options={ER_OPTS} onChange={v => set({ erMin: v })} />
            <SelectPill icon="favorite" label="Likes" value={filters.likesMin}
              options={LIKE_OPTS} onChange={v => set({ likesMin: v })} />
            <SelectPill icon="play_circle" label="Views" value={filters.viewsMin}
              options={VIEW_OPTS} onChange={v => set({ viewsMin: v })} />
            <SelectPill icon="calendar_today" label="Any date" value={filters.days}
              options={DATE_OPTS} onChange={v => set({ days: v })} />
          </div>
        </div>
      </div>
    </aside>
  )
}

/** Vertical re-open tab shown when the panel is collapsed (source: `discTabHTML`). */
function CollapsedTab({ active, onOpen }: { active: number; onOpen: () => void }) {
  return (
    <div className="sticky top-4 flex justify-end">
      <button
        type="button"
        onClick={onOpen}
        title="Buka filter & sorting"
        style={{ ...PJ, writingMode: 'vertical-rl' }}
        className="flex items-center gap-1.5 px-1.5 py-3 rounded-l-xl bg-gradient-to-br from-[#285D6E] to-[#4E96AC] text-white text-[11px] font-extrabold tracking-wide shadow-md select-none cursor-pointer"
      >
        <span className="material-symbols-outlined text-[15px]" style={{ writingMode: 'horizontal-tb' }}>tune</span>
        Filters
        {active > 0 && (
          <span style={{ writingMode: 'horizontal-tb' }}
            className="bg-white text-[#285D6E] rounded-full text-[9px] px-1.5 font-extrabold">
            {active}
          </span>
        )}
      </button>
    </div>
  )
}
