import { AppError } from '../shared/errors.js';
import { getPlanEntitlements, type PlanCode, type PlanEntitlements } from '../shared/plans.js';
import {
  ACTIVE_JOB_STATES,
  type AudioChunk,
  type AuthenticatedUser,
  type ClipCandidate,
  type ClipEditorState,
  type JobKind,
  type JobState,
  type MediaMetadata,
  type UserRole,
} from '../shared/types.js';

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

export interface ProjectRow {
  id: string;
  userId: string;
  name: string;
  sourceUrl: string;
  sourceVideoId: string;
  status: 'PROCESSING' | 'READY' | 'FAILED' | 'ARCHIVED';
  metadata: MediaMetadata | null;
  sourceKey: string | null;
  transcriptKey: string | null;
  audioChunks: AudioChunk[];
  clips: ClipCandidate[];
  latestJobId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobRecord {
  id: string;
  userId: string;
  projectId: string;
  kind: JobKind;
  state: JobState;
  progress: number;
  message: string;
  errorCode: string | null;
  metadata: Record<string, unknown>;
  containerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportRow {
  id: string;
  userId: string;
  projectId: string;
  clipId: string;
  jobId: string | null;
  clipTitle: string;
  projectName: string;
  thumbnailUrl: string | null;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  settings: Record<string, unknown>;
  createdAt: string;
}

export interface UsageSummary {
  plan: PlanEntitlements;
  creditsUsed: number;
  creditsRemaining: number;
  storageBytes: number;
  activeJobs: number;
}

const ACTIVE_SQL = `(${ACTIVE_JOB_STATES.map((state) => `'${state}'`).join(',')})`;
const iso = (value: unknown) => new Date(Number(value)).toISOString();
const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string' || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};
export const uuid = () => crypto.randomUUID();

/** Start of the current UTC month in epoch ms (credit period). */
export function monthStart(now = Date.now()): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
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

function mapJob(row: Row): JobRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    projectId: String(row.project_id),
    kind: row.kind as JobKind,
    state: row.state as JobState,
    progress: Number(row.progress ?? 0),
    message: String(row.message ?? ''),
    errorCode: row.error_code ? String(row.error_code) : null,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    containerId: row.container_id ? String(row.container_id) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapProject(row: Row, clips: ClipCandidate[]): ProjectRow {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    sourceUrl: String(row.source_url),
    sourceVideoId: String(row.source_video_id),
    status: row.status as ProjectRow['status'],
    metadata: parseJson<MediaMetadata | null>(row.metadata, null),
    sourceKey: row.source_key ? String(row.source_key) : null,
    transcriptKey: row.transcript_key ? String(row.transcript_key) : null,
    audioChunks: parseJson<AudioChunk[]>(row.audio_chunks, []),
    clips,
    latestJobId: row.latest_job_id ? String(row.latest_job_id) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapExport(row: Row): ExportRow {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    projectId: String(row.project_id),
    clipId: String(row.clip_id),
    jobId: row.job_id ? String(row.job_id) : null,
    clipTitle: String(row.clip_title ?? 'Clip'),
    projectName: String(row.project_name ?? 'Project'),
    thumbnailUrl: (row.thumbnail_url as string | null) ?? null,
    storageKey: String(row.storage_key),
    contentType: String(row.content_type),
    sizeBytes: Number(row.size_bytes),
    settings: parseJson<Record<string, unknown>>(row.settings, {}),
    createdAt: iso(row.created_at),
  };
}

const PROJECT_SELECT = `SELECT p.*, (SELECT j.id FROM jobs j WHERE j.project_id = p.id AND j.kind = 'analysis' ORDER BY j.created_at DESC LIMIT 1) AS latest_job_id FROM projects p`;
const EXPORT_SELECT = `SELECT e.*, json_extract(c.data, '$.title') AS clip_title, p.name AS project_name, json_extract(p.metadata, '$.thumbnailUrl') AS thumbnail_url
  FROM exports e LEFT JOIN clips c ON c.id = e.clip_id LEFT JOIN projects p ON p.id = e.project_id`;

export class Repository {
  constructor(private readonly db: D1Database) {}

  private async all(sql: string, ...params: unknown[]): Promise<Row[]> {
    const result = await this.db.prepare(sql).bind(...params).all<Row>();
    return result.results ?? [];
  }

  private async first(sql: string, ...params: unknown[]): Promise<Row | null> {
    return (await this.db.prepare(sql).bind(...params).first<Row>()) ?? null;
  }

  private async run(sql: string, ...params: unknown[]): Promise<number> {
    const result = await this.db.prepare(sql).bind(...params).run();
    return result.meta.changes ?? 0;
  }

  async health() {
    await this.first('SELECT 1 AS ok');
  }

  // ---------------------------------------------------------------- users & sessions

  async registerUser(input: { email: string; passwordHash: string | null; role: UserRole }): Promise<UserRecord> {
    const id = uuid();
    try {
      await this.run(`INSERT INTO users (id, email, password_hash, role, plan, created_at) VALUES (?, ?, ?, ?, 'FREE', ?)`, id, input.email.toLowerCase(), input.passwordHash, input.role, Date.now());
    } catch (error) {
      if (String((error as Error).message).includes('UNIQUE')) throw new AppError('EMAIL_ALREADY_REGISTERED', 'An account with this email already exists.', 409);
      throw error;
    }
    return (await this.getUser(id))!;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const row = await this.first(`SELECT * FROM users WHERE email = ?`, email.toLowerCase());
    return row ? mapUser(row) : null;
  }

  async getUser(userId: string): Promise<UserRecord | null> {
    const row = await this.first(`SELECT * FROM users WHERE id = ?`, userId);
    return row ? mapUser(row) : null;
  }

  async setUserRole(userId: string, role: UserRole) {
    await this.run(`UPDATE users SET role = ? WHERE id = ?`, role, userId);
  }

  /** Finds a user by email or provisions one (federated / Google sign-in). */
  async findOrCreateFederatedUser(email: string, role: UserRole): Promise<UserRecord> {
    const existing = await this.findUserByEmail(email);
    if (existing) {
      if (role === 'admin' && existing.role !== 'admin') {
        await this.setUserRole(existing.id, 'admin');
        existing.role = 'admin';
      }
      return existing;
    }
    return this.registerUser({ email, passwordHash: null, role });
  }

  async createSession(userId: string, tokenHash: string, expiresAt: number) {
    const now = Date.now();
    await this.db.batch([
      this.db.prepare(`INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`).bind(uuid(), userId, tokenHash, expiresAt, now),
      this.db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).bind(now, userId),
    ]);
  }

  async findActiveSession(tokenHash: string): Promise<AuthenticatedUser | null> {
    const row = await this.first(
      `SELECT u.id, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.suspended_at IS NULL`,
      tokenHash, Date.now(),
    );
    return row ? { id: String(row.id), email: String(row.email), role: row.role as UserRole } : null;
  }

  async revokeSession(tokenHash: string) {
    await this.run(`UPDATE sessions SET revoked_at = ? WHERE token_hash = ?`, Date.now(), tokenHash);
  }

  async deleteUser(userId: string) {
    await this.run(`DELETE FROM users WHERE id = ?`, userId);
  }

  async audit(userId: string | null, action: string, resourceType: string | null, resourceId: string | null, metadata: Record<string, unknown> = {}) {
    await this.run(`INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)`, userId, action, resourceType, resourceId, JSON.stringify(metadata), Date.now()).catch(() => undefined);
  }

  // ---------------------------------------------------------------- plans, credits, usage

  async getPlan(userId: string): Promise<PlanEntitlements> {
    const row = await this.first(`SELECT plan FROM users WHERE id = ?`, userId);
    return getPlanEntitlements(row?.plan as string | undefined);
  }

  async getUsage(userId: string): Promise<UsageSummary> {
    const plan = await this.getPlan(userId);
    const row = await this.first(
      `SELECT
        (SELECT COALESCE(SUM(units), 0) FROM usage_records WHERE user_id = ?1 AND kind = 'processing_credit' AND created_at >= ?2) AS credits_used,
        (SELECT COALESCE(SUM(size_bytes), 0) FROM exports WHERE user_id = ?1) AS storage_bytes,
        (SELECT COUNT(*) FROM jobs WHERE user_id = ?1 AND state IN ${ACTIVE_SQL}) AS active_jobs`,
      userId, monthStart(),
    );
    const creditsUsed = Math.max(0, Number(row?.credits_used ?? 0));
    return { plan, creditsUsed, creditsRemaining: Math.max(0, plan.monthlyCredits - creditsUsed), storageBytes: Number(row?.storage_bytes ?? 0), activeJobs: Number(row?.active_jobs ?? 0) };
  }

  /**
   * Atomically checks credit, concurrency and storage limits and reserves one processing credit.
   * A single conditional INSERT runs as one SQLite statement, so parallel requests cannot overspend.
   */
  async reserveCredit(userId: string, ref: string): Promise<PlanEntitlements> {
    const plan = await this.getPlan(userId);
    const changes = await this.run(
      `INSERT INTO usage_records (user_id, kind, units, ref, created_at)
       SELECT ?1, 'processing_credit', 1, ?2, ?3
       WHERE (SELECT COALESCE(SUM(units), 0) FROM usage_records WHERE user_id = ?1 AND kind = 'processing_credit' AND created_at >= ?4) < ?5
         AND (SELECT COUNT(*) FROM jobs WHERE user_id = ?1 AND state IN ${ACTIVE_SQL}) < ?6
         AND (SELECT COALESCE(SUM(size_bytes), 0) FROM exports WHERE user_id = ?1) < ?7`,
      userId, ref, Date.now(), monthStart(), plan.monthlyCredits, plan.concurrentJobs, plan.storageLimitBytes,
    );
    if (changes === 1) return plan;
    const usage = await this.getUsage(userId);
    if (usage.creditsRemaining <= 0) throw new AppError('CREDIT_LIMIT_REACHED', `Your ${plan.code} plan's monthly processing credits are used up.`, 402);
    if (usage.activeJobs >= plan.concurrentJobs) throw new AppError('CONCURRENCY_LIMIT', `Your ${plan.code} plan allows ${plan.concurrentJobs} job(s) at a time. Wait for the current job to finish.`, 429);
    throw new AppError('STORAGE_LIMIT_REACHED', 'Your storage limit is reached. Delete old exports to continue.', 402);
  }

  /** Returns a credit for a failed/cancelled analysis. Idempotent per job via a unique ref. */
  async refundCredit(userId: string, jobId: string) {
    await this.run(`INSERT OR IGNORE INTO usage_records (user_id, kind, units, ref, created_at) VALUES (?, 'processing_credit', -1, ?, ?)`, userId, `refund:${jobId}`, Date.now());
  }

  async countActiveJobs(userId: string, kind: JobKind): Promise<number> {
    const row = await this.first(`SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND kind = ? AND state IN ${ACTIVE_SQL}`, userId, kind);
    return Number(row?.n ?? 0);
  }

  async recordApiUsage(userId: string, provider: string, metadata: Record<string, unknown>) {
    await this.run(`INSERT INTO api_usage (user_id, provider, metadata, created_at) VALUES (?, ?, ?, ?)`, userId, provider, JSON.stringify(metadata), Date.now()).catch(() => undefined);
  }

  // ---------------------------------------------------------------- projects & clips

  private async clipsFor(projectIds: string[]): Promise<Map<string, ClipCandidate[]>> {
    const map = new Map<string, ClipCandidate[]>();
    if (projectIds.length === 0) return map;
    for (let i = 0; i < projectIds.length; i += 50) {
      const batch = projectIds.slice(i, i + 50);
      const rows = await this.all(`SELECT project_id, data FROM clips WHERE project_id IN (${batch.map(() => '?').join(',')}) ORDER BY start_seconds`, ...batch);
      for (const row of rows) {
        const list = map.get(String(row.project_id)) ?? [];
        list.push(parseJson<ClipCandidate>(row.data, null as unknown as ClipCandidate));
        map.set(String(row.project_id), list);
      }
    }
    return map;
  }

  async createProject(input: { userId: string; sourceUrl: string; sourceVideoId: string; jobMetadata: Record<string, unknown> }): Promise<{ projectId: string; jobId: string }> {
    const projectId = uuid();
    const jobId = uuid();
    const now = Date.now();
    await this.db.batch([
      this.db.prepare(`INSERT INTO projects (id, user_id, name, source_url, source_video_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'PROCESSING', ?, ?)`)
        .bind(projectId, input.userId, `YouTube video ${input.sourceVideoId}`, input.sourceUrl, input.sourceVideoId, now, now),
      this.db.prepare(`INSERT INTO jobs (id, user_id, project_id, kind, state, progress, message, metadata, created_at, updated_at) VALUES (?, ?, ?, 'analysis', 'QUEUED', 0, 'Waiting for an available worker…', ?, ?, ?)`)
        .bind(jobId, input.userId, projectId, JSON.stringify(input.jobMetadata), now, now),
    ]);
    return { projectId, jobId };
  }

  async listProjects(userId: string): Promise<ProjectRow[]> {
    const rows = await this.all(`${PROJECT_SELECT} WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT 200`, userId);
    const clips = await this.clipsFor(rows.map((row) => String(row.id)));
    return rows.map((row) => mapProject(row, clips.get(String(row.id)) ?? []));
  }

  async getProject(userId: string, projectId: string): Promise<ProjectRow | null> {
    const row = await this.first(`${PROJECT_SELECT} WHERE p.user_id = ? AND p.id = ?`, userId, projectId);
    if (!row) return null;
    const clips = await this.clipsFor([projectId]);
    return mapProject(row, clips.get(projectId) ?? []);
  }

  async getProjectById(projectId: string): Promise<ProjectRow | null> {
    const row = await this.first(`${PROJECT_SELECT} WHERE p.id = ?`, projectId);
    if (!row) return null;
    const clips = await this.clipsFor([projectId]);
    return mapProject(row, clips.get(projectId) ?? []);
  }

  async renameProject(userId: string, projectId: string, name: string): Promise<boolean> {
    return (await this.run(`UPDATE projects SET name = ?, updated_at = ? WHERE user_id = ? AND id = ?`, name, Date.now(), userId, projectId)) > 0;
  }

  async deleteProject(userId: string, projectId: string): Promise<boolean> {
    return (await this.run(`DELETE FROM projects WHERE user_id = ? AND id = ?`, userId, projectId)) > 0;
  }

  /** Copies project, clips and pointers to the shared source/transcript objects (exports are not copied). */
  async duplicateProject(userId: string, projectId: string): Promise<string | null> {
    const original = await this.getProject(userId, projectId);
    if (!original) return null;
    const id = uuid();
    const now = Date.now();
    const statements = [
      this.db.prepare(`INSERT INTO projects (id, user_id, name, source_url, source_video_id, status, metadata, source_key, transcript_key, created_at, updated_at)
        SELECT ?, user_id, name || ' (Copy)', source_url, source_video_id, status, metadata, source_key, transcript_key, ?, ? FROM projects WHERE user_id = ? AND id = ?`).bind(id, now, now, userId, projectId),
      ...original.clips.map((clip) => {
        const copy = { ...clip, id: `clip-${uuid()}` };
        return this.db.prepare(`INSERT INTO clips (id, project_id, start_seconds, end_seconds, score, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(copy.id, id, copy.start, copy.end, copy.score, JSON.stringify(copy), now);
      }),
    ];
    await this.db.batch(statements);
    return id;
  }

  async countKeyReferences(column: 'source_key' | 'transcript_key', key: string): Promise<number> {
    const row = await this.first(`SELECT COUNT(*) AS n FROM projects WHERE ${column} = ?`, key);
    return Number(row?.n ?? 0);
  }

  async saveAcquired(projectId: string, input: { metadata: MediaMetadata; sourceKey: string; chunks: AudioChunk[] }) {
    await this.run(`UPDATE projects SET name = ?, metadata = ?, source_key = ?, audio_chunks = ?, updated_at = ? WHERE id = ?`,
      input.metadata.title, JSON.stringify(input.metadata), input.sourceKey, JSON.stringify(input.chunks), Date.now(), projectId);
  }

  async saveTranscriptKey(projectId: string, key: string) {
    await this.run(`UPDATE projects SET transcript_key = ?, audio_chunks = NULL, updated_at = ? WHERE id = ?`, key, Date.now(), projectId);
  }

  async saveClips(projectId: string, clips: ClipCandidate[]) {
    const now = Date.now();
    await this.db.batch([
      this.db.prepare(`DELETE FROM clips WHERE project_id = ?`).bind(projectId),
      ...clips.map((clip) => this.db.prepare(`INSERT INTO clips (id, project_id, start_seconds, end_seconds, score, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(clip.id, projectId, clip.start, clip.end, clip.score, JSON.stringify(clip), now)),
      this.db.prepare(`UPDATE projects SET status = 'READY', updated_at = ? WHERE id = ?`).bind(now, projectId),
    ]);
  }

  async setProjectStatus(projectId: string, status: ProjectRow['status']) {
    await this.run(`UPDATE projects SET status = ?, updated_at = ? WHERE id = ?`, status, Date.now(), projectId);
  }

  /** Persists editor changes (trim, captions, reframe, audio) for a clip owned by the user. */
  async updateClip(userId: string, projectId: string, clipId: string, patch: { start?: number; end?: number; title?: string; editor?: Partial<ClipEditorState> }): Promise<ClipCandidate | null> {
    const row = await this.first(
      `SELECT c.data, json_extract(p.metadata, '$.durationSeconds') AS duration FROM clips c JOIN projects p ON p.id = c.project_id WHERE p.user_id = ? AND p.id = ? AND c.id = ?`,
      userId, projectId, clipId,
    );
    if (!row) return null;
    const current = parseJson<ClipCandidate>(row.data, null as unknown as ClipCandidate);
    const videoDuration = row.duration ? Number(row.duration) : Number.POSITIVE_INFINITY;
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
    await this.db.batch([
      this.db.prepare(`UPDATE clips SET data = ?, start_seconds = ?, end_seconds = ? WHERE id = ?`).bind(JSON.stringify(updated), start, end, clipId),
      this.db.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).bind(Date.now(), projectId),
    ]);
    return updated;
  }

  // ---------------------------------------------------------------- jobs

  async getJob(userId: string, jobId: string): Promise<JobRecord | null> {
    const row = await this.first(`SELECT * FROM jobs WHERE user_id = ? AND id = ?`, userId, jobId);
    return row ? mapJob(row) : null;
  }

  async getJobById(jobId: string): Promise<JobRecord | null> {
    const row = await this.first(`SELECT * FROM jobs WHERE id = ?`, jobId);
    return row ? mapJob(row) : null;
  }

  async getJobByContainer(containerId: string): Promise<JobRecord | null> {
    const row = await this.first(`SELECT * FROM jobs WHERE container_id = ? ORDER BY updated_at DESC LIMIT 1`, containerId);
    return row ? mapJob(row) : null;
  }

  async listJobs(userId: string, limit = 50): Promise<JobRecord[]> {
    return (await this.all(`SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`, userId, limit)).map(mapJob);
  }

  async createRenderJob(input: { userId: string; projectId: string; clipId: string; metadata: Record<string, unknown> }): Promise<JobRecord> {
    const id = uuid();
    const now = Date.now();
    await this.run(`INSERT INTO jobs (id, user_id, project_id, kind, state, progress, message, metadata, created_at, updated_at) VALUES (?, ?, ?, 'render', 'QUEUED', 0, 'Waiting for an available worker…', ?, ?, ?)`,
      id, input.userId, input.projectId, JSON.stringify({ ...input.metadata, clipId: input.clipId }), now, now);
    return (await this.getJobById(id))!;
  }

  async setJobContainer(jobId: string, containerId: string) {
    await this.run(`UPDATE jobs SET container_id = ?, updated_at = ? WHERE id = ?`, containerId, Date.now(), jobId);
  }

  /** Never overwrites a terminal state. Returns false when the job is no longer active (e.g. cancelled). */
  async updateJobProgress(jobId: string, state: JobState, progress: number, message: string): Promise<boolean> {
    const changes = await this.run(
      `UPDATE jobs SET state = ?, progress = ?, message = ?, error_code = NULL, updated_at = ? WHERE id = ? AND state NOT IN ('COMPLETED','FAILED','CANCELLED')`,
      state, Math.round(Math.min(100, Math.max(0, progress))), message.slice(0, 500), Date.now(), jobId,
    );
    return changes > 0;
  }

  async finishJob(jobId: string, state: 'COMPLETED' | 'FAILED', message: string, errorCode: string | null, extraMetadata: Record<string, unknown> = {}): Promise<boolean> {
    const now = Date.now();
    const changes = await this.run(
      `UPDATE jobs SET state = ?, progress = CASE WHEN ? = 'COMPLETED' THEN 100 ELSE progress END, message = ?, error_code = ?,
         metadata = json_patch(metadata, ?), updated_at = ?, completed_at = ?
       WHERE id = ? AND state NOT IN ('COMPLETED','FAILED','CANCELLED')`,
      state, state, message.slice(0, 500), errorCode, JSON.stringify(extraMetadata), now, now, jobId,
    );
    return changes > 0;
  }

  async isJobActive(jobId: string): Promise<boolean> {
    const row = await this.first(`SELECT state FROM jobs WHERE id = ?`, jobId);
    return Boolean(row && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(String(row.state)));
  }

  async requestCancel(jobId: string): Promise<boolean> {
    const now = Date.now();
    return (await this.run(`UPDATE jobs SET state = 'CANCELLED', message = 'Cancelled by user.', updated_at = ?, completed_at = ? WHERE id = ? AND state IN ${ACTIVE_SQL}`, now, now, jobId)) > 0;
  }

  async resetJobForRetry(jobId: string): Promise<boolean> {
    return (await this.run(`UPDATE jobs SET state = 'QUEUED', progress = 0, message = 'Retry queued…', error_code = NULL, container_id = NULL, updated_at = ?, completed_at = NULL WHERE id = ? AND state IN ('FAILED','CANCELLED')`, Date.now(), jobId)) > 0;
  }

  async stalledJobs(olderThan: number): Promise<JobRecord[]> {
    return (await this.all(`SELECT * FROM jobs WHERE state IN ${ACTIVE_SQL} AND updated_at < ? LIMIT 200`, olderThan)).map(mapJob);
  }

  // ---------------------------------------------------------------- exports

  async saveExport(input: { userId: string; projectId: string; clipId: string; jobId: string; storageKey: string; contentType: string; sizeBytes: number; settings: Record<string, unknown> }): Promise<string> {
    const id = uuid();
    await this.run(`INSERT INTO exports (id, user_id, project_id, clip_id, job_id, storage_key, content_type, size_bytes, settings, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, input.userId, input.projectId, input.clipId, input.jobId, input.storageKey, input.contentType, input.sizeBytes, JSON.stringify(input.settings), Date.now());
    return id;
  }

  async listExports(userId: string): Promise<ExportRow[]> {
    return (await this.all(`${EXPORT_SELECT} WHERE e.user_id = ? ORDER BY e.created_at DESC LIMIT 500`, userId)).map(mapExport);
  }

  async listProjectExports(userId: string, projectId: string): Promise<ExportRow[]> {
    return (await this.all(`${EXPORT_SELECT} WHERE e.user_id = ? AND e.project_id = ?`, userId, projectId)).map(mapExport);
  }

  async getExportByJob(userId: string, jobId: string): Promise<ExportRow | null> {
    const row = await this.first(`${EXPORT_SELECT} WHERE e.user_id = ? AND e.job_id = ?`, userId, jobId);
    return row ? mapExport(row) : null;
  }

  async deleteExport(userId: string, exportId: string): Promise<string | null> {
    const row = await this.first(`SELECT storage_key FROM exports WHERE user_id = ? AND id = ?`, userId, exportId);
    if (!row) return null;
    await this.run(`DELETE FROM exports WHERE user_id = ? AND id = ?`, userId, exportId);
    return String(row.storage_key);
  }

  async expiredExports(olderThan: number): Promise<Array<{ id: string; key: string }>> {
    return (await this.all(`SELECT id, storage_key FROM exports WHERE created_at < ? LIMIT 500`, olderThan)).map((row) => ({ id: String(row.id), key: String(row.storage_key) }));
  }

  async deleteExportById(exportId: string) {
    await this.run(`DELETE FROM exports WHERE id = ?`, exportId);
  }

  /** Source videos whose projects have all been idle past the retention window. */
  async expiredSources(olderThan: number): Promise<string[]> {
    return (await this.all(`SELECT source_key FROM projects WHERE source_key IS NOT NULL GROUP BY source_key HAVING MAX(updated_at) < ? LIMIT 500`, olderThan)).map((row) => String(row.source_key));
  }

  async clearSourceKey(key: string) {
    await this.run(`UPDATE projects SET source_key = NULL WHERE source_key = ?`, key);
  }

  async pruneSessions(now = Date.now()) {
    const week = 7 * 86_400_000;
    await this.run(`DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`, now - week, now - week);
  }

  // ---------------------------------------------------------------- brand kits & templates

  async listBrandKits(userId: string) {
    return (await this.all(`SELECT * FROM brand_kits WHERE user_id = ? ORDER BY is_default DESC, updated_at DESC`, userId))
      .map((row) => ({ id: row.id, name: row.name, data: parseJson(row.data, {}), isDefault: Boolean(row.is_default), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }));
  }

  async createBrandKit(userId: string, input: { name: string; data: Record<string, unknown>; isDefault: boolean }) {
    const id = uuid();
    const now = Date.now();
    await this.db.batch([
      ...(input.isDefault ? [this.db.prepare(`UPDATE brand_kits SET is_default = 0 WHERE user_id = ?`).bind(userId)] : []),
      this.db.prepare(`INSERT INTO brand_kits (id, user_id, name, data, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, userId, input.name, JSON.stringify(input.data), input.isDefault ? 1 : 0, now, now),
    ]);
    return { id, name: input.name, data: input.data, isDefault: input.isDefault, createdAt: iso(now), updatedAt: iso(now) };
  }

  async listTemplates(userId: string) {
    return (await this.all(`SELECT * FROM templates WHERE user_id = ? OR user_id IS NULL ORDER BY updated_at DESC`, userId))
      .map((row) => ({ id: row.id, name: row.name, data: parseJson(row.data, {}), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }));
  }

  async createTemplate(userId: string, input: { name: string; data: Record<string, unknown> }) {
    const id = uuid();
    const now = Date.now();
    await this.run(`INSERT INTO templates (id, user_id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, id, userId, input.name, JSON.stringify(input.data), now, now);
    return { id, name: input.name, data: input.data, createdAt: iso(now), updatedAt: iso(now) };
  }

  // ---------------------------------------------------------------- admin

  async adminOverview() {
    const now = Date.now();
    const week = now - 7 * 86_400_000;
    const row = await this.first(`SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM users WHERE last_login_at > ?1) AS active_users_30d,
      (SELECT COUNT(*) FROM projects) AS projects,
      (SELECT COUNT(*) FROM jobs WHERE state IN ${ACTIVE_SQL}) AS active_jobs,
      (SELECT COUNT(*) FROM jobs WHERE state = 'FAILED' AND updated_at > ?2) AS failed_jobs_7d,
      (SELECT COUNT(*) FROM jobs WHERE state = 'COMPLETED' AND updated_at > ?2) AS completed_jobs_7d,
      (SELECT COALESCE(SUM(size_bytes), 0) FROM exports) AS export_bytes,
      (SELECT COUNT(*) FROM api_usage WHERE created_at >= ?3) AS ai_calls_month,
      (SELECT COALESCE(AVG(completed_at - created_at), 0) / 1000.0 FROM jobs WHERE kind = 'render' AND state = 'COMPLETED' AND completed_at > ?2) AS avg_render_seconds,
      (SELECT COUNT(*) FROM jobs WHERE state IN ('DOWNLOADING','EXTRACTING_AUDIO','REFRAMING','RENDERING','UPLOADING')) AS containers_busy`,
      now - 30 * 86_400_000, week, monthStart(now));
    const states = await this.all(`SELECT state, COUNT(*) AS n FROM jobs WHERE state IN ${ACTIVE_SQL} GROUP BY state`);
    const stats = Object.fromEntries(Object.entries(row ?? {}).map(([key, value]) => [key, Number(value)]));
    return { ...stats, queue: Object.fromEntries(states.map((item) => [String(item.state), Number(item.n)])), workersOnline: stats.containers_busy ?? 0 };
  }

  async adminListJobs(limit: number, state?: string) {
    const rows = await this.all(
      `SELECT j.*, u.email AS user_email, p.name AS project_name FROM jobs j LEFT JOIN users u ON u.id = j.user_id LEFT JOIN projects p ON p.id = j.project_id
       WHERE (?1 IS NULL OR j.state = ?1) ORDER BY j.updated_at DESC LIMIT ?2`,
      state ?? null, limit,
    );
    return rows.map((row) => ({ ...mapJob(row), userEmail: (row.user_email as string | null) ?? null, projectName: (row.project_name as string | null) ?? null }));
  }

  async adminListUsers(limit: number, search?: string) {
    const rows = await this.all(
      `SELECT u.*, (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS projects,
        (SELECT COALESCE(SUM(units), 0) FROM usage_records r WHERE r.user_id = u.id AND r.kind = 'processing_credit' AND r.created_at >= ?1) AS credits_used
       FROM users u WHERE (?2 IS NULL OR u.email LIKE '%' || ?2 || '%') ORDER BY u.created_at DESC LIMIT ?3`,
      monthStart(), search ?? null, limit,
    );
    return rows.map((row) => ({
      id: String(row.id), email: String(row.email), role: row.role as UserRole, plan: String(row.plan), suspended: row.suspended_at !== null,
      createdAt: iso(row.created_at), lastLoginAt: row.last_login_at ? iso(row.last_login_at) : null,
      projects: Number(row.projects), creditsUsed: Number(row.credits_used),
    }));
  }

  async adminSetPlan(userId: string, plan: PlanCode) {
    await this.run(`UPDATE users SET plan = ? WHERE id = ?`, plan, userId);
  }

  async adminSetSuspended(userId: string, suspended: boolean) {
    const now = Date.now();
    await this.db.batch([
      this.db.prepare(`UPDATE users SET suspended_at = ? WHERE id = ?`).bind(suspended ? now : null, userId),
      ...(suspended ? [this.db.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).bind(now, userId)] : []),
    ]);
  }

  async adminResetUsage(userId: string) {
    await this.run(`DELETE FROM usage_records WHERE user_id = ? AND kind = 'processing_credit' AND created_at >= ?`, userId, monthStart());
  }
}
