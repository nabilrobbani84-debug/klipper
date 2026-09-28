import crypto from 'node:crypto';
import crypto from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { AppConfig } from './config.js';
import { AppError } from './errors.js';
import type { ClipCandidate, JobRecord, JobState, MediaMetadata, ProjectRecord, TranscriptDocument } from './types.js';

export interface ProjectRepository {
  health(): Promise<void>;
  createProject(input: { userId: string; sourceUrl: string; sourceVideoId: string }): Promise<{ project: ProjectRecord; job: JobRecord }>;
  listProjects(userId: string): Promise<ProjectRecord[]>;
  getProject(userId: string, projectId: string): Promise<ProjectRecord | null>;
  getJob(userId: string, jobId: string): Promise<JobRecord | null>;
  isJobCancelled(jobId: string): Promise<boolean>;
  updateJob(jobId: string, update: { state?: JobState; progress?: number; message?: string; errorCode?: string | null }): Promise<void>;
  updateProjectMetadata(projectId: string, metadata: MediaMetadata): Promise<void>;
  updateProjectTranscript(projectId: string, transcript: TranscriptDocument): Promise<void>;
  saveClips(projectId: string, clips: ClipCandidate[]): Promise<void>;
  markProjectFailed(projectId: string): Promise<void>;
  saveExport(input: { userId: string; projectId: string; clipId: string; storageKey: string; contentType: string; sizeBytes: number }): Promise<void>;
  createRenderJob(input: { userId: string; projectId: string; clipId: string; metadata: Record<string, unknown> }): Promise<JobRecord>;
}

function mapJob(row: Record<string, unknown>): JobRecord {
  return {
    id: String(row.id), userId: String(row.user_id), projectId: String(row.project_id), kind: row.kind as JobRecord['kind'],
    state: row.state as JobState, progress: Number(row.progress), message: String(row.message ?? ''),
    errorCode: row.error_code ? String(row.error_code) : null,
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

  async createProject(input: { userId: string; sourceUrl: string; sourceVideoId: string }) {
    const client = await this.pool.connect();
    const projectId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [input.userId]);
      const projectResult = await client.query(`
        INSERT INTO projects (id, user_id, name, source_url, source_video_id, status)
        VALUES ($1, $2, $3, $4, $5, 'PROCESSING') RETURNING *`,
        [projectId, input.userId, `YouTube project ${input.sourceVideoId}`, input.sourceUrl, input.sourceVideoId]);
      await client.query(`INSERT INTO render_jobs (id, user_id, project_id, kind, state, progress, message, metadata)
        VALUES ($1, $2, $3, 'analysis', 'QUEUED', 0, 'Waiting for worker', '{}'::jsonb)`, [jobId, input.userId, projectId]);
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

  async markProjectFailed(projectId: string) {
    await this.pool.query(`UPDATE projects SET status = 'FAILED', updated_at = NOW() WHERE id = $1`, [projectId]);
  }

  async saveExport(input: { userId: string; projectId: string; clipId: string; storageKey: string; contentType: string; sizeBytes: number }) {
    await this.pool.query(`INSERT INTO exports (id, user_id, project_id, clip_id, storage_key, content_type, size_bytes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`, [crypto.randomUUID(), input.userId, input.projectId, input.clipId, input.storageKey, input.contentType, input.sizeBytes]);
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
