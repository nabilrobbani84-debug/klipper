# Deploy ClipForge AI ke Cloudflare

Seluruh platform berjalan di Cloudflare, tanpa VPS:

| Komponen | Layanan Cloudflare | Fungsi |
| --- | --- | --- |
| UI React + API `/api/v1` + `/media` | **Workers** (Hono) + Static Assets | Satu Worker `clipforge` melayani SPA dan API |
| Database | **D1** (`clipforge-db`) | User, sesi, project, clip, job, kredit, audit log |
| File video/audio/hasil render | **R2** (`clipforge-media`) | Diakses hanya lewat binding dan URL media bertanda tangan |
| Antrian job | **Queues** (`clipforge-jobs` + DLQ) | Pipeline analisis dan render |
| Download YouTube, FFmpeg, deteksi wajah | **Containers** (`MediaContainer`, `standard-2`) | yt-dlp + FFmpeg + OpenCV, satu instance per job |
| Transkripsi | **Workers AI** `@cf/openai/whisper-large-v3-turbo` | Per potongan audio 240 detik |
| Deteksi momen viral | Gemini (jika `GEMINI_API_KEY` ada) → Workers AI Llama 3.3 → heuristik | |
| Maintenance | **Cron Trigger** (tiap jam) | Job macet, sesi kedaluwarsa, retensi file |

Container tidak memegang kredensial apa pun: akses R2 dan pelaporan progres lewat
outbound handler Worker (`r2.internal`, `api.internal`).

## Prasyarat

1. Akun Cloudflare dengan **Workers Paid plan** (wajib untuk Containers).
2. **API token** (My Profile → API Tokens → Create Custom Token) dengan izin akun:
   Workers Scripts: Edit, Workers R2 Storage: Edit, D1: Edit, Queues: Edit,
   Containers: Edit (Cloudchamber), Workers AI: Read, Account Settings: Read.
   Tambahkan Zone → Workers Routes: Edit jika memakai domain sendiri.
3. (Opsional) Project Firebase untuk login Google: aktifkan provider Google di
   Firebase Authentication dan tambahkan domain Worker ke *Authorized domains*.

## Deploy otomatis lewat GitHub Actions

Workflow `.github/workflows/deploy.yml` berjalan tiap push ke `main` (atau manual).
Tanpa `CLOUDFLARE_API_TOKEN` workflow hanya dilewati.

**Settings → Secrets and variables → Actions → Secrets**

| Secret | Wajib | Isi |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | ya | Token di atas |
| `CLOUDFLARE_ACCOUNT_ID` | ya | ID akun Cloudflare |
| `AUTH_SECRET` | ya | `openssl rand -base64 48` (jangan diganti setelah live: sesi dan link media akan invalid) |
| `GEMINI_API_KEY` | tidak | Kualitas pemilihan clip lebih baik |
| `YTDLP_COOKIES` | tidak | Isi `cookies.txt` (format Netscape) bila YouTube memblokir sebagai bot |

**Variables**

| Variable | Contoh |
| --- | --- |
| `APP_URL` | `https://clipforge.<subdomain>.workers.dev` (untuk health check dan link) |
| `ADMIN_EMAILS` | `admin@domainanda.com` (otomatis jadi admin saat login) |
| `ALLOW_REGISTRATION` | `true` / `false` |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` | Konfigurasi web Firebase (publik) |

Yang dilakukan workflow: membuat bucket R2 dan queue jika belum ada, mencari/membuat
database D1 lalu menulis ID-nya ke `wrangler.jsonc`, menjalankan migrasi D1, build
frontend, `wrangler deploy` (termasuk build dan push image container), upload secret,
lalu health check. Deploy container pertama butuh beberapa menit sebelum siap.

## Deploy manual dari laptop

```bash
bun install                      # atau npm install
npx wrangler login
npx wrangler r2 bucket create clipforge-media
npx wrangler queues create clipforge-jobs-dlq
npx wrangler queues create clipforge-jobs
npx wrangler d1 create clipforge-db   # salin database_id ke wrangler.jsonc
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put AUTH_SECRET
bun run deploy                   # vite build && wrangler deploy (butuh Docker berjalan)
```

## Pengembangan lokal

```bash
cp .env.example .env             # bagian VITE_*
cp .env.example .dev.vars        # bagian AUTH_SECRET dll.
npx wrangler d1 migrations apply DB --local
bun run dev:worker               # API di http://localhost:8787 (butuh Docker untuk container)
bun run dev                      # UI di http://localhost:3000, /api diproxy ke :8787
```

Workers AI dan Containers di `wrangler dev` tetap memakai akun Cloudflare Anda (ada biaya).

## Verifikasi

```bash
bun run lint && bun run test && bun run build
```

Setelah deploy: buka `/health` dan `/ready`, daftar akun, buat project dari URL YouTube,
pantau progres job, lalu ekspor satu clip dan unduh dari Download Center.

## Biaya dan batasan

- Whisper large-v3-turbo di Workers AI sekitar US$0,0005 per menit audio; Llama 3.3
  ditagih per token. Container ditagih per detik selama job berjalan (instance mati
  setelah job selesai).
- YouTube sering memblokir IP data center. Bila download gagal dengan pesan bot/sign-in,
  isi `YTDLP_COOKIES`.
- Durasi video maksimal default 4 jam (`MAX_VIDEO_DURATION_SECONDS`).
- Belum tersedia: B-roll otomatis, penghapusan jeda hening, dan pembayaran/billing
  (paket diubah oleh admin).
