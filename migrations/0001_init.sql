-- ClipForge AI — Cloudflare D1 schema. Timestamps are Unix epoch milliseconds.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  plan TEXT NOT NULL DEFAULT 'FREE' CHECK (plan IN ('FREE', 'CREATOR', 'PRO')),
  suspended_at INTEGER,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_video_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING', 'READY', 'FAILED', 'ARCHIVED')),
  metadata TEXT,
  source_key TEXT,
  transcript_key TEXT,
  audio_chunks TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX projects_user_created_idx ON projects(user_id, created_at DESC);
CREATE INDEX projects_source_key_idx ON projects(source_key);

CREATE TABLE clips (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  start_seconds REAL NOT NULL,
  end_seconds REAL NOT NULL,
  score REAL NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX clips_project_idx ON clips(project_id, start_seconds);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('analysis', 'render')),
  state TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  error_code TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  container_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX jobs_user_created_idx ON jobs(user_id, created_at DESC);
CREATE INDEX jobs_state_updated_idx ON jobs(state, updated_at);
CREATE INDEX jobs_project_idx ON jobs(project_id, created_at DESC);
CREATE INDEX jobs_container_idx ON jobs(container_id);

CREATE TABLE exports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  clip_id TEXT NOT NULL,
  job_id TEXT,
  storage_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX exports_user_created_idx ON exports(user_id, created_at DESC);
CREATE INDEX exports_job_idx ON exports(job_id);

CREATE TABLE usage_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  units INTEGER NOT NULL,
  ref TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX usage_user_kind_created_idx ON usage_records(user_id, kind, created_at);
-- Refunds are idempotent per job.
CREATE UNIQUE INDEX usage_refund_ref_idx ON usage_records(ref) WHERE ref LIKE 'refund:%';

CREATE TABLE api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  provider TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX api_usage_created_idx ON api_usage(created_at);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_logs_created_idx ON audit_logs(created_at);

CREATE TABLE brand_kits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX brand_kits_user_idx ON brand_kits(user_id);

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX templates_user_idx ON templates(user_id);
