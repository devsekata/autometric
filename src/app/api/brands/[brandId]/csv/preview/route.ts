import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { verifyBrandAccess } from '@/lib/brands/queries'
import { detectFiles, EngineFile, EngineUnavailableError } from '@/lib/csv/engine'
import { getBrandAccounts } from '@/lib/csv/queries'
import { CSV_PLATFORMS } from '@/lib/csv/types'

type Params = { params: Promise<{ brandId: string }> }

const MAX_FILES = 60
const MAX_TOTAL_BYTES = 200 * 1024 * 1024

// POST /api/brands/[brandId]/csv/preview
// Kenali platform + kategori tiap file. Tidak menulis apa pun ke database.
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
    const total = uploads.reduce((n, f) => n + f.size, 0)
    if (total > MAX_TOTAL_BYTES) {
      return NextResponse.json(
        { error: `Total ukuran file melebihi ${MAX_TOTAL_BYTES / (1024 * 1024)} MB.` },
        { status: 413 })
    }

    const files: EngineFile[] = await Promise.all(uploads.map(async f => ({
      filename: f.name,
      buffer: Buffer.from(await f.arrayBuffer()),
      type: f.type,
    })))

    const detected = await detectFiles(files)

    // Platform yang sudah punya akun di brand ini — dipakai UI untuk mengisi
    // dropdown, dan untuk menebak platform saat file tidak menyebutkannya
    // (mayoritas judul FPK memang netral: "Reach per day", "Posts Overview").
    const accounts = await getBrandAccounts(brandId)
    const csvCapable = accounts.filter(a => CSV_PLATFORMS.includes(a.platform))
    const soleCsvPlatform = csvCapable.length === 1 ? csvCapable[0].platform : null

    const sizeByName = new Map(uploads.map(f => [f.name, f.size]))
    const files_out = detected.map(d => ({
      ...d,
      file_size: sizeByName.get(d.filename) ?? null,
      platform: d.platform ?? soleCsvPlatform,
      platform_guessed: d.platform === null && soleCsvPlatform !== null,
    }))

    return NextResponse.json({
      data: {
        files: files_out,
        accounts: csvCapable,
        supported_platforms: CSV_PLATFORMS,
      },
    })
  } catch (err) {
    if (err instanceof EngineUnavailableError) {
      console.error('[csv/preview] engine down:', err.message)
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    console.error('[POST /api/brands/[brandId]/csv/preview]', err)
    const msg = err instanceof Error ? err.message : 'Something went wrong.'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
