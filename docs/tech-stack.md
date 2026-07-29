# Tech Stack — Kepiai (Autometric V2)

Dokumen ini merangkum teknologi yang dipakai di aplikasi Kepiai, dibagi menjadi
Backend, Frontend, Background Jobs / Scheduler, dan Deployment.

Kepiai dibangun sebagai **monolith Next.js** — frontend dan backend berada dalam
satu codebase dan satu proses server, tanpa backend service terpisah.

---

## 1. Backend

| Layer | Tools |
|---|---|
| Runtime & Framework | Node.js + **Next.js 16 (App Router)** — API Routes (`src/app/api/**/route.ts`) |
| Bahasa | **TypeScript 6** |
| Database | **PostgreSQL / TimescaleDB Cloud** |
| DB Driver | **`pg`** (node-postgres) — raw SQL lewat connection pool, **tanpa ORM** |
| Migration | **node-pg-migrate** (migration file berformat SQL, folder `migrations/`) |
| Autentikasi | **NextAuth v5** — Credentials + Google OAuth |
| Password Hashing | **bcryptjs** |
| Email / OTP | **Nodemailer** — verifikasi email & reset password |
| File Storage | **Cloudinary** dan **Google Cloud Storage** (`@google-cloud/storage`) |
| AI | **Google Gemini** (`@google/generative-ai`) — generate AI insight pada report |
| Export Dokumen | **pptxgenjs** — generate report dalam format PPTX |
| API Eksternal | Meta Graph API (Instagram & Facebook), TikTok API, **Apify** (scraping data kompetitor) |

**Catatan arsitektur**

- Tidak memakai backend framework terpisah (Express / NestJS). Seluruh endpoint
  berupa Route Handler Next.js.
- Tidak memakai ORM. Data access layer berupa raw SQL yang dikelompokkan di
  `src/lib/<domain>/queries.ts`.
- Koneksi database memakai satu `Pool` global (`src/lib/db.ts`).

---

## 2. Frontend

| Layer | Tools |
|---|---|
| Framework | **Next.js 16 (App Router)** + **React 19** — kombinasi Server Components & Client Components |
| Bahasa | **TypeScript 6** |
| Styling | **Tailwind CSS v4** (via `@tailwindcss/postcss`) |
| UI Components | **Custom** — tidak memakai UI library (shadcn/MUI/Ant) |
| Charts | **Custom SVG components** (`src/components/dashboard/charts.tsx`) — line, area, bar, donut, sparkline. Tidak memakai Recharts / Chart.js |
| Word Cloud | **d3-cloud** (layout engine) |
| Image Rendering | **html-to-image** — render slide report menjadi gambar untuk diexport |
| Session Client | `next-auth/react` (`SessionProvider`) |
| Optimasi Gambar | `next/image` dengan remote pattern untuk CDN Cloudinary, Facebook, Instagram, dan TikTok |

---

## 3. Background Jobs / Scheduler

| Layer | Tools |
|---|---|
| Scheduler | **node-cron** — berjalan *in-process* di dalam server Next.js |
| Bootstrap | Next.js **`instrumentation.ts`** (`register()` hook) — cron otomatis start saat server menyala |
| Konfigurasi Jadwal | Disimpan di database (tabel `scheduler_config` & `competitor_scheduler_config`), timezone **WIB (Asia/Jakarta)** |
| Monitoring | Tabel `scheduler_logs` dan `initial_scrape_logs`, ditampilkan pada halaman Admin |

### Mekanisme

Cron berjalan setiap 1 menit (`* * * * *`), lalu fungsi `shouldRunNow()`
membandingkan jam saat ini dengan jadwal yang tersimpan di database. Dengan pola
ini jadwal bisa diubah lewat UI Admin tanpa perlu redeploy aplikasi.

### Job yang berjalan

1. **Daily sync akun sendiri** — sinkronisasi data Instagram, Facebook, dan
   TikTok milik brand, sekaligus auto-refresh OAuth token yang mendekati masa
   kedaluwarsa. Akun yang tokennya dicabut otomatis ditandai `disconnected`.
2. **Competitor sync** — profil kompetitor disinkronkan harian, sedangkan posts
   disinkronkan pada tanggal tertentu setiap bulan sesuai konfigurasi.

### Job asinkron on-demand

Selain cron, terdapat pola **fire-and-forget** pada API route: proses initial
sync dijalankan tanpa `await`, sehingga response langsung dikembalikan ke user
dan proses scraping berjalan di background. Dipakai saat user menghubungkan akun
baru atau menambahkan kompetitor baru.

### Long-running task

Pemanggilan Apify bersifat asinkron dan ditangani dengan **polling**: aplikasi
men-start actor run, lalu mengecek statusnya setiap 5 detik dengan batas tunggu
maksimum 8 menit, kemudian mengunduh dataset hasil scraping.

### Trigger manual

Kedua scheduler dapat dijalankan manual melalui halaman Admin
(`/admin/scheduler` dan `/admin/competitor-scheduler`).

### Batasan yang perlu diketahui

- **Tidak memakai message queue** (Redis / BullMQ / RabbitMQ). Job berjalan di
  dalam proses aplikasi.
- Karena berjalan in-process, **aplikasi hanya aman dijalankan pada satu
  instance**. Jika di kemudian hari di-scale menjadi beberapa replica, cron akan
  tereksekusi ganda sehingga perlu leader election atau dipindahkan ke queue
  eksternal. Guard `global.__autometricCronStarted` yang ada saat ini hanya
  mencegah duplikasi akibat hot-reload saat development.
- Belum ada mekanisme retry otomatis; kegagalan tercatat di log dan dapat
  di-trigger ulang secara manual.

---

## 4. Deployment

| Layer | Tools |
|---|---|
| Container | **Docker** + **docker-compose** |
| Build Mode | Next.js `output: 'standalone'` |
| Port | Host **3002** → container 3000 |
| Restart Policy | `unless-stopped` |
| Environment | Diinject dari file `.env.local` di server (tidak masuk repository) |
| Database | Terpisah dari container aplikasi (TimescaleDB Cloud) |

Perintah redeploy:

```bash
git pull && docker compose up -d --build
```

---

## 5. Ringkasan Dependency Utama

**Dependencies**

```
next                      ^16.2.6
react / react-dom         ^19.2.6
typescript                ^6.0.3
tailwindcss               ^4.3.0
@tailwindcss/postcss      ^4.3.0
pg                        ^8.20.0
node-pg-migrate           ^8.0.4
next-auth                 ^5.0.0-beta.31
bcryptjs                  ^3.0.3
node-cron                 ^4.2.1
nodemailer                ^7.0.13
@google/generative-ai     ^0.24.1
@google-cloud/storage     ^7.21.0
cloudinary                ^2.10.0
pptxgenjs                 ^4.0.1
d3-cloud                  ^1.2.9
html-to-image             ^1.11.13
dotenv                    ^17.4.2
postcss                   ^8.5.14
```

**Dev Dependencies**

```
dotenv-cli                ^11.0.0
@types/node, @types/react, @types/react-dom
@types/pg, @types/bcryptjs, @types/node-cron, @types/nodemailer, @types/d3-cloud
```

---

## 6. Struktur Folder Ringkas

```
src/
├── app/
│   ├── (dashboard)/organizations/[orgSlug]/   # halaman dashboard, brands, reports, dll
│   ├── admin/                                 # halaman admin (scheduler & monitoring)
│   ├── api/                                   # seluruh endpoint backend
│   ├── login/  auth-error/                    # halaman autentikasi
│   └── layout.tsx  globals.css
├── components/                                # komponen UI per domain
├── hooks/
├── lib/
│   ├── db.ts                                  # PostgreSQL connection pool
│   ├── auth/                                  # login, register, OTP, reset password
│   ├── instagram/ facebook/ tiktok/           # integrasi API & sync akun sendiri
│   ├── apify/ competitors/                    # scraping & sync data kompetitor
│   ├── monitoring/                            # cron, scheduler, logger
│   ├── dashboard/                             # query per tab dashboard
│   ├── reports/                               # data, AI, cover, export report
│   ├── organizations/ brands/ invitations/    # domain logic
│   ├── cloudinary/ email/
│   └── featureFlags.ts
├── types/
├── auth.ts                                    # konfigurasi NextAuth
└── instrumentation.ts                         # bootstrap cron

migrations/     # migration SQL (node-pg-migrate)
scripts/        # utility & seeder
seeds/          # seed data
docs/           # dokumentasi
```
