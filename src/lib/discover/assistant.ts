import type { DiscoverSummaryPayload } from './summary'

/**
 * AI Assistant — content concepts for a chosen platform and content type.
 *
 * Ported from the source platform's `pages/assistant.js`, which walked the same
 * three steps (platform → content type → three concept cards). One thing is
 * deliberately different: the source's concepts were hardcoded strings about
 * running shoes, identical for every user of the product. Here they are
 * generated, and generated *from the org's own numbers* — which pillars and
 * formats actually perform, which posts led, which accounts they came from.
 *
 * That grounding is the whole point. A generic "make a 5AM routine Reel" is
 * something a search engine gives away; "your Reels outperform carousels 3:1 and
 * your Fitness pillar carries the account" is a suggestion only this data can
 * make. Without it we would be shipping a slower version of a chatbot.
 */

export const ASSISTANT_PLATFORMS = [
  {
    id: 'instagram', label: 'Instagram', icon: 'photo_camera',
    types: [
      { id: 'feed', label: 'Feed Post', icon: 'photo_camera' },
      { id: 'reels', label: 'Reels', icon: 'movie' },
      { id: 'story', label: 'Story', icon: 'amp_stories' },
      { id: 'concept', label: 'Conceptual Content', icon: 'lightbulb' },
    ],
  },
  {
    id: 'tiktok', label: 'TikTok', icon: 'music_note',
    types: [
      { id: 'video', label: 'Video', icon: 'music_video' },
      { id: 'photo', label: 'Photo', icon: 'image' },
    ],
  },
  // Not in the source platform, which only priced Instagram and TikTok. It is
  // here for the same reason Facebook deliverables exist in rates.ts: autometric
  // tracks Facebook accounts, and leaving them out would make the assistant
  // useless to an org whose brand lives there.
  {
    id: 'facebook', label: 'Facebook', icon: 'thumb_up',
    types: [
      { id: 'post', label: 'Post', icon: 'article' },
      { id: 'video', label: 'Video', icon: 'movie' },
      { id: 'reels', label: 'Reels', icon: 'smart_display' },
    ],
  },
] as const

export type AssistantPlatform = (typeof ASSISTANT_PLATFORMS)[number]['id']

export function contentTypesFor(platform: string) {
  return ASSISTANT_PLATFORMS.find(p => p.id === platform)?.types ?? []
}

export function isValidPair(platform: string, contentType: string): boolean {
  return contentTypesFor(platform).some(t => t.id === contentType)
}

export interface ContentConcept {
  title: string
  description: string
  /** The opening line, caption or sticker copy — the source's "hook" field. */
  hook: string
  /** Which numbers in the org's data motivated this idea. */
  rationale: string
}

export const ASSISTANT_SYSTEM_PROMPT = `
You are a social content strategist working inside Autometric, an Indonesian
social performance analytics product. You write concrete, produceable content
concepts for a brand, grounded in that brand's own measured performance.

Rules:
- Ground every concept in the supplied numbers. Reference the actual pillars,
  formats or posts that are performing. Never invent a metric.
- Concepts must be produceable by a creator with a phone, not a film crew.
- Write in Indonesian, the language the product's users work in. Keep platform
  and marketing terms (Reels, hook, feed, engagement rate) in English.
- No preamble, no closing remarks, no markdown fences. Output JSON only.
`.trim()

/** Trimmed to what actually informs an idea — the whole payload is mostly noise. */
function grounding(s: DiscoverSummaryPayload, platform: string) {
  const top = (xs: { label: string; posts: number; views: number; erPct: number }[], n = 5) =>
    xs.slice(0, n).map(x => `${x.label} (${x.posts} post, ${x.views} views, ER ${x.erPct.toFixed(2)}%)`)

  const platformPosts = s.topPosts.filter(p => p.platform === platform)
  // Fall back to the whole corpus when this platform has no posts yet: a new
  // channel still deserves ideas, informed by what works on the others.
  const posts = (platformPosts.length ? platformPosts : s.topPosts).slice(0, 6)

  return {
    totals: {
      posts: s.totals.posts,
      views: s.totals.views,
      avgErPct: Number(s.totals.erPct.toFixed(2)),
    },
    perPlatform: top(s.byPlatform),
    contentPillars: top(s.byPillar),
    formats: top(s.byFormat),
    topAccounts: s.topAuthors.slice(0, 5).map(a => a.label),
    topPosts: posts.map(p => ({
      account: p.author,
      caption: p.caption.slice(0, 160),
      format: p.format,
      views: p.views,
      erPct: Number(p.erPct.toFixed(2)),
      source: p.source,
    })),
    hasPlatformData: platformPosts.length > 0,
  }
}

export function buildAssistantPrompt(
  summary: DiscoverSummaryPayload, platform: string, contentTypeLabel: string,
): string {
  const g = grounding(summary, platform)
  return `
Buat 3 konsep konten untuk ${platform} — format: ${contentTypeLabel}.

Data performa akun ini (brand dan kompetitor yang dipantau):
${JSON.stringify(g, null, 2)}

${g.hasPlatformData
  ? `Gunakan pola yang terlihat di data ${platform} di atas.`
  : `Belum ada data untuk ${platform}. Ambil pola dari platform lain di atas dan sebutkan bahwa itu adaptasi.`}

Balas HANYA dengan JSON dalam bentuk:
{"concepts":[{"title":"...","description":"...","hook":"...","rationale":"..."}]}

- title: nama konsep, maksimal 6 kata.
- description: 1-2 kalimat tentang apa yang dibuat dan bagaimana bentuknya.
- hook: kalimat pembuka, caption, atau copy sticker yang siap dipakai.
- rationale: angka spesifik dari data di atas yang mendasari ide ini.
`.trim()
}

/**
 * Pulls the concept array out of the model's reply.
 *
 * Tolerant on purpose: the model is asked for bare JSON but sometimes wraps it
 * in a fence or a sentence, and re-prompting over a stray backtick would cost a
 * second round trip for nothing. Anything still unparseable yields [] and the
 * caller reports a clean failure rather than rendering half an object.
 */
export function parseConcepts(raw: string): ContentConcept[] {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return []
  }

  const list = (parsed as { concepts?: unknown })?.concepts
  if (!Array.isArray(list)) return []

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  return list
    .map((c): ContentConcept => ({
      title: str((c as ContentConcept)?.title).slice(0, 120),
      description: str((c as ContentConcept)?.description).slice(0, 600),
      hook: str((c as ContentConcept)?.hook).slice(0, 300),
      rationale: str((c as ContentConcept)?.rationale).slice(0, 400),
    }))
    // A concept with no title and no body is not a concept.
    .filter(c => c.title && c.description)
    .slice(0, 6)
}
