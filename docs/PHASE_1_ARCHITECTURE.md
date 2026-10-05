# ClipForge AI — Phase 1 Architecture

## Scope

Phase 1 moves source validation, metadata acquisition, media download, audio extraction, transcription, AI analysis, and persistence out of the browser. The existing React UI remains the presentation layer; the API and worker are separate processes.

```text
Browser
  │ HTTPS + signed session
  ▼
Express API (/api/v1)
  │ validates input, authorizes resources, creates durable records
  ├── PostgreSQL (projects, jobs, transcripts, clips, exports, usage)
  ├── Redis/BullMQ (durable asynchronous work)
  └── ObjectStorage adapter (local development or S3-compatible production)
                         │
                         ▼
                    Worker process
        yt-dlp → FFmpeg → Whisper → Gemini → storage
```

## Job lifecycle

`QUEUED → DOWNLOADING → EXTRACTING_AUDIO → TRANSCRIBING → ANALYZING → GENERATING_CLIPS → COMPLETED`.
A render job uses `QUEUED → RENDERING → UPLOADING → COMPLETED`. Any stage can end in `FAILED` or `CANCELLED`. The API never waits for media processing; it returns `202 Accepted` with a project ID and job ID.

The worker checks the persisted cancellation flag between stages, reports progress in PostgreSQL, and removes its temporary directory in a `finally` block. It does not expose raw provider or FFmpeg errors to users.

## Provider boundaries

- `MediaProvider`: validates/gets metadata and downloads media. The default implementation invokes `yt-dlp` only after server-side YouTube hostname validation.
- `TranscriptionProvider`: default implementation invokes a configured Whisper CLI and requires structured JSON with word timestamps.
- `AIProvider`: default implementation calls Gemini from the worker, never from browser code, and validates structured clip candidates.
- `RenderProvider`: default FFmpeg implementation handles trim, scale, aspect ratio, and H.264/AAC encoding. Rendering is queued separately from analysis.
- `ObjectStorage`: local filesystem adapter is for development only; production must use an S3-compatible adapter and signed URLs.

A missing provider binary or secret fails the job with a safe, actionable error. The system does not fabricate metadata, transcripts, clips, or exports.

## API surface

- `GET /health` — liveness
- `GET /ready` — database/queue readiness
- `GET /metrics` — process counters and uptime
- `POST /api/v1/projects` — validate URL, persist project, enqueue analysis (`202`)
- `GET /api/v1/projects` — list the authenticated user’s projects
- `GET /api/v1/projects/:id` — retrieve an owned project
- `GET /api/v1/jobs/:id` — retrieve owned job state
- `GET /api/v1/jobs/:id/events` — SSE progress stream
- `POST /api/v1/jobs/:id/cancel` — request cancellation
- `POST /api/v1/jobs/:id/retry` — retry a failed/cancelled analysis job
- `POST /api/v1/projects/:projectId/clips/:clipId/exports` — enqueue a render job

Every API response follows `{ success, data, error, requestId }`. Production requests require a signed bearer session token. Development can opt into a fixed local user only with `ALLOW_DEV_AUTH=true`.

## Production boundaries

The Firebase Hosting site is static. The API and worker must be deployed separately (Cloud Run, a VM, or another container platform), with `VITE_API_URL` pointing to the API origin. Do not put `GEMINI_API_KEY`, database credentials, storage credentials, or session secrets in Vite environment variables.

Phase 1 intentionally leaves full registration/OAuth, billing, admin controls, advanced face tracking, and collaborative editing for later phases. The API already has user ownership and plan-limit seams so those features do not require a rewrite.


## Known Phase 1 limitations

- The included object-storage implementation is local-only for Docker development. Add an S3/R2/GCS adapter and signed download endpoint before storing production media.
- The existing frontend still contains the original sample-project experience. A follow-up client integration should use `POST /api/v1/projects` and SSE instead of the legacy browser demo path; live media is intentionally not fabricated when the backend is absent.
- Authentication has a signed-token verification boundary and development identity switch, but registration, password reset, Google OAuth, and session issuance belong to the auth phase.
- Automatic plan credits, billing adapters, face tracking, caption rendering, and persistent editor revisions are not claimed as complete by this phase.


## Extended production seams

The API now includes email/password registration and login with PBKDF2 password hashes, persisted session revocation, ownership-scoped source/export streams, signed URL support for S3-compatible storage, plan entitlements, atomic monthly processing-credit reservations, admin overview/job inspection, brand-kit/template persistence, and a scheduled `bun run cleanup` task.

The worker retains source media through the configured object-storage adapter, writes transcript-based SRT captions during render, applies aspect-ratio-safe FFmpeg scaling/cropping, checks cancellation between stages, and records retry metadata. Face tracking, active-speaker detection, karaoke word animation, payment webhooks, email delivery, and Google OAuth still require dedicated providers; the API does not claim those features are implemented.

Run cleanup from a scheduler (for example, a daily Cloud Run Job or cron):

```bash
bun run cleanup
```

Storage lifecycle is controlled by `TEMP_RETENTION_HOURS`, `SOURCE_RETENTION_DAYS`, and `EXPORT_RETENTION_DAYS`. Set `STORAGE_DRIVER=s3` with the S3/R2/GCS-compatible endpoint and credentials in production. Never expose those credentials to Vite.
