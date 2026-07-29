/**
 * Klien untuk service mapping-engine (Python, internal-only).
 *
 * Service itu tidak diekspos ke luar compose network — lihat docker-compose.yml.
 * Kepiai sudah memverifikasi sesi user dan hak akses brand sebelum memanggil,
 * jadi di sini hanya menempelkan shared secret opsional.
 */
import { DetectedFile, IngestResponse } from './types'

// Di produksi service ini dijangkau lewat nama service compose (`fpk-engine`,
// bukan `mapping-engine` — lihat alasannya di docker-compose.yml). Di
// `npm run dev` jaringan itu tidak ada, jadi defaultnya localhost; kalau tidak,
// dev lokal selalu gagal dengan "fetch failed" yang membingungkan.
const DEFAULT_BASE = process.env.NODE_ENV === 'production'
  ? 'http://fpk-engine:8000'
  : 'http://127.0.0.1:8000'

const BASE = (process.env.MAPPING_ENGINE_URL ?? DEFAULT_BASE).replace(/\/+$/, '')
const TOKEN = process.env.MAPPING_ENGINE_TOKEN ?? ''

/** Transformasi file besar + banyak file sekaligus bisa lama; jangan gantung
 *  request selamanya kalau service-nya membeku. */
const TIMEOUT_MS = Number(process.env.MAPPING_ENGINE_TIMEOUT_MS ?? 300_000)

export class EngineUnavailableError extends Error {}

function headers(): HeadersInit {
  return TOKEN ? { 'x-mapping-token': TOKEN } : {}
}

async function post<T>(path: string, body: FormData): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      body,
      headers: headers(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new EngineUnavailableError(
      `Mesin pemroses file tidak bisa dihubungi di ${BASE} (${reason}). ` +
      `Pastikan service mapping-engine berjalan — di dev lokal: ` +
      `npm run mapping-engine`
    )
  }

  const text = await res.text()
  if (!res.ok) {
    let detail = text.slice(0, 500)
    try {
      const parsed = JSON.parse(text)
      if (parsed?.detail) detail = String(parsed.detail)
    } catch { /* biarkan detail apa adanya */ }
    throw new Error(detail || `Mesin pemroses menolak permintaan (${res.status}).`)
  }

  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('Respons mesin pemroses tidak bisa dibaca.')
  }
}

export interface EngineFile {
  filename: string
  buffer: Buffer
  type?: string
}

function appendFiles(form: FormData, files: EngineFile[]): void {
  for (const f of files) {
    form.append(
      'files',
      new Blob([new Uint8Array(f.buffer)], { type: f.type || 'application/octet-stream' }),
      f.filename,
    )
  }
}

export async function detectFiles(files: EngineFile[]): Promise<DetectedFile[]> {
  const form = new FormData()
  appendFiles(form, files)
  const json = await post<{ files: DetectedFile[] }>('/detect', form)
  return json.files ?? []
}

export interface IngestManifest {
  brand?: string | null
  brand_id?: string | null
  org_id?: string | null
  /** { platform: social_accounts.id } — wajib memuat tiap platform di assignments. */
  accounts: Record<string, string>
  assignments: { filename: string; platform: string; category: string }[]
  dry_run?: boolean
}

export async function ingestFiles(
  files: EngineFile[],
  manifest: IngestManifest,
): Promise<IngestResponse> {
  const form = new FormData()
  appendFiles(form, files)
  form.append('manifest', JSON.stringify(manifest))
  return post<IngestResponse>('/ingest', form)
}

export interface CategoryOption {
  category: string
  label: string
  bucket: string
  targets: string[]
  note: string | null
}

export interface CategoryCatalog {
  platforms: string[]
  categories: Record<string, CategoryOption[]>
  gaps: Record<string, string>
  buckets: string[]
}

/** Katalog kategori diturunkan dari BUILTIN_RULES di mesin, bukan disalin ke
 *  TypeScript — kalau vendor diperbarui, dropdown ikut berubah sendiri. */
export async function fetchCategories(): Promise<CategoryCatalog> {
  const res = await fetch(`${BASE}/categories`, {
    headers: headers(),
    signal: AbortSignal.timeout(15_000),
    // Data acuan yang jarang berubah; jangan menembak service tiap render.
    next: { revalidate: 3600 },
  }).catch(err => {
    throw new EngineUnavailableError(
      `Mesin pemroses file tidak bisa dihubungi di ${BASE} ` +
      `(${err instanceof Error ? err.message : err}).`
    )
  })
  if (!res.ok) throw new Error(`Gagal mengambil daftar kategori (${res.status}).`)
  return res.json() as Promise<CategoryCatalog>
}

export async function engineHealth(): Promise<{ ok: boolean; detail: unknown }> {
  try {
    const res = await fetch(`${BASE}/health`, {
      headers: headers(),
      signal: AbortSignal.timeout(10_000),
    })
    return { ok: res.ok, detail: await res.json().catch(() => null) }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
}
