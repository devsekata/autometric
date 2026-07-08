// Word-cloud packing via d3-cloud (glyph/pixel-level collision → the dense,
// interlocking "Wordle" structure). Browser-only: d3-cloud renders each word to a
// canvas sprite for its collision mask, so this must run client-side (preview
// effect + PPTX export, both in the browser). Runs synchronously because d3-cloud
// defaults to timeInterval = Infinity. Deterministic: a seeded PRNG derived from
// the word set drives placement + rotation, so the preview and the export match.
import cloud from 'd3-cloud'
import type { CloudWordData, SentimentKey } from './chartTypes'

// Fixed layout resolution — big enough for a fine collision grid. Renderers scale
// this box to their container via the SVG viewBox, so both use the SAME layout.
export const WC_W = 1000
export const WC_H = 580

/** A word positioned by the layout (centre anchor, coords in [0..WC_W]×[0..WC_H]). */
export interface PlacedWord {
  word: string
  sentiment: SentimentKey
  x: number
  y: number
  fontSize: number
  rotate: number
  weight: number
}

// mulberry32 seeded PRNG (deterministic; replaces Math.random inside d3-cloud).
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// The single font family used for BOTH d3-cloud's canvas measurement and the
// SVG render. They MUST match exactly or glyphs render wider/taller than measured
// and visually overlap — the classic d3-cloud pitfall.
export const WC_FONT = 'sans-serif'

interface Datum { text: string; size: number; weight: number; sentiment: SentimentKey; x?: number; y?: number; rotate?: number }

export function computeWordCloud(words: CloudWordData[]): PlacedWord[] {
  if (!words.length || typeof document === 'undefined') return []
  const maxF = Math.max(...words.map(w => w.frequency), 1)
  const minF = Math.min(...words.map(w => w.frequency))
  const maxFs = WC_H * 0.23   // biggest word height
  const minFs = WC_H * 0.06   // smallest word height (raised so tiny words stay readable)
  const sizeOf = (f: number) => {
    const t = maxF === minF ? 1 : (f - minF) / (maxF - minF)
    return minFs + Math.pow(t, 0.62) * (maxFs - minFs)
  }
  const weightOf = (size: number) => (size > maxFs * 0.58 ? 800 : size > maxFs * 0.34 ? 700 : 600)

  // Seed from the word set → same layout every render for the same words.
  let seed = 1
  for (const w of words) for (let i = 0; i < w.word.length; i++) seed = (seed * 31 + w.word.charCodeAt(i)) >>> 0
  const rand = seeded(seed || 1)

  const input: Datum[] = words.map(w => {
    const size = sizeOf(w.frequency)
    return { text: w.word, size, weight: weightOf(size), sentiment: w.sentiment }
  })
  let placed: Datum[] = []
  const layout = (cloud() as ReturnType<typeof cloud>)
    .size([WC_W, WC_H])
    .words(input as unknown as cloud.Word[])
    .padding(3)
    .rotate(() => (rand() < 0.14 ? 90 : 0))
    .font(WC_FONT)
    // measure with the SAME per-word weight + size we render with, so bounds match
    .fontWeight((d: cloud.Word) => String((d as unknown as Datum).weight))
    .fontSize((d: cloud.Word) => (d as unknown as Datum).size)
    .spiral('archimedean')
    .random(rand)
    .on('end', (out: cloud.Word[]) => { placed = out as unknown as Datum[] })
  layout.start()
  layout.stop()

  return placed.map(d => ({
    word: d.text,
    sentiment: d.sentiment,
    x: (d.x ?? 0) + WC_W / 2,   // d3-cloud's origin is the box centre
    y: (d.y ?? 0) + WC_H / 2,
    fontSize: d.size,
    rotate: d.rotate ?? 0,
    weight: d.weight,
  }))
}
