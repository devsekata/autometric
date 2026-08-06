import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { auth } from '@/auth'
import pool from '@/lib/db'
import { verifyBrandAccess } from '@/lib/brands/queries'
import { logInitialScrape } from '@/lib/monitoring/logger'
import {
  EngineFile,
  EngineUnavailableError,
  ingestFiles,
  IngestManifest,
} from '@/lib/csv/engine'
import {
  assertPlatformFreeForCsv,
  connectCsvAccount,
  dataThroughFrom,
  getBrandAccounts,
  logCsvUploads,
  PlatformTakenError,
  type CsvUploadLogInput,
} from '@/lib/csv/queries'
import { CSV_PLATFORMS, isCsvPlatform, IngestResult } from '@/lib/csv/types'
import { checkAccountExists } from '@/lib/accounts/verifyAccount'
import { Platform } from '@/lib/brands/types'

type Params = { params: Promise<{ brandId: string }> }

const MAX_FILES = 60
const MAX_TOTAL_BYTES = 200 * 1024 * 1024

interface Assignment {
  filename: string
  platform: string
  category: string
  /** Username akun untuk platform ini; wajib kalau brand belum punya akunnya. */
  username?: string
}

// POST /api/brands/[brandId]/csv/ingest
//
// Menerima BATCH file, bukan satu per satu: file TikTok Overview datang sebagai
// kumpulan file 1-metrik yang harus digabung per tanggal sebelum ditulis, dan
// itu hanya mungkin kalau mesin melihat seluruh antrean sekaligus.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { brandId } = await params
    const orgId = await verifyBrandAccess(brandId, userId)
    if (!orgId) return NextResponse.json({ error: 'Brand not found.' }, { status: 404 })

    const form = await req.formData()
    const uploads = form.getAll('files').filter((f): f is File => f instanceof File)
    if (!uploads.length) {
      return NextResponse.json({ error: 'Tidak ada file yang dikirim.' }, { status: 400 })
    }
    if (uploads.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Maksimum ${MAX_FILES} file per unggahan.` }, { status: 413 })
    }
    if (uploads.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) {
      return NextResponse.json(
        { error: `Total ukuran file melebihi ${MAX_TOTAL_BYTES / (1024 * 1024)} MB.` },
        { status: 413 })
    }

    let assignments: Assignment[]
    let dryRun = false
    try {
      const raw = form.get('assignments')
      assignments = JSON.parse(typeof raw === 'string' ? raw : '[]')
      if (!Array.isArray(assignments)) throw new Error('bukan array')
      dryRun = form.get('dry_run') === 'true'
    } catch (e) {
      return NextResponse.json(
        { error: `Data penugasan file tidak valid: ${e instanceof Error ? e.message : e}` },
        { status: 400 })
    }

    const byName = new Map(assignments.map(a => [a.filename, a]))
    const missing = uploads.filter(f => !byName.has(f.name)).map(f => f.name)
    if (missing.length) {
      return NextResponse.json(
        { error: `Platform/kategori belum dipilih untuk: ${missing.join(', ')}` },
        { status: 400 })
    }

    // ── Validasi platform sebelum menyentuh database ──
    const platforms = new Set<Platform>()
    for (const a of assignments) {
      if (a.platform === 'twitter') {
        return NextResponse.json({
          error: 'Twitter/X belum didukung — belum ada tabel tujuannya. ' +
                 'Keluarkan file Twitter dari daftar ini.',
        }, { status: 400 })
      }
      if (!isCsvPlatform(a.platform)) {
        return NextResponse.json(
          { error: `Platform '${a.platform}' tidak didukung upload CSV. ` +
                   `Yang didukung: ${CSV_PLATFORMS.join(', ')}.` },
          { status: 400 })
      }
      if (!a.category?.trim()) {
        return NextResponse.json(
          { error: `Kategori belum dipilih untuk ${a.filename}.` }, { status: 400 })
      }
      platforms.add(a.platform)
    }

    // ── Siapkan akun: Autometric yang memilikinya, mesin Python tidak boleh
    // membuat akun sendiri (self-heal-nya dimatikan di bootstrap.py). ──
    const existing = await getBrandAccounts(brandId)
    const accountByPlatform = new Map(existing.map(a => [a.platform, a]))
    const accounts: Record<string, string> = {}

    // Dua fase, dan pemisahannya disengaja:
    //
    //   1. Periksa semua platform SEKALIGUS. Cek keberadaan akun lewat Apify
    //      makan 15-60 detik per platform; berurutan, batch IG+FB membayar dua
    //      kali lipat untuk dua run yang sebetulnya tidak saling menunggu.
    //      Fase ini tidak menulis apa pun.
    //   2. Baru buat akunnya, setelah SEMUA platform lolos.
    //
    // Dipisah supaya batch tetap utuh-atau-tidak-sama-sekali: kalau username IG
    // salah tulis sementara FB benar, tidak boleh ada akun FB yang tertinggal
    // dari batch yang ditolak.
    type PlatformCheck =
      /** Akunnya sudah ada — pakai yang ini. */
      | { ok: true; platform: Platform; existingId: string }
      /** Username lolos pemeriksaan — akunnya dibuat di fase 2. */
      | { ok: true; platform: Platform; newUsername: string }
      /** Batch ditolak. */
      | { ok: false; error: string; status: number }

    const checks = await Promise.all([...platforms].map(async (platform): Promise<PlatformCheck> => {
      const already = accountByPlatform.get(platform)
      if (already) {
        // Sumber campur untuk satu platform tidak diizinkan.
        try {
          await assertPlatformFreeForCsv(brandId, platform)
        } catch (e) {
          if (e instanceof PlatformTakenError) return { ok: false, error: e.message, status: 409 }
          throw e
        }
        return { ok: true, platform, existingId: already.social_account_id }
      }

      const username = assignments.find(a => a.platform === platform && a.username?.trim())
        ?.username?.trim().replace(/^@/, '')
      if (!username) {
        return {
          ok: false,
          error: `Brand ini belum punya akun ${platform}. Isi username akun ` +
                 `${platform} lebih dulu supaya datanya punya pemilik yang jelas.`,
          status: 400,
        }
      }
      // Pastikan akunnya betul ADA sebelum dibuat, dan sebelum satu file pun
      // diproses. Kalau username-nya salah tulis, SELURUH batch ditolak: lebih
      // baik tidak ada data yang masuk daripada masuk atas nama akun hantu, yang
      // baru terasa jauh di hilir saat angkanya tidak pernah muncul di dashboard.
      //
      // Pada pratinjau, leg Apify dilewati — tidak ada yang dibuat, jadi tidak
      // pantas membakar 15-60 detik dan satu actor run hanya untuk melihat
      // pemetaan kolom. Validasi format dan pre-check gratis tetap jalan.
      const check = await checkAccountExists(platform, username, { apify: !dryRun })
      if (check.state === 'rejected') {
        return { ok: false, error: check.message, status: 400 }
      }
      if (check.state === 'unverified') {
        console.warn(`[csv/ingest] @${username} (${platform}) tidak terverifikasi: ${check.reason}`)
      }
      return { ok: true, platform, newUsername: username }
    }))

    // Laporkan kegagalan menurut urutan platform, bukan menurut siapa yang
    // selesai duluan — batch yang sama harus selalu memberi pesan yang sama.
    const failed = checks.find((c): c is Extract<PlatformCheck, { ok: false }> => !c.ok)
    if (failed) {
      return NextResponse.json({ error: failed.error }, { status: failed.status })
    }

    for (const c of checks) {
      if (!c.ok) continue
      if ('existingId' in c) {
        accounts[c.platform] = c.existingId
      } else if (dryRun) {
        // Pratinjau tidak boleh membuat akun. Pakai id semu supaya transformasi
        // tetap bisa jalan; tidak ada yang ditulis ke database.
        accounts[c.platform] = '00000000-0000-0000-0000-000000000000'
      } else {
        const created = await connectCsvAccount(brandId, c.platform, c.newUsername)
        accounts[c.platform] = created.id
      }
    }

    const files: EngineFile[] = await Promise.all(uploads.map(async f => ({
      filename: f.name,
      buffer: Buffer.from(await f.arrayBuffer()),
      type: f.type,
    })))

    const { rows: brandRows } = await pool.query<{ name: string }>(
      `SELECT name FROM brands WHERE id = $1`, [brandId])
    const brandName = brandRows[0]?.name ?? null

    const manifest: IngestManifest = {
      brand: brandName,
      brand_id: brandId,
      org_id: orgId,
      accounts,
      assignments: assignments.map(a => ({
        filename: a.filename, platform: a.platform, category: a.category,
      })),
      dry_run: dryRun,
    }

    const response = await ingestFiles(files, manifest)

    if (dryRun) {
      return NextResponse.json({ data: response })
    }

    // ── Catat riwayat ──
    const batchId = randomUUID()
    const sizeByName = new Map(uploads.map(f => [f.name, f.size]))
    const logs: CsvUploadLogInput[] = []

    for (const r of response.results as IngestResult[]) {
      // Grup TikTok Overview dilaporkan sebagai satu hasil untuk beberapa file;
      // riwayat tetap per file supaya user bisa melacak file mana yang dipakai.
      const names = r.grouped_files?.length ? r.grouped_files : [r.file]
      for (const name of names) {
        logs.push({
          batchId,
          brandId,
          socialAccountId: accounts[r.platform] ?? null,
          platform: r.platform,
          category: r.category ?? null,
          fileName: name,
          fileSize: sizeByName.get(name) ?? null,
          status: r.ok ? 'success' : 'failed',
          rowsWritten: r.ok ? (r.rows ?? 0) : null,
          targetTable: r.table ?? null,
          errorMessage: r.ok ? null : (r.error?.slice(0, 1000) ?? null),
          dataThrough: dataThroughFrom(r),
          uploadedBy: userId,
        })
      }
    }
    await logCsvUploads(logs).catch(e =>
      console.error('[csv/ingest] gagal mencatat csv_upload_logs:', e))

    // ── Satu baris initial_scrape_logs per platform per batch. Tabel itu yang
    // dibaca prosedur medallion terjadwal, jadi inilah pemicu agar data naik
    // ke silver/gold. Tabelnya tidak punya kolom file/kategori — detail per
    // file ada di csv_upload_logs. ──
    const now = new Date()
    const byPlatform = new Map<string, { rows: number; failed: number; errors: string[] }>()
    for (const r of response.results as IngestResult[]) {
      const agg = byPlatform.get(r.platform) ?? { rows: 0, failed: 0, errors: [] }
      agg.rows += r.ok ? (r.rows ?? 0) : 0
      if (!r.ok) {
        agg.failed += 1
        if (r.error) agg.errors.push(`${r.file}: ${r.error}`)
      }
      byPlatform.set(r.platform, agg)
    }
    await Promise.all([...byPlatform.entries()].map(([platform, agg]) =>
      logInitialScrape({
        socialAccountId: accounts[platform],
        platform,
        brandId,
        orgId,
        status: agg.failed ? 'failed' : 'success',
        recordsSynced: agg.rows,
        errorMessage: agg.errors.length ? agg.errors.join(' | ').slice(0, 1000) : null,
        startedAt: now,
        finishedAt: new Date(),
      }).catch(e => console.error('[csv/ingest] gagal mencatat initial_scrape_logs:', e))
    ))

    return NextResponse.json({ data: { ...response, batch_id: batchId } })
  } catch (err) {
    if (err instanceof EngineUnavailableError) {
      console.error('[csv/ingest] engine down:', err.message)
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    console.error('[POST /api/brands/[brandId]/csv/ingest]', err)
    const msg = err instanceof Error ? err.message : 'Something went wrong.'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
