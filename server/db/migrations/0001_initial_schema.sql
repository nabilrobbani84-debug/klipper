-- Initial Production Schema for Klipper AI
-- Compatible with PostgreSQL 15+, Cloudflare Hyperdrive, and Cloudflare D1

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'USER',
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  source_video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  thumbnail_url TEXT,
  duration_seconds INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  content_goal TEXT NOT NULL DEFAULT 'retention',
  hook_type TEXT NOT NULL DEFAULT 'curiosity',
  preferred_duration INTEGER NOT NULL DEFAULT 45,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  duration REAL NOT NULL,
  score REAL NOT NULL,
  scoring_breakdown JSONB,
  category TEXT NOT NULL DEFAULT 'viral-short',
  hook TEXT NOT NULL,
  topic TEXT,
  emotion TEXT,
  virality_reason TEXT,
  transcript JSONB,
  captions_config JSONB,
  reframing_config JSONB,
  smart_reframe_config JSONB,
  audio_config JSONB,
  social_metadata JSONB,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS render_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  clip_id TEXT REFERENCES clips(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'RENDER_CLIP',
  target_resolution TEXT NOT NULL DEFAULT '1080p',
  target_aspect_ratio TEXT NOT NULL DEFAULT '9:16',
  status TEXT NOT NULL DEFAULT 'pending',
  current_stage TEXT NOT NULL DEFAULT 'QUEUED',
  progress INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error TEXT,
  logs JSONB,
  result_data JSONB,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  clip_id TEXT REFERENCES clips(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clip_title TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'mp4',
  resolution TEXT NOT NULL DEFAULT '1080p',
  fps INTEGER NOT NULL DEFAULT 60,
  file_size_bytes INTEGER NOT NULL,
  signed_url TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS usages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  processing_seconds INTEGER NOT NULL DEFAULT 0,
  rendering_seconds INTEGER NOT NULL DEFAULT 0,
  ai_tokens INTEGER NOT NULL DEFAULT 0,
  storage_bytes INTEGER NOT NULL DEFAULT 0,
  credits_remaining INTEGER NOT NULL DEFAULT 100,
  period TEXT NOT NULL DEFAULT '2026-09',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  current_period_end TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_settings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  default_language TEXT NOT NULL DEFAULT 'auto',
  default_aspect_ratio TEXT NOT NULL DEFAULT '9:16',
  default_preset TEXT NOT NULL DEFAULT 'dynamic-mrbeast',
  default_resolution TEXT NOT NULL DEFAULT '1080p',
  auto_captions BOOLEAN NOT NULL DEFAULT true,
  auto_reframing BOOLEAN NOT NULL DEFAULT true,
  watermark_enabled BOOLEAN NOT NULL DEFAULT false,
  export_format TEXT NOT NULL DEFAULT 'mp4',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for optimal querying by tenant
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_clips_project_id ON clips(project_id);
CREATE INDEX IF NOT EXISTS idx_render_jobs_user_id ON render_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_render_jobs_status ON render_jobs(status);
CREATE INDEX IF NOT EXISTS idx_exports_user_id ON exports(user_id);
