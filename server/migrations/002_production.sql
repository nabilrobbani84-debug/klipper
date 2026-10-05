ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

ALTER TABLE exports ADD COLUMN IF NOT EXISTS job_id TEXT;
ALTER TABLE exports ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS render_jobs_state_idx ON render_jobs(state, updated_at DESC);
CREATE INDEX IF NOT EXISTS render_jobs_project_idx ON render_jobs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS exports_user_created_idx ON exports(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);
