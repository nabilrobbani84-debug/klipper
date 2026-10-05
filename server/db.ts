import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { AppConfig } from './config.js';
import { AppError } from './errors.js';
import { getPlanEntitlements, type PlanCode, type PlanEntitlements } from './plans.js';
import type {
  AuthenticatedUser,
  ClipCandidate,
  ClipEditorState,
  ExportRecord,
  JobRecord,
  JobState,
  MediaMetadata,
  ProjectRecord,
  TranscriptDocument,
  UserRole,
} from './types.js';

const { Pool } = pg;
type PoolClient = pg.PoolClient;
type Row = Record<string, unknown>;

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  plan: PlanCode;
  suspended: boolean;
  createdAt: string;
}

export interface UsageSummary {
  plan: PlanEntitlements;
  creditsUsed: number;
  creditsRemaining: number;
  storageBytes: number;
  activeJobs: number;
}

const ACTIVE_STATES_SQL = `('QUEUED','DOWNLOADING','EXTRACTING_AUDIO','TRANSCRIBING','ANALYZING','GENERATING_CLIPS','REFRAMING','GENERATING_CAPTIONS','RENDERING','UPLOADING')`;

const iso = (value: unknown) => new Date(String(value)).toISOString();
const json = (value: unknown) => JSON.stringify(value ?? null);

function mapJob(row: Row): JobRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    projectId: String(row.project_id),
    kind: row.kind as JobRecord['kind'],
    state: row.state as JobState,
    progress: Number(row.progress),
    message: String(row.message ?? ''),
    errorCode: row.error_code ? String(row.error_code) : null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapProject(row: Row): ProjectRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    sourceUrl: String(row.source_url),
    sourceVideoId: String(row.source_video_id),
    status: row.status as ProjectRecord['status'],
    metadata: (row.metadata as MediaMetadata | null) ?? null,
    transcript: (row.transcript as TranscriptDocument | null) ?? null,
    clips: ((row.clips as ClipCandidate[] | null) ?? []).sort((a, b) => a.start - b.start),
    latestJobId: row.latest_job_id ? String(row.latest_job_id) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapUser(row: Row): UserRecord {
  return {
    id: String(row.id),
    email: String(row.email ?? ''),
    passwordHash: String(row.password_hash ?? ''),
    role: (row.role as UserRole) ?? 'user',
    plan: getPlanEntitlements(row.plan as string | undefined).code,
    suspended: row.suspended_at !== null && row.suspended_at !== undefined,
    createdAt: iso(row.created_at),
  };
}

function mapExport(row: Row): ExportRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    clipId: String(row.clip_id),
    clipTitle: String(row.clip_title ?? 'Clip'),
    projectName: String(row.project_name ?? 'Project'),
    thumbnailUrl: (row.thumbnail_url as string | null) ?? null,
    storageKey: String(row.storage_key),
    contentType: String(row.content_type),
    sizeBytes: Number(row.size_bytes),
    settings: (row.settings ?? {}) as Record<string, unknown>,
    createdAt: iso(row.created_at),
  };
}

const PROJECT_SELECT = `
  SELECT p.*,
    COALESCE((SELECT json_agg(c.data ORDER BY c.start_seconds) FROM clips c WHERE c.project_id = p.id), '[]'::json) AS clips,
    (SELECT j.id FROM render_jobs j WHERE j.project_id = p.id AND j.kind = 'analysis' ORDER BY j.created_at DESC LIMIT 1) AS latest_job_id`;

export class Repository {
  readonly pool: pg.Pool;

  constructor(config: Pick<AppConfig, 'DATABASE_URL'>) {
    if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required');
    this.pool = new Pool({ connectionString: config.DATABASE_URL, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  }

  async close() {
    await this.pool.end();
  }

  async health() {
    await this.pool.query('SELECT 1');
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------- users & sessions

  async registerUser(input: { email: string; passwordHash: string; role: UserRole }): Promise<UserRecord> {
    const id = crypto.randomUUID();
    try {
      return await this.transaction(async (client) => {
        await client.query(`INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4)`, [id, input.email.toLowerCase(), input.passwordHash, input.role]);
        await client.query(`INSERT INTO subscriptions (user_id, plan, status, period_start) VALUES ($1, 'FREE', 'active', NOW()) ON CONFLICT (user_id) DO NOTHING`, [id]);
        const result = await client.query(`SELECT u.*, s.plan FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id WHERE u.id = $1`, [id]);
        return mapUser(result.rows[0]);
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new AppError('EMAIL_ALREADY_REGISTERED', 'An account with this email already exists.', 409);
      throw error;
    }
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const result = await this.pool.query(`SELECT u.*, s.plan FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id WHERE u.email = $1`, [email.toLowerCase()]);
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  /** Finds an existing user by email or provisions one (used by federated/Google sign-in). */
  async findOrCreateFederatedUser(input: { email: string; role: UserRole }): Promise<UserRecord> {
    const existing = await this.findUserByEmail(input.email);
    if (existing) {
      if (input.role === 'admin' && existing.role !== 'admin') {
        await this.setUserRole(existing.id, 'admin');
        existing.role = 'admin';
      }
      return existing;
    }
    const id = crypto.randomUUID();
    return this.transaction(async (client) => {
      await client.query(`INSERT INTO users (id, email, email_verified, role) VALUES ($1, $2, TRUE, $3)`, [id, input.email.toLowerCase(), input.role]);
      await client.query(`INSERT INTO subscriptions (user_id, plan, status, period_start) VALUES ($1, 'FREE', 'active', NOW())`, [id]);
      const result = await client.query(`SELECT u.*, s.plan FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id WHERE u.id = $1`, [id]);
      return mapUser(result.rows[0]);
    });
  }

  async getUser(userId: string): Promise<UserRecord | null> {
    const result = await this.pool.query(`SELECT u.*, s.plan FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id WHERE u.id = $1`, [userId]);
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async setUserRole(userId: string, role: UserRole) {
    await this.pool.query(`UPDATE users SET role = $2 WHERE id = $1`, [userId, role]);
  }

  async ensureDevUser(userId: string) {
    await this.pool.query(`INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [userId]);
    await this.pool.query(`INSERT INTO subscriptions (user_id, plan, status) VALUES ($1, 'FREE', 'active') ON CONFLICT (user_id) DO NOTHING`, [userId]);
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date) {
    await this.pool.query(`INSERT INTO auth_sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`, [crypto.randomUUID(), userId, tokenHash, expiresAt]);
    await this.pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [userId]);
  }

  async findActiveSession(tokenHash: string): Promise<AuthenticatedUser | null> {
    const result = await this.pool.query(
      `SELECT u.id, u.email, u.role FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW() AND u.suspended_at IS NULL`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row ? { id: String(row.id), email: row.email ? String(row.email) : undefined, role: row.role as UserRole } : null;
  }

  async revokeSession(tokenHash: string) {
    await this.pool.query(`UPDATE auth_sessions SET revoked_at = NOW() WHERE token_hash = $1`, [tokenHash]);
  }

  async revokeUserSessions(userId: string) {
    await this.pool.query(`UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  }

  async deleteUser(userId: string) {
    await this.pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  }

  async audit(userId: string | null, action: string, resourceType: string | null, resourceId: string | null, metadata: Record<string, unknown> = {}) {
    await this.pool.query(`INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata) VALUES ($1, $2, $3, $4, $5)`, [userId, action, resourceType, resourceId, json(metadata)]).catch(() => undefined);
  }

  // ---------------------------------------------------------------- plans, credits, usage

  async getPlanEntitlements(userId: string): Promise<PlanEntitlements> {
    const result = await this.pool.query(`SELECT plan FROM subscriptions WHERE user_id = $1`, [userId]);
    return getPlanEntitlements(result.rows[0]?.plan);
  }

  async getUsage(userId: string): Promise<UsageSummary> {
    const plan = await this.getPlanEntitlements(userId);
    const result = await this.pool.query(
      `SELECT
        (SELECT COALESCE(SUM(units), 0) FROM usage_records WHERE user_id = $1 AND kind = 'processing_credit' AND created_at >= date_trunc('month', NOW())) AS credits_used,
        (SELECT COALESCE(SUM(size_bytes), 0) FROM exports WHERE user_id = $1) AS storage_bytes,
        (SELECT COUNT(*) FROM render_jobs WHERE user_id = $1 AND state IN ${ACTIVE_STATES_SQL}) AS active_jobs`,
      [userId],
    );
    const row = result.rows[0];
    const creditsUsed = Number(row.credits_used);
    return { plan, creditsUsed, creditsRemaining: Math.max(0, plan.monthlyCredits - creditsUsed), storageBytes: Number(row.storage_bytes), activeJobs: Number(row.active_jobs) };
  }

  /**
   * Atomically checks plan limits and reserves one processing credit. The subscription row lock serialises
   * concurrent requests from the same user so parallel submissions cannot overspend credits.
   */
  async reserveCredit(userId: string, reference: Record<string, unknown>): Promise<PlanEntitlements> {
    return this.transaction(async (client) => {
      await client.query(`INSERT INTO subscriptions (user_id, plan, status) VALUES ($1, 'FREE', 'active') ON CONFLICT (user_id) DO NOTHING`, [userId]);
      const subscription = await client.query(`SELECT plan FROM subscriptions WHERE user_id = $1 FOR UPDATE`, [userId]);
      const plan = getPlanEntitlements(subscription.rows[0]?.plan);
      const usage = await client.query(
        `SELECT
          (SELECT COALESCE(SUM(units), 0) FROM usage_records WHERE user_id = $1 AND kind = 'processing_credit' AND created_at >= date_trunc('month', NOW())) AS used,
          (SELECT COUNT(*) FROM render_jobs WHERE user_id = $1 AND state IN ${ACTIVE_STATES_SQL}) AS active,
          (SELECT COALESCE(SUM(size_bytes), 0) FROM exports WHERE user_id = $1) AS storage`,
        [userId],
      );
      const row = usage.rows[0];
      if (Number(row.used) + 1 > plan.monthlyCredits) throw new AppError('CREDIT_LIMIT_REACHED', `Your ${plan.code} plan's monthly processing credits are used up.`, 402);
      if (Number(row.active) >= plan.concurrentJobs) throw new AppError('CONCURRENCY_LIMIT', `Your ${plan.code} plan allows ${plan.concurrentJobs} job(s) at a time. Wait for the current job to finish.`, 429);
      if (Number(row.storage) >= plan.storageLimitBytes) throw new AppError('STORAGE_LIMIT_REACHED', 'Your storage limit is reached. Delete old exports to continue.', 402);
      await client.query(`INSERT INTO usage_records (user_id, kind, units, metadata) VALUES ($1, 'processing_credit', 1, $2)`, [userId, json(reference)]);
      return plan;
    });
  }

  /** Returns a credit when a job fails or is cancelled before producing results. Idempotent per job. */
  async refundCredit(userId: string, jobId: string) {
    await this.pool.query(
      `INSERT INTO usage_records (user_id, kind, units, metadata)
       SELECT $1, 'processing_credit', -1, $3::jsonb
       WHERE NOT EXISTS (SELECT 1 FROM usage_records WHERE user_id = $1 AND units < 0 AND metadata->>'refundFor' = $2)`,
      [userId, jobId, json({ refundFor: jobId })],
    );
  }

  async countActiveJobs(userId: string, kind?: JobRecord['kind']): Promise<number> {
    const result = await this.pool.query(`SELECT COUNT(*) AS n FROM render_jobs WHERE user_id = $1 AND state IN ${ACTIVE_STATES_SQL} AND ($2::text IS NULL OR kind = $2)`, [userId, kind ?? null]);
    return Number(result.rows[0].n);
  }

  async recordApiUsage(userId: string, provider: string, metadata: Record<string, unknown>) {
    await this.pool.query(`INSERT INTO api_usage (user_id, provider, units, metadata) VALUES ($1, $2, 1, $3)`, [userId, provider, json(metadata)]).catch(() => undefined);
  }

  // ---------------------------------------------------------------- projects

  async createProject(input: { userId: string; sourceUrl: string; sourceVideoId: string; jobMetadata: Record<string, unknown> }): Promise<{ project: ProjectRecord; job: JobRecord }> {
    const projectId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    await this.transaction(async (client) => {
      await client.query(`INSERT INTO projects (id, user_id, name, source_url, source_video_id, status) VALUES ($1, $2, $3, $4, $5, 'PROCESSING')`, [projectId, input.userId, `YouTube video ${input.sourceVideoId}`, input.sourceUrl, input.sourceVideoId]);
      await client.query(`INSERT INTO render_jobs (id, user_id, project_id, kind, state, progress, message, metadata) VALUES ($1, $2, $3, 'analysis', 'QUEUED', 0, 'Waiting for an available worker…', $4)`, [jobId, input.userId, projectId, json(input.jobMetadata)]);
    });
    const project = await this.getProject(input.userId, projectId);
    const job = await this.getJobById(jobId);
    if (!project || !job) throw new AppError('PROJECT_CREATE_FAILED', 'The project could not be created.', 500);
    return { project, job };
  }

  async listProjects(userId: string): Promise<ProjectRecord[]> {
    const result = await this.pool.query(`${PROJECT_SELECT}, NULL::jsonb AS transcript FROM projects p WHERE p.user_id = $1 ORDER BY p.created_at DESC LIMIT 200`, [userId]);
    return result.rows.map(mapProject);
  }

  async getProject(userId: string, projectId: string): Promise<ProjectRecord | null> {
    const result = await this.pool.query(`${PROJECT_SELECT}, (SELECT t.data FROM transcripts t WHERE t.project_id = p.id) AS transcript FROM projects p WHERE p.user_id = $1 AND p.id = $2`, [userId, projectId]);
    return result.rows[0] ? mapProject(result.rows[0]) : null;
  }

  async renameProject(userId: string, projectId: string, name: string): Promise<boolean> {
    const result = await this.pool.query(`UPDATE projects SET name = $3, updated_at = NOW() WHERE user_id = $1 AND id = $2`, [userId, projectId, name]);
    return (result.rowCount ?? 0) > 0;
  }

  async deleteProject(userId: string, projectId: string): Promise<boolean> {
    const result = await this.pool.query(`DELETE FROM projects WHERE user_id = $1 AND id = $2`, [userId, projectId]);
    return (result.rowCount ?? 0) > 0;
  }

  /** Copies project, transcript and clips (not exports). The new project reuses the stored source media key. */
  async duplicateProject(userId: string, projectId: string): Promise<string | null> {
    return this.transaction(async (client) => {
      const original = await client.query(`SELECT * FROM projects WHERE user_id = $1 AND id = $2`, [userId, projectId]);
      if (!original.rows[0]) return null;
      const id = crypto.randomUUID();
      await client.query(`INSERT INTO projects (id, user_id, name, source_url, source_video_id, status, metadata) SELECT $3, user_id, name || ' (Copy)', source_url, source_video_id, status, metadata FROM projects WHERE user_id = $1 AND id = $2`, [userId, projectId, id]);
      await client.query(`INSERT INTO videos (project_id, source_url, provider_id, metadata, source_storage_key) SELECT $2, source_url, provider_id, metadata, source_storage_key FROM videos WHERE project_id = $1`, [projectId, id]);
      await client.query(`INSERT INTO transcripts (project_id, language, data) SELECT $2, language, data FROM transcripts WHERE project_id = $1`, [projectId, id]);
      const clips = await client.query(`SELECT data FROM clips WHERE project_id = $1`, [projectId]);
      for (const row of clips.rows) {
        const clip = { ...(row.data as ClipCandidate), id: `clip-${crypto.randomUUID()}` };
        await client.query(`INSERT INTO clips (id, project_id, start_seconds, end_seconds, score, data) VALUES ($1, $2, $3, $4, $5, $6)`, [clip.id, id, clip.start, clip.end, clip.score, json(clip)]);
      }
      return id;
    });
  }

  async updateProjectMetadata(projectId: string, metadata: MediaMetadata) {
    await this.pool.query(`UPDATE projects SET name = $2, metadata = $3, updated_at = NOW() WHERE id = $1`, [projectId, metadata.title, json(metadata)]);
    await this.pool.query(
      `INSERT INTO videos (project_id, source_url, provider_id, metadata) VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id) DO UPDATE SET metadata = EXCLUDED.metadata`,
      [projectId, metadata.sourceUrl, metadata.sourceId, json(metadata)],
    );
  }

  async saveSourceStorage(projectId: string, storageKey: string) {
    await this.pool.query(`UPDATE videos SET source_storage_key = $2 WHERE project_id = $1`, [projectId, storageKey]);
  }

  async getSourceStorageKey(projectId: string): Promise<string | null> {
    const result = await this.pool.query(`SELECT source_storage_key FROM videos WHERE project_id = $1`, [projectId]);
    return result.rows[0]?.source_storage_key ? String(result.rows[0].source_storage_key) : null;
  }

  async countSourceReferences(storageKey: string): Promise<number> {
    const result = await this.pool.query(`SELECT COUNT(*) AS n FROM videos WHERE source_storage_key = $1`, [storageKey]);
    return Number(result.rows[0].n);
  }

  async updateProjectTranscript(projectId: string, transcript: TranscriptDocument) {
    await this.pool.query(
      `INSERT INTO transcripts (project_id, language, data) VALUES ($1, $2, $3)
       ON CONFLICT (project_id) DO UPDATE SET language = EXCLUDED.language, data = EXCLUDED.data`,
      [projectId, transcript.language, json(transcript)],
    );
  }

  async saveClips(projectId: string, clips: ClipCandidate[]) {
    await this.transaction(async (client) => {
      await client.query(`DELETE FROM clips WHERE project_id = $1 AND NOT EXISTS (SELECT 1 FROM exports e WHERE e.clip_id = clips.id)`, [projectId]);
      for (const clip of clips) {
        await client.query(
          `INSERT INTO clips (id, project_id, start_seconds, end_seconds, score, data) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, score = EXCLUDED.score, start_seconds = EXCLUDED.start_seconds, end_seconds = EXCLUDED.end_seconds`,
          [clip.id, projectId, clip.start, clip.end, clip.score, json(clip)],
        );
      }
      await client.query(`UPDATE projects SET status = 'READY', updated_at = NOW() WHERE id = $1`, [projectId]);
    });
  }

  async setProjectStatus(projectId: string, status: ProjectRecord['status']) {
    await this.pool.query(`UPDATE projects SET status = $2, updated_at = NOW() WHERE id = $1`, [projectId, status]);
  }

  /** Persists editor changes (trim, captions, reframe, audio) for a clip owned by the user. */
  async updateClip(userId: string, projectId: string, clipId: string, patch: { start?: number; end?: number; title?: string; editor?: Partial<ClipEditorState> }): Promise<ClipCandidate | null> {
    return this.transaction(async (client) => {
      const result = await client.query(
        `SELECT c.data, (p.metadata->>'durationSeconds')::numeric AS duration FROM clips c JOIN projects p ON p.id = c.project_id
         WHERE p.user_id = $1 AND p.id = $2 AND c.id = $3 FOR UPDATE OF c`,
        [userId, projectId, clipId],
      );
      if (!result.rows[0]) return null;
      const current = result.rows[0].data as ClipCandidate;
      const videoDuration = result.rows[0].duration ? Number(result.rows[0].duration) : Number.POSITIVE_INFINITY;
      const start = Math.max(0, patch.start ?? current.start);
      const end = Math.min(videoDuration, patch.end ?? current.end);
      if (end - start < 1) throw new AppError('INVALID_CLIP_RANGE', 'A clip must be at least 1 second long.', 400);
      if (end - start > 600) throw new AppError('INVALID_CLIP_RANGE', 'A clip cannot be longer than 10 minutes.', 400);
      const updated: ClipCandidate = {
        ...current,
        start,
        end,
        duration: Number((end - start).toFixed(3)),
        title: patch.title ?? current.title,
        editor: { ...(current.editor ?? {}), ...(patch.editor ?? {}) },
      };
      await client.query(`UPDATE clips SET data = $2, start_seconds = $3, end_seconds = $4 WHERE id = $1`, [clipId, json(updated), start, end]);
      await client.query(`UPDATE projects SET updated_at = NOW() WHERE id = $1`, [projectId]);
      return updated;
    });
  }

  // ---------------------------------------------------------------- jobs

  async getJob(userId: string, jobId: string): Promise<JobRecord | null> {
    const result = await this.pool.query(`SELECT * FROM render_jobs WHERE user_id = $1 AND id = $2`, [userId, jobId]);
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  async getJobById(jobId: string): Promise<JobRecord | null> {
    const result = await this.pool.query(`SELECT * FROM render_jobs WHERE id = $1`, [jobId]);
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  async listJobs(userId: string, limit = 50): Promise<JobRecord[]> {
    const result = await this.pool.query(`SELECT * FROM render_jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, [userId, limit]);
    return result.rows.map(mapJob);
  }

  /**
   * Progress update from a worker. Never overwrites a terminal state (e.g. a user cancellation that raced the
   * worker). Returns false when the job is no longer active, which tells the worker to stop.
   */
  async updateJobProgress(jobId: string, state: JobState, progress: number, message: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE render_jobs SET state = $2, progress = $3, message = $4, error_code = NULL, updated_at = NOW()
       WHERE id = $1 AND state NOT IN ('COMPLETED','FAILED','CANCELLED')`,
      [jobId, state, Math.round(Math.min(100, Math.max(0, progress))), message],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async finishJob(jobId: string, state: 'COMPLETED' | 'FAILED' | 'CANCELLED', message: string, errorCode: string | null, extraMetadata: Record<string, unknown> = {}) {
    await this.pool.query(
      `UPDATE render_jobs SET state = $2, progress = CASE WHEN $2 = 'COMPLETED' THEN 100 ELSE progress END, message = $3, error_code = $4,
         metadata = metadata || $5::jsonb, updated_at = NOW(), completed_at = NOW()
       WHERE id = $1 AND (state NOT IN ('COMPLETED','FAILED','CANCELLED') OR $2 = 'CANCELLED')`,
      [jobId, state, message, errorCode, json(extraMetadata)],
    );
  }

  async isJobCancelled(jobId: string): Promise<boolean> {
    const result = await this.pool.query(`SELECT state FROM render_jobs WHERE id = $1`, [jobId]);
    return !result.rows[0] || result.rows[0].state === 'CANCELLED';
  }

  async requestCancel(jobId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE render_jobs SET state = 'CANCELLED', message = 'Cancelled by user.', updated_at = NOW(), completed_at = NOW()
       WHERE id = $1 AND state IN ${ACTIVE_STATES_SQL}`,
      [jobId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async resetJobForRetry(jobId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE render_jobs SET state = 'QUEUED', progress = 0, message = 'Retry queued…', error_code = NULL, updated_at = NOW(), completed_at = NULL
       WHERE id = $1 AND state IN ('FAILED','CANCELLED')`,
      [jobId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async createRenderJob(input: { userId: string; projectId: string; clipId: string; metadata: Record<string, unknown> }): Promise<JobRecord> {
    const jobId = crypto.randomUUID();
    const result = await this.pool.query(
      `INSERT INTO render_jobs (id, user_id, project_id, kind, state, progress, message, metadata) VALUES ($1, $2, $3, 'render', 'QUEUED', 0, 'Waiting for an available worker…', $4) RETURNING *`,
      [jobId, input.userId, input.projectId, json({ ...input.metadata, clipId: input.clipId })],
    );
    return mapJob(result.rows[0]);
  }

  // ---------------------------------------------------------------- exports

  async saveExport(input: { userId: string; projectId: string; clipId: string; jobId: string; storageKey: string; contentType: string; sizeBytes: number; settings: Record<string, unknown> }): Promise<string> {
    const id = crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO exports (id, user_id, project_id, clip_id, job_id, storage_key, content_type, size_bytes, settings) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, input.userId, input.projectId, input.clipId, input.jobId, input.storageKey, input.contentType, input.sizeBytes, json(input.settings)],
    );
    return id;
  }

  private exportSelect = `
    SELECT e.*, c.data->>'title' AS clip_title, p.name AS project_name, p.metadata->>'thumbnailUrl' AS thumbnail_url
    FROM exports e JOIN clips c ON c.id = e.clip_id JOIN projects p ON p.id = e.project_id`;

  async listExports(userId: string): Promise<ExportRecord[]> {
    const result = await this.pool.query(`${this.exportSelect} WHERE e.user_id = $1 ORDER BY e.created_at DESC LIMIT 500`, [userId]);
    return result.rows.map(mapExport);
  }

  async getExport(userId: string, exportId: string): Promise<ExportRecord | null> {
    const result = await this.pool.query(`${this.exportSelect} WHERE e.user_id = $1 AND e.id = $2`, [userId, exportId]);
    return result.rows[0] ? mapExport(result.rows[0]) : null;
  }

  async getExportByJob(userId: string, jobId: string): Promise<ExportRecord | null> {
    const result = await this.pool.query(`${this.exportSelect} WHERE e.user_id = $1 AND e.job_id = $2`, [userId, jobId]);
    return result.rows[0] ? mapExport(result.rows[0]) : null;
  }

  async deleteExport(userId: string, exportId: string): Promise<string | null> {
    const result = await this.pool.query(`DELETE FROM exports WHERE user_id = $1 AND id = $2 RETURNING storage_key`, [userId, exportId]);
    return result.rows[0] ? String(result.rows[0].storage_key) : null;
  }

  // ---------------------------------------------------------------- brand kits & templates

  async listBrandKits(userId: string) {
    return (await this.pool.query(`SELECT id, name, data, is_default, created_at, updated_at FROM brand_kits WHERE user_id = $1 ORDER BY is_default DESC, updated_at DESC`, [userId])).rows;
  }

  async createBrandKit(userId: string, input: { name: string; data: Record<string, unknown>; isDefault: boolean }) {
    return this.transaction(async (client) => {
      if (input.isDefault) await client.query(`UPDATE brand_kits SET is_default = FALSE WHERE user_id = $1`, [userId]);
      return (await client.query(`INSERT INTO brand_kits (id, user_id, name, data, is_default) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, data, is_default, created_at, updated_at`, [crypto.randomUUID(), userId, input.name, json(input.data), input.isDefault])).rows[0];
    });
  }

  async listTemplates(userId: string) {
    return (await this.pool.query(`SELECT id, name, data, created_at, updated_at FROM templates WHERE user_id = $1 OR user_id IS NULL ORDER BY user_id NULLS FIRST, updated_at DESC`, [userId])).rows;
  }

  async createTemplate(userId: string, input: { name: string; data: Record<string, unknown> }) {
    return (await this.pool.query(`INSERT INTO templates (id, user_id, name, data) VALUES ($1, $2, $3, $4) RETURNING id, name, data, created_at, updated_at`, [crypto.randomUUID(), userId, input.name, json(input.data)])).rows[0];
  }

  // ---------------------------------------------------------------- admin

  async adminOverview() {
    const result = await this.pool.query(`SELECT
      (SELECT COUNT(*) FROM users WHERE email IS NOT NULL) AS users,
      (SELECT COUNT(*) FROM users WHERE last_login_at > NOW() - INTERVAL '30 days') AS active_users_30d,
      (SELECT COUNT(*) FROM projects) AS projects,
      (SELECT COUNT(*) FROM render_jobs WHERE state IN ${ACTIVE_STATES_SQL}) AS active_jobs,
      (SELECT COUNT(*) FROM render_jobs WHERE state = 'FAILED' AND updated_at > NOW() - INTERVAL '7 days') AS failed_jobs_7d,
      (SELECT COUNT(*) FROM render_jobs WHERE state = 'COMPLETED' AND updated_at > NOW() - INTERVAL '7 days') AS completed_jobs_7d,
      (SELECT COALESCE(SUM(size_bytes), 0) FROM exports) AS export_bytes,
      (SELECT COUNT(*) FROM api_usage WHERE created_at >= date_trunc('month', NOW())) AS ai_calls_month,
      (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - created_at))), 0) FROM render_jobs WHERE kind = 'render' AND state = 'COMPLETED' AND completed_at > NOW() - INTERVAL '7 days') AS avg_render_seconds`);
    return Object.fromEntries(Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)]));
  }

  async adminListJobs(limit: number, state?: string) {
    const result = await this.pool.query(
      `SELECT j.*, u.email AS user_email, p.name AS project_name FROM render_jobs j
       LEFT JOIN users u ON u.id = j.user_id LEFT JOIN projects p ON p.id = j.project_id
       WHERE ($2::text IS NULL OR j.state = $2) ORDER BY j.updated_at DESC LIMIT $1`,
      [limit, state ?? null],
    );
    return result.rows.map((row) => ({ ...mapJob(row), userEmail: row.user_email ?? null, projectName: row.project_name ?? null }));
  }

  async adminListUsers(limit: number, search?: string) {
    const result = await this.pool.query(
      `SELECT u.id, u.email, u.role, u.suspended_at, u.created_at, u.last_login_at, COALESCE(s.plan, 'FREE') AS plan,
        (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS projects,
        (SELECT COALESCE(SUM(units), 0) FROM usage_records r WHERE r.user_id = u.id AND r.kind = 'processing_credit' AND r.created_at >= date_trunc('month', NOW())) AS credits_used
       FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id
       WHERE u.email IS NOT NULL AND ($2::text IS NULL OR u.email ILIKE '%' || $2 || '%')
       ORDER BY u.created_at DESC LIMIT $1`,
      [limit, search ?? null],
    );
    return result.rows.map((row) => ({
      id: String(row.id), email: String(row.email), role: row.role, plan: row.plan, suspended: row.suspended_at !== null,
      createdAt: iso(row.created_at), lastLoginAt: row.last_login_at ? iso(row.last_login_at) : null,
      projects: Number(row.projects), creditsUsed: Number(row.credits_used),
    }));
  }

  async adminSetPlan(userId: string, plan: PlanCode) {
    await this.pool.query(
      `INSERT INTO subscriptions (user_id, plan, status, period_start) VALUES ($1, $2, 'active', NOW())
       ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan, status = 'active', period_start = NOW()`,
      [userId, plan],
    );
  }

  async adminSetSuspended(userId: string, suspended: boolean) {
    await this.pool.query(`UPDATE users SET suspended_at = CASE WHEN $2 THEN NOW() ELSE NULL END WHERE id = $1`, [userId, suspended]);
    if (suspended) await this.revokeUserSessions(userId);
  }

  async adminResetUsage(userId: string) {
    await this.pool.query(`DELETE FROM usage_records WHERE user_id = $1 AND kind = 'processing_credit' AND created_at >= date_trunc('month', NOW())`, [userId]);
  }
}

// ---------------------------------------------------------------- migrations

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

/** Applies pending SQL migrations in filename order under a Postgres advisory lock (safe with several replicas). */
export async function runMigrations(pool: pg.Pool, log: (message: string) => void = () => undefined): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(72617001)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const done = new Set((await client.query(`SELECT name FROM schema_migrations`)).rows.map((row) => String(row.name)));
    const files = (await fs.readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
      applied.push(file);
      log(`applied migration ${file}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(72617001)').catch(() => undefined);
    client.release();
  }
  return applied;
}
