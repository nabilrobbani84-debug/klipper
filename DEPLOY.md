# Deploy ke Firebase Hosting

Aplikasi ini adalah SPA statis (Vite + React). Hasil build (`dist/`) di-host di Firebase Hosting.

## Opsi A — Otomatis via GitHub Actions

Workflow: `.github/workflows/firebase-hosting.yml`
- Push ke `main` → deploy ke **live**
- Pull request → deploy ke **preview channel** (URL dikomentari di PR)

Setup satu kali:
1. Buat project di <https://console.firebase.google.com> lalu aktifkan **Hosting**.
2. Buat service account key: Google Cloud Console → IAM & Admin → Service Accounts → buat akun
   dengan role **Firebase Hosting Admin** (dan **API Keys Viewer**) → Keys → Add key (JSON).
   *(Alternatif: `npx firebase-tools init hosting:github` membuat secret ini otomatis.)*
3. Di GitHub repo → Settings → Secrets and variables → Actions:
   - Secret `FIREBASE_SERVICE_ACCOUNT` = isi file JSON tadi
   - Variable `FIREBASE_PROJECT_ID` = ID project Firebase
   - Jangan menambahkan `VITE_GEMINI_API_KEY`; Gemini hanya boleh dikonfigurasi di worker/API.
4. Push ke `main` atau jalankan workflow secara manual (tab Actions → Run workflow).

## Opsi B — Manual dari komputer lokal

```bash
bun install
npx firebase-tools login
npx firebase-tools use --add      # pilih project Firebase
bun run deploy                    # build + deploy
```

## Catatan keamanan

Gemini tidak lagi dipanggil dari browser. `GEMINI_API_KEY` wajib disimpan hanya pada environment worker/API dan tidak boleh memakai prefix `VITE_`.

## Backend production (API + worker)

Firebase Hosting hanya menyajikan frontend statis. API dan worker Phase 1 harus dijalankan sebagai container terpisah karena membutuhkan PostgreSQL, Redis, FFmpeg, yt-dlp, dan Whisper.

Untuk development lokal:

```bash
cp .env.example .env
bun install
docker compose up --build
```

API tersedia di `http://localhost:8080`; frontend di `http://localhost:3000`. Jalankan migration manual jika database sudah pernah dibuat:

```bash
psql "$DATABASE_URL" -f server/migrations/001_init.sql
```

Jalankan cleanup secara berkala (disarankan sebagai daily job/cron):

```bash
bun run cleanup
```

Untuk production, gunakan PostgreSQL dan Redis terkelola, object storage S3/R2/GCS melalui adapter, dan deploy `api` serta `worker` sebagai layanan terpisah. Set `NODE_ENV=production`, `ALLOW_DEV_AUTH=false`, `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`, dan `GEMINI_API_KEY` hanya di secret manager. Jangan menaruh secrets tersebut pada `VITE_*` atau Firebase Hosting.

API production memerlukan signed bearer session token. Endpoint development menerima `x-dev-user-id` hanya ketika `ALLOW_DEV_AUTH=true`; mode ini harus dinonaktifkan sebelum deployment publik. Worker tidak membuat metadata, transcript, clip, atau export palsu jika provider belum dikonfigurasi—job akan gagal dengan kode aman dan dapat di-retry.

Rincian kontrak API dan lifecycle job ada di `docs/PHASE_1_ARCHITECTURE.md`.
