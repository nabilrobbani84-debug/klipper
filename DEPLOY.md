# Deploying ClipForge AI

ClipForge is a real video-processing SaaS, not a static site. It has three runtime pieces:

| Piece | What it does | Needs |
| --- | --- | --- |
| **app** (API + SPA) | Serves the React UI and the `/api/v1` + `/media` endpoints | Node 22, Postgres, Redis |
| **worker** | Downloads YouTube video, transcribes (Whisper), finds clips (Gemini), renders (FFmpeg) | FFmpeg, yt-dlp, Whisper, OpenCV, CPU + RAM |
| **cleanup** | Daily retention job for temp files, old exports and sources | Postgres, storage |

Backing services: **PostgreSQL**, **Redis**, and **Cloudflare R2** (S3-compatible object storage).

Because the worker runs Whisper + FFmpeg, it needs real CPU/RAM. A single **4 vCPU / 8 GB VPS** runs the whole stack comfortably for low/medium volume. Firebase App Hosting (1 CPU / 1 GB) is **not** enough for the worker.

---

## 1. Provision Cloudflare R2

1. Cloudflare dashboard → **R2** → create a bucket, e.g. `clipforge`.
2. **Manage R2 API Tokens** → create a token with **Object Read & Write** on that bucket.
3. Note the **Access Key ID**, **Secret Access Key**, and your account's S3 endpoint:
   `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

ClipForge talks to R2 through the standard S3 API, streams media through short-lived
**signed URLs**, and never exposes R2 credentials to the browser.

## 2. Configure environment

```bash
cp .env.example .env
```

Set at least:

```ini
NODE_ENV=production
APP_URL=https://clips.example.com
AUTH_SECRET=<openssl rand -base64 48>
ALLOW_DEV_AUTH=false
DATABASE_URL=postgres://clipforge:<password>@postgres:5432/clipforge
REDIS_URL=redis://redis:6379
CORS_ORIGIN=https://clips.example.com

STORAGE_DRIVER=s3
STORAGE_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
STORAGE_REGION=auto
STORAGE_BUCKET=clipforge
STORAGE_ACCESS_KEY=<R2 Access Key ID>
STORAGE_SECRET_KEY=<R2 Secret Access Key>

GEMINI_API_KEY=<optional; falls back to a transcript heuristic when empty>

# compose/postgres + caddy
POSTGRES_PASSWORD=<password>
DOMAIN=clips.example.com
ADMIN_EMAILS=you@example.com
```

Optional **Google sign-in** (verified server-side):

```ini
# Browser (public Firebase web config)
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
# Server (service account for token verification)
FIREBASE_PROJECT_ID=your-project
FIREBASE_SERVICE_ACCOUNT={"type":"service_account", ...}   # full JSON on one line
```

Email/password works without any Firebase setup; the Google button only appears when the
`VITE_FIREBASE_*` values are present and `/api/v1/config` reports `googleAuth: true`.

## 3. Deploy with Docker Compose (VPS)

```bash
DOMAIN=clips.example.com docker compose -f docker-compose.prod.yml up -d --build
```

Caddy obtains a Let's Encrypt certificate for `DOMAIN` automatically and proxies to the app.
Database migrations run automatically on API startup. Create your first admin:

```bash
docker compose -f docker-compose.prod.yml exec app \
  node --import tsx server/create-admin.ts you@example.com 'a-long-password'
```

(Or just sign up with an email listed in `ADMIN_EMAILS` — it is promoted to admin on login.)

Open `https://clips.example.com`, sign in, paste a YouTube URL.

## 4. Local development

```bash
cp .env.example .env            # defaults target local disk + local Postgres/Redis
docker compose up -d postgres redis
bun install
bun run db:migrate
bun run api      # http://localhost:8080  (serves API; also serves dist/ if built)
bun run worker   # separate terminal
bun run dev      # http://localhost:3000  (Vite dev server, proxies /api + /media)
```

With `ALLOW_DEV_AUTH=true` and `VITE_DEV_USER_ID=<id>` you are auto-signed-in for local testing.

## Scaling notes

- Run more `worker` replicas (or raise `JOB_CONCURRENCY`) to process more videos in parallel.
  Each concurrent Whisper+FFmpeg job wants ~1 vCPU and ~1.5 GB RAM.
- Plans (`FREE`/`CREATOR`/`PRO`) cap video length, clip count, resolution, storage and
  concurrency — all enforced server-side in `server/plans.ts`.
- Managed Postgres/Redis and multiple app replicas behind a load balancer work unchanged
  (migrations use a Postgres advisory lock, sessions/credits are all in Postgres).

## What is and isn't included

Included and working: validated YouTube ingestion, async Redis/BullMQ queue, Whisper
transcription with word timestamps, Gemini (or heuristic) clip detection, FFmpeg rendering
with per-word karaoke captions, OpenCV face/speaker-aware vertical reframing, audio cleanup,
plan-based watermarking, email/password + Google auth, usage credits, admin console, signed
R2 media delivery, and retention cleanup.

Roadmap (clearly marked in the UI, not faked): automatic B-roll insertion, silence/filler
removal, and billing/payments.
