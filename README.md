# Klipper — AI YouTube Video Clipper

Repository: [https://github.com/nabilrobbani84-debug/klipper](https://github.com/nabilrobbani84-debug/klipper)

**Klipper** transforms long-form YouTube videos and podcasts into high-retention vertical short clips (TikTok, Instagram Reels, YouTube Shorts) utilizing server-side FFmpeg rendering, multilingual Whisper transcription, 7-factor weighted viral moment scoring, and smart speaker reframe tracking.

---

## 🏗️ Production Architecture

```
                    ┌─────────────────────────┐
                    │    React 19 + Vite SPA  │
                    │ (Browser Preview/Editor)│
                    └────────────┬────────────┘
                                 │ HTTP / SSE Stream
                                 ▼
                    ┌─────────────────────────┐
                    │    Express API Server   │
                    │  (Port 3000 / 0.0.0.0)  │
                    └──────┬───────────┬──────┘
                           │           │
                 ┌─────────┴──┐     ┌──┴──────────┐
                 │ PostgreSQL │     │    Redis    │
                 │ Drizzle DB │     │  Job Queue  │
                 └────────────┘     └──┬──────────┘
                                       │
                                       ▼
                            ┌─────────────────────┐
                            │ Video Worker Pool   │
                            │ (Concurrency Limit) │
                            └──────────┬──────────┘
                                       │
         ┌─────────────────────────────┼─────────────────────────────┐
         ▼                             ▼                             ▼
  ┌──────────────┐              ┌──────────────┐              ┌──────────────┐
  │ System FFmpeg│              │  Gemini AI   │              │ Multilingual │
  │ Video Engine │              │ 7-Factor     │              │ Transcription│
  │ (Cut/Crop/   │              │ Weighted     │              │ (ID & EN,    │
  │  Loudnorm)   │              │ Viral Scoring│              │  Word-Level) │
  └──────┬───────┘              └──────────────┘              └──────────────┘
         │
         ▼
  ┌──────────────┐
  │Object Storage│ ──(Signed HMAC URLs)──> ┌─────┐ ──> User Download
  │  (S3 / R2)   │                         │ CDN │
  └──────────────┘                         └─────┘
```

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- Node.js 22+
- npm 10+
- FFmpeg 4.4+ installed on your system (`which ffmpeg`)

### Installation & Run

1. Clone repository and install dependencies:
```bash
npm install
```

2. Copy environment file and configure variables:
```bash
cp .env.example .env
```

3. Start development server (serves Vite frontend + Express backend on port 3000):
```bash
npm run dev
```

4. Run automated test suite:
```bash
npm run test
```

5. Build for production:
```bash
npm run build
```

---

## 🐳 Docker Deployment

To launch the full production stack including PostgreSQL and Redis:

```bash
docker-compose up --build -d
```

Services started:
- `clipforge-app`: Node 22 + FFmpeg application on port 3000
- `clipforge-postgres`: PostgreSQL 16 database on port 5432
- `clipforge-redis`: Redis 7 instance on port 6379

---

## 📊 7-Factor Weighted Viral Moment Scoring

Candidate clips are evaluated against a weighted mathematical formula:

| Metric | Weight | Description |
|---|---|---|
| **Hook Strength** | **25%** | First 3 seconds pattern interrupt & curiosity gap |
| **Information Value** | **20%** | Density of actionable insights or revelations |
| **Emotional Impact** | **15%** | Intensity of emotional peaks (Joy, Surprise, Shock) |
| **Story Completeness** | **15%** | Standalone narrative coherence with setup & payoff |
| **Pacing Dynamics** | **10%** | Speech cadence, energy transitions, and zero fluff |
| **Uniqueness** | **5%** | Contrarian perspective or counter-intuitive angle |
| **Context Clarity** | **10%** | Understandability without prior video knowledge |

Total Score = $\sum (\text{Metric} \times \text{Weight})$

---

## 🛡️ Security & SSRF Protection

ClipForge enforces strict server-side protection on all incoming video URLs:
- Private IPv4 blocks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) are blocked.
- Loopback addresses (`127.0.0.0/8`, `::1`) are blocked.
- Cloud metadata services (`169.254.169.254`, `metadata.google.internal`) are blocked.
- Only authorized video distribution hostnames (`youtube.com`, `youtu.be`) are processed.
- Child processes spawn with sanitized argument arrays, preventing shell injection vulnerabilities.

---

## 📡 Core API Reference

- `POST /api/jobs`: Submit new YouTube processing pipeline job
- `GET /api/jobs`: List background jobs
- `GET /api/jobs/:id`: Fetch single job details and execution logs
- `GET /api/jobs/:id/events`: Real-time Server-Sent Events (SSE) telemetry stream
- `POST /api/jobs/render`: Queue server-side FFmpeg 9:16 export job
- `GET /api/storage/download`: Secure signed download URL handler
- `GET /api/metrics`: Live system telemetry and worker capacity
- `GET /health`: Liveness probe
- `GET /ready`: Readiness probe
