import crypto from 'node:crypto';
import crypto from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { AppConfig } from './config.js';
import { getPlanEntitlements, type PlanEntitlements } from './plans.js';
import type { ClipCandidate, JobRecord, JobState, MediaMetadata, ProjectRecord, TranscriptDocument } from './types.js';

export interface UserRecord { id: string; email: string; passwordHash: string; role: 'user' | 'admin'; emailVerified: boolean; }

export interface ProjectRepository {
  health(): Promise<void>;
  registerUser(input: { email: string; passwordHash: string }): Promise<UserRecord>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  isSessionRevoked(tokenHash: string): Promise<boolean>;
  revokeSession(tokenHash: string): Promise<void>;
  getPlanEntitlements(userId: string): Promise<PlanEntitlements>;
  reserveCredit(userId: string, kind: string, metadata?: Record<string, unknown>): Promise<void>;
  getAdminOverview(): Promise<Record<string, number>>;
  listAdminJobs(limit: number): Promise<Array<Record<string, unknown>>>;
  listBrandKits(userId: string): Promise<Array<Record<string, unknown>>>;
  createBrandKit(userId: string, input: { name: string; data: Record<string, unknown>; isDefault: boolean }): Promise<Record<string, unknown>>;
  listTemplates(userId: string): Promise<Array<Record<string, unknown>>>;
  createTemplate(userId: string, input: { name: string; data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  createProject(input: { userId: string; sourceUrl: string; sourceVideoId: string; jobMetadata?: Record<string, unknown> }): Promise<{ project: ProjectRecord; job: JobRecord }>;
  listProjects(userId: string): Promise<ProjectRecord[]>;
  getProject(userId: string, projectId: string): Promise<ProjectRecord | null>;
  getJob(userId: string, jobId: string): Promise<JobRecord | null>;
  isJobCancelled(jobId: string): Promise<boolean>;
  updateJob(jobId: string, update: { state?: JobState; progress?: number; message?: string; errorCode?: string | null }): Promise<void>;
  updateProjectMetadata(projectId: string, metadata: MediaMetadata): Promise<void>;
  updateProjectTranscript(projectId: string, transcript: TranscriptDocument): Promise<void>;
  saveClips(projectId: string, clips: ClipCandidate[]): Promise<void>;
  saveSourceStorage(projectId: string, storageKey: string): Promise<void>;
  getSourceStorageKey(userId: string, projectId: string): Promise<string | null>;
  markProjectFailed(projectId: string): Promise<void>;
  saveExport(input: { userId: string; projectId: string; clipId: string; storageKey: string; contentType: string; sizeBytes: number }): Promise<string>;
  listExports(userId: string): Promise<Array<Record<string, unknown>>>;
  getExport(userId: string, exportId: string): Promise<Record<string, unknown> | null>;
  createRenderJob(input: { userId: string; projectId: string; clipId: string; metadata: Record<string, unknown> }): Promise<JobRecord>;
}

function mapJob(row: Record<string, unknown>): JobRecord {
  return {
    id: String(row.id), userId: String(row.user_id), projectId: String(row.project_id), kind: row.kind as JobRecord['kind'],
    state: row.state as JobState, progress: Number(row.progress), message: String(row.message ?? ''),
    errorCode: row.error_code ? String(row.error_code) : null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapProject(row: Record<string, unknown>, clips: ClipCandidate[] = []): ProjectRecord {
  const metadata = row.metadata as MediaMetadata | null;
  return {
    id: String(row.id), userId: String(row.user_id), name: String(row.name), sourceUrl: String(row.source_url),
    sourceVideoId: String(row.source_video_id), status: row.status as ProjectRecord['status'], metadata,
    transcript: (row.transcript as TranscriptDocument | null) ?? null, clips,
    createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export class PostgresProjectRepository implements ProjectRepository {
  readonly pool: Pool;
  constructor(config: AppConfig) {
    if (!config.DATABASE_URL) throw new AppError('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is required.', 503);
    this.pool = new Pool({ connectionString: config.DATABASE_URL, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  }

  async health() {
    await this.pool.query('SELECT 1');
  }

  async registerUser(input: { email: string; passwordHash: string }): Promise<UserRecord> {
    const id = crypto.randomUUID();
    try {
      const result = await this.pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email, password_hash, role, email_verified`, [id, input.email.toLowerCase(), input.passwordHash]);
      await this.pool.query(`INSERT INTO subscriptions (user_id, plan, status) VALUES ($1, 'FREE', 'active')`, [id]);
      const row = result.rows[0];
      return { id: String(row.id), email: String(row.email), passwordHash: String(row.password_hash), role: row.role as UserRecord['role'], emailVerified: Boolean(row.email_verified) };
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new AppError('EMAIL_ALREADY_REGISTERED', 'An account with this email already exists.', 409);
      throw error;
    }
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const result = await this.pool.query(`SELECT id, email, password_hash, role, email_verified FROM users WHERE email = $1`, [email.toLowerCase()]);
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return { id: String(row.id), email: String(row.email), passwordHash: String(row.password_hash ?? ''), role: row.role as UserRecord['role'], emailVerified: Boolean(row.email_verified) };
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date) {
    await this.pool.query(`INSERT INTO auth_sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`, [crypto.randomUUID(), userId, tokenHash, expiresAt]);
  }

  async isSessionRevoked(tokenHash: string) {
    const result = await this.pool.query(`SELECT revoked_at, expires_at FROM auth_sessions WHERE token_hash = $1`, [tokenHash]);
    return !result.rows[0] || result.rows[0].revoked_at !== null || new Date(result.rows[0].expires_at).getTime() <= Date.now();
  }

  async revokeSession(tokenHash: string) {
    await this.pool.query(`UPDATE auth_sessions SET revoked_at = NOW() WHERE token_hash = $1`, [tokenHash]);
  }

  async getPlanEntitlements(userId: string) {
    const result = await this.pool.query(`SELECT plan FROM subscriptions WHERE user_id = $1`, [userId]);
    return getPlanEntitlements(result.rows[0]?.plan);
  }

  async reserveCredit(userId: string, kind: string, metadata: Record<string, unknown> = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [userId]);
      await client.query(`INSERT INTO subscriptions (user_id, plan, status) VALUES ($1, 'FREE', 'active') ON CONFLICT (user_id) DO NOTHING`, [userId]);
      const subscription = await client.query(`SELECT plan FROM subscriptions WHERE user_id = $1 FOR UPDATE`, [userId]);
      const plan = getPlanEntitlements(subscription.rows[0]?.plan);
      const usage = await client.query(`SELECT COALESCE(SUM(units), 0) AS used FROM usage_records WHERE user_id = $1 AND kind = 'processing_credit' AND created_at >= date_trunc('month', NOW())`, [userId]);
      if (Number(usage.rows[0].used) + 1 > plan.monthlyCredits) throw new AppError('CREDIT_LIMIT_REACHED', 'Your monthly processing credits have been exhausted.', 402);
      await client.query(`INSERT INTO usage_records (user_id, kind, units, metadata) VALUES ($1, 'processing_credit', 1, $2)`, [userId, JSON.stringify({ kind, ...metadata })]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getAdminOverview() {
    const result = await this.pool.query(`SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM projects) AS projects,
      (SELECT COUNT(*) FROM render_jobs WHERE state IN ('QUEUED', 'DOWNLOADING', 'EXTRACTING_AUDIO', 'TRANSCRIBING', 'ANALYZING', 'GENERATING_CLIPS', 'RENDERING', 'UPLOADING')) AS active_jobs,
      (SELECT COUNT(*) FROM render_jobs WHERE state = 'FAILED') AS failed_jobs,
      (SELECT COALESCE(SUM(size_bytes), 0) FROM exports) AS export_bytes,
      (SELECT COALESCE(SUM(units), 0) FROM api_usage) AS ai_units`);
    return Object.fromEntries(Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)]));
  }

  async listAdminJobs(limit: number) {
    const result = await this.pool.query(`SELECT id, user_id, project_id, kind, state, progress, message, error_code, created_at, updated_at FROM render_jobs ORDER BY updated_at DESC LIMIT $1`, [limit]);
    return result.rows;
  }

  async listBrandKits(userId: string) {
    const result = await this.pool.query(`SELECT id, name, data, is_default, created_at, updated_at FROM brand_kits WHERE user_id = $1 ORDER BY is_default DESC, updated_at DESC`, [userId]);
    return result.rows;
  }

  async createBrandKit(userId: string, input: { name: string; data: Record<string, unknown>; isDefault: boolean }) {
    if (input.isDefault) await this.pool.query('UPDATE brand_kits SET is_default = FALSE WHERE user_id = $1', [userId]);
    const result = await this.pool.query(`INSERT INTO brand_kits (id, user_id, name, data, is_default) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, data, is_default, created_at, updated_at`, [crypto.randomUUID(), userId, input.name, input.data, input.isDefault]);
    return result.rows[0];
  }

  async listTemplates(userId: string) {
    const result = await this.pool.query(`SELECT id, name, data, created_at, updated_at FROM templates WHERE user_id = $1 OR user_id IS NULL ORDER BY user_id NULLS FIRST, updated_at DESC`, [userId]);
    return result.rows;
  }

  async createTemplate(userId: string, input: { name: string; data: Record<string, unknown> }) {
    const result = await this.pool.query(`INSERT INTO templates (id, user_id, name, data) VALUES ($1, $2, $3, $4) RETURNING id, name, data, created_at, updated_at`, [crypto.randomUUID(), userId, input.name, input.data]);
    return result.rows[0];
  }

  async createProject(input: { userId: string; sourceUrl: string; sourceVideoId: string; jobMetadata?: Record<string, unknown> }) {
    const client = await this.pool.connect();
    const projectId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [input.userId]);
      await client.query(`INSERT INTO subscriptions (user_id, plan, status) VALUES ($1, 'FREE', 'active') ON CONFLICT (user_id) DO NOTHING`, [input.userId]);
      const projectResult = await client.query(`
        INSERT INTO projects (id, user_id, name, source_url, source_video_id, status)
        VALUES ($1, $2, $3, $4, $5, 'PROCESSING') RETURNING *`,
        [projectId, input.userId, `YouTube project ${input.sourceVideoId}`, input.sourceUrl, input.sourceVideoId]);
      await client.query(`INSERT INTO render_jobs (id, user_id, project_id, kind, state, progress, message, metadata)
        VALUES ($1, $2, $3, 'analysis', 'QUEUED', 0, 'Waiting for worker', $4)`, [jobId, input.userId, projectId, JSON.stringify(input.jobMetadata ?? {})]);
      await client.query('COMMIT');
      return { project: mapProject(projectResult.rows[0]), job: mapJob((await this.pool.query('SELECT * FROM render_jobs WHERE id = $1', [jobId])).rows[0]) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listProjects(userId: string) {
    const result = await this.pool.query(`SELECT p.*, t.data AS transcript,
      COALESCE(json_agg(c.data) FILTER (WHERE c.id IS NOT NULL), '[]') AS clips
      FROM projects p LEFT JOIN transcripts t ON t.project_id = p.id
      LEFT JOIN clips c ON c.project_id = p.id WHERE p.user_id = $1
      GROUP BY p.id, t.data ORDER BY p.created_at DESC`, [userId]);
    return result.rows.map((row) => mapProject(row, (row.clips ?? []) as ClipCandidate[]));
  }

  async getProject(userId: string, projectId: string) {
    const result = await this.pool.query(`SELECT p.*, t.data AS transcript,
      COALESCE(json_agg(c.data) FILTER (WHERE c.id IS NOT NULL), '[]') AS clips
      FROM projects p LEFT JOIN transcripts t ON t.project_id = p.id
      LEFT JOIN clips c ON c.project_id = p.id WHERE p.user_id = $1 AND p.id = $2
      GROUP BY p.id, t.data`, [userId, projectId]);
    if (!result.rows[0]) return null;
    return mapProject(result.rows[0], (result.rows[0].clips ?? []) as ClipCandidate[]);
  }

  async getJob(userId: string, jobId: string) {
    const result = await this.pool.query('SELECT * FROM render_jobs WHERE user_id = $1 AND id = $2', [userId, jobId]);
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  async isJobCancelled(jobId: string) {
    const result = await this.pool.query(`SELECT state FROM render_jobs WHERE id = $1`, [jobId]);
    return result.rows[0]?.state === 'CANCELLED';
  }

  async updateJob(jobId: string, update: { state?: JobState; progress?: number; message?: string; errorCode?: string | null }) {
    await this.pool.query(`UPDATE render_jobs SET
      state = COALESCE($2, state), progress = COALESCE($3, progress), message = COALESCE($4, message),
      error_code = $5, updated_at = NOW(), completed_at = CASE WHEN $2 IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN NOW() ELSE completed_at END
      WHERE id = $1`, [jobId, update.state ?? null, update.progress ?? null, update.message ?? null, update.errorCode ?? null]);
  }

  async updateProjectMetadata(projectId: string, metadata: MediaMetadata) {
    await this.pool.query(`UPDATE projects SET name = $2, metadata = $3, updated_at = NOW() WHERE id = $1`, [projectId, metadata.title, metadata]);
    await this.pool.query(`INSERT INTO videos (project_id, source_url, provider_id, metadata) VALUES ($1, $2, $3, $4)
      ON CONFLICT (project_id) DO UPDATE SET metadata = EXCLUDED.metadata`, [projectId, metadata.sourceUrl, metadata.sourceId, metadata]);
  }

  async updateProjectTranscript(projectId: string, transcript: TranscriptDocument) {
    await this.pool.query(`INSERT INTO transcripts (project_id, language, data) VALUES ($1, $2, $3)
      ON CONFLICT (project_id) DO UPDATE SET language = EXCLUDED.language, data = EXCLUDED.data`, [projectId, transcript.language, transcript]);
  }

  async saveClips(projectId: string, clips: ClipCandidate[]) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const clip of clips) {
        await client.query(`INSERT INTO clips (id, project_id, start_seconds, end_seconds, score, data)
          VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, score = EXCLUDED.score`,
          [clip.id, projectId, clip.start, clip.end, clip.score, clip]);
      }
      await client.query(`UPDATE projects SET status = 'READY', updated_at = NOW() WHERE id = $1`, [projectId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async saveSourceStorage(projectId: string, storageKey: string) {
    await this.pool.query(`UPDATE videos SET source_storage_key = $2 WHERE project_id = $1`, [projectId, storageKey]);
  }

  async getSourceStorageKey(userId: string, projectId: string) {
    const result = await this.pool.query(`SELECT v.source_storage_key FROM videos v JOIN projects p ON p.id = v.project_id WHERE p.user_id = $1 AND p.id = $2`, [userId, projectId]);
    return result.rows[0]?.source_storage_key ? String(result.rows[0].source_storage_key) : null;
  }

  async markProjectFailed(projectId: string) {
    await this.pool.query(`UPDATE projects SET status = 'FAILED', updated_at = NOW() WHERE id = $1`, [projectId]);
  }

  async saveExport(input: { userId: string; projectId: string; clipId: string; storageKey: string; contentType: string; sizeBytes: number }) {
    const id = crypto.randomUUID();
    await this.pool.query(`INSERT INTO exports (id, user_id, project_id, clip_id, storage_key, content_type, size_bytes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id, input.userId, input.projectId, input.clipId, input.storageKey, input.contentType, input.sizeBytes]);
    return id;
  }

  async listExports(userId: string) {
    const result = await this.pool.query(`SELECT id, project_id, clip_id, storage_key, content_type, size_bytes, created_at FROM exports WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
    return result.rows;
  }

  async getExport(userId: string, exportId: string) {
    const result = await this.pool.query(`SELECT id, project_id, clip_id, storage_key, content_type, size_bytes, created_at FROM exports WHERE user_id = $1 AND id = $2`, [userId, exportId]);
    return result.rows[0] ?? null;
  }

  async createRenderJob(input: { userId: string; projectId: string; clipId: string; metadata: Record<string, unknown> }) {
    const jobId = crypto.randomUUID();
    const result = await this.pool.query(`INSERT INTO render_jobs (id, user_id, project_id, kind, state, progress, message, metadata)
      VALUES ($1, $2, $3, 'render', 'QUEUED', 0, 'Waiting for worker', $4) RETURNING *`, [jobId, input.userId, input.projectId, { ...input.metadata, clipId: input.clipId }]);
    return mapJob(result.rows[0]);
  }
}

export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
