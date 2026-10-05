import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { AppError, notFound } from '../shared/errors.js';
import { capResolution, isPlanCode, PLAN_ENTITLEMENTS } from '../shared/plans.js';
import { segmentsInWindow } from '../shared/transcript.js';
import { TERMINAL_JOB_STATES, type AuthenticatedUser, type ClipEditorState } from '../shared/types.js';
import { parseYouTubeUrl } from '../shared/youtube.js';
import { verifyFirebaseIdToken } from './auth.js';
import { hashPassword, randomToken, sha256Hex, verifyPassword } from './crypto.js';
import { Repository, type ExportRow, type JobRecord, type ProjectRow } from './db.js';
import { adminEmails, boolVar, numberVar, type Env } from './env.js';
import { mediaUrl, serveMedia } from './media.js';
import { loadTranscript, logError } from './pipeline.js';

type Vars = { user: AuthenticatedUser; sessionHash?: string; requestId: string; repo: Repository };
type AppContext = Context<{ Bindings: Env; Variables: Vars }>;

// ----------------------------------------------------------------------------- validation schemas

const aspectSchema = z.enum(['9:16', '16:9', '1:1', '4:5']);
const createProjectSchema = z.object({
  youtubeUrl: z.string().trim().min(1).max(2048),
  contentGoal: z.string().max(80).optional(),
  hookType: z.string().max(80).optional(),
  preferredDuration: z.coerce.number().int().min(10).max(180).default(45),
  aspectRatio: aspectSchema.default('9:16'),
  requestedClipCount: z.coerce.number().int().min(1).max(10).default(3),
  rightsConfirmed: z.literal(true, { message: 'You must confirm you have the rights to process this video.' }),
});
const renderSchema = z.object({
  resolution: z.enum(['720p', '1080p', '1440p', '4K']).default('1080p'),
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).default(30),
  format: z.enum(['mp4', 'mov']).default('mp4'),
  codec: z.enum(['h264', 'h265']).default('h264'),
  quality: z.enum(['draft', 'standard', 'high', 'ultra']).default('standard'),
  aspectRatio: aspectSchema.optional(),
});
const color = z.string().max(40);
const clipPatchSchema = z.object({
  start: z.number().nonnegative().optional(),
  end: z.number().positive().optional(),
  title: z.string().trim().min(1).max(140).optional(),
  editor: z.object({
    aspectRatio: aspectSchema.optional(),
    captions: z.object({
      enabled: z.boolean().optional(), preset: z.string().max(40).optional(), fontFamily: z.string().max(80).optional(),
      fontSize: z.number().min(8).max(160).optional(), textColor: color.optional(), highlightColor: color.optional(), strokeColor: color.optional(),
      strokeWidth: z.number().min(0).max(20).optional(), backgroundColor: color.optional(), hasBackground: z.boolean().optional(),
      positionY: z.number().min(0).max(100).optional(), uppercase: z.boolean().optional(), karaokeEffect: z.boolean().optional(),
      maxWordsPerLine: z.number().int().min(1).max(12).optional(),
    }).optional(),
    reframing: z.object({
      mode: z.enum(['center', 'speaker', 'face', 'object', 'manual']).optional(),
      panX: z.number().min(0).max(100).optional(), panY: z.number().min(0).max(100).optional(), zoom: z.number().min(1).max(3).optional(),
    }).optional(),
    audio: z.object({
      noiseReduction: z.boolean().optional(), voiceEnhance: z.boolean().optional(), compressor: z.boolean().optional(),
      loudnessNorm: z.boolean().optional(), volume: z.number().min(0).max(300).optional(),
    }).optional(),
  }).optional(),
});
const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(10, 'Password must be at least 10 characters.').max(128),
});
const loginSchema = z.object({ email: z.string().trim().toLowerCase().email().max(320), password: z.string().min(1).max(128) });

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', result.error.issues.map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`).join('; '), 400);
  }
  return result.data;
}

async function body(c: AppContext): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

const ok = <T>(c: AppContext, data: T, status: 200 | 201 | 202 = 200) => c.json({ success: true, data, error: null, requestId: c.get('requestId') }, status);

// ----------------------------------------------------------------------------- presenters

function origin(c: AppContext): string {
  return (c.env.APP_URL || new URL(c.req.url).origin).replace(/\/$/, '');
}

async function presentProject(c: AppContext, project: ProjectRow, includeTranscript: boolean) {
  const { sourceKey, transcriptKey, audioChunks, ...rest } = project;
  void audioChunks;
  let transcript = null;
  if (includeTranscript && transcriptKey) {
    const full = await loadTranscript(c.env, transcriptKey);
    // Only ship transcript around clips — full transcripts of long videos can be several MB.
    if (full) {
      const seen = new Set<string>();
      const segments = project.clips.flatMap((clip) => segmentsInWindow(full, clip.start - 2, clip.end + 2)).filter((segment) => (seen.has(segment.id) ? false : (seen.add(segment.id), true)));
      transcript = { language: full.language, segments };
    }
  }
  return {
    ...rest,
    transcript,
    sourceMediaUrl: sourceKey && project.status === 'READY' ? await mediaUrl(c.env, origin(c), sourceKey, project.userId) : null,
  };
}

async function presentExport(c: AppContext, record: ExportRow) {
  const extension = record.contentType === 'video/quicktime' ? 'mov' : 'mp4';
  const safeTitle = record.clipTitle.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'clip';
  const { storageKey, userId, jobId, ...rest } = record;
  void jobId;
  return {
    ...rest,
    previewUrl: await mediaUrl(c.env, origin(c), storageKey, userId),
    downloadUrl: await mediaUrl(c.env, origin(c), storageKey, userId, `${safeTitle}.${extension}`),
  };
}

function presentJob(job: JobRecord) {
  const { containerId, ...rest } = job;
  void containerId;
  return rest;
}

async function deletePrefix(bucket: R2Bucket, prefix: string) {
  let cursor: string | undefined;
  do {
    const list = await bucket.list({ prefix, cursor, limit: 1000 });
    if (list.objects.length > 0) await bucket.delete(list.objects.map((object) => object.key));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
}

// ----------------------------------------------------------------------------- app

export function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: Vars }>();

  app.use('*', async (c, next) => {
    const header = c.req.header('x-request-id');
    c.set('requestId', header && /^[\w-]{8,64}$/.test(header) ? header : crypto.randomUUID());
    c.set('repo', new Repository(c.env.DB));
    await next();
    c.header('x-request-id', c.get('requestId'));
  });
  app.use('/api/*', secureHeaders({ crossOriginResourcePolicy: 'same-origin' }));

  app.onError((error, c) => {
    const appError = error instanceof AppError ? error : new AppError('INTERNAL_ERROR', 'The request could not be completed.', 500, false);
    if (appError.statusCode >= 500) logError('request failed', { requestId: c.get('requestId'), path: c.req.path, code: appError.code, detail: error instanceof Error ? error.message : String(error) });
    return c.json({ success: false, data: null, error: { code: appError.code, message: appError.expose ? appError.message : 'The request could not be completed.' }, requestId: c.get('requestId') }, appError.statusCode as 400);
  });
  app.notFound((c) => c.json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Route not found.' }, requestId: c.get('requestId') }, 404));

  const limit = (binding: 'AUTH_LIMITER' | 'API_LIMITER', keyOf: (c: AppContext) => string): MiddlewareHandler<{ Bindings: Env; Variables: Vars }> => async (c, next) => {
    const limiter = c.env[binding];
    if (limiter) {
      const { success } = await limiter.limit({ key: keyOf(c) });
      if (!success) throw new AppError('RATE_LIMITED', 'Too many requests. Please slow down.', 429);
    }
    await next();
  };
  const clientIp = (c: AppContext) => c.req.header('cf-connecting-ip') ?? 'unknown';

  // --------------------------------------------------------------- health & public
  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.get('/ready', async (c) => {
    try {
      await c.get('repo').health();
      return c.json({ status: 'ready' });
    } catch {
      return c.json({ status: 'unavailable' }, 503);
    }
  });
  app.on(['GET', 'HEAD'], '/media/:token', (c) => serveMedia(c.req.raw, c.env, c.req.param('token')));

  app.get('/api/v1/config', (c) => ok(c, {
    registrationOpen: boolVar(c.env.ALLOW_REGISTRATION, true),
    plans: Object.values(PLAN_ENTITLEMENTS),
    billingEnabled: false,
    googleAuth: Boolean(c.env.FIREBASE_PROJECT_ID),
  }));

  // --------------------------------------------------------------- auth
  const issueSession = async (c: AppContext, user: { id: string; email: string; role: 'user' | 'admin' }) => {
    const token = randomToken();
    const expiresAt = Date.now() + numberVar(c.env.SESSION_TTL_HOURS, 24 * 14) * 3600_000;
    await c.get('repo').createSession(user.id, await sha256Hex(token), expiresAt);
    return { token, expiresAt: new Date(expiresAt).toISOString(), user: { id: user.id, email: user.email, role: user.role } };
  };

  app.post('/api/v1/auth/register', limit('AUTH_LIMITER', clientIp), async (c) => {
    if (!boolVar(c.env.ALLOW_REGISTRATION, true)) throw new AppError('REGISTRATION_CLOSED', 'Registration is currently closed.', 403);
    const input = parse(credentialsSchema, await body(c));
    const repo = c.get('repo');
    const user = await repo.registerUser({ email: input.email, passwordHash: await hashPassword(input.password), role: adminEmails(c.env).has(input.email) ? 'admin' : 'user' });
    await repo.audit(user.id, 'auth.register', 'user', user.id);
    return ok(c, await issueSession(c, user), 201);
  });

  app.post('/api/v1/auth/login', limit('AUTH_LIMITER', clientIp), async (c) => {
    const input = parse(loginSchema, await body(c));
    const repo = c.get('repo');
    const user = await repo.findUserByEmail(input.email);
    // Always run the KDF so response time does not reveal whether the email exists.
    const valid = user?.passwordHash ? await verifyPassword(input.password, user.passwordHash) : (await hashPassword(input.password), false);
    if (!user || !valid) throw new AppError('INVALID_CREDENTIALS', 'Email or password is incorrect.', 401);
    if (user.suspended) throw new AppError('ACCOUNT_SUSPENDED', 'This account has been suspended. Contact support.', 403);
    if (adminEmails(c.env).has(user.email) && user.role !== 'admin') {
      await repo.setUserRole(user.id, 'admin');
      user.role = 'admin';
    }
    await repo.audit(user.id, 'auth.login', 'user', user.id, { ip: clientIp(c) });
    return ok(c, await issueSession(c, user));
  });

  app.post('/api/v1/auth/google', limit('AUTH_LIMITER', clientIp), async (c) => {
    if (!c.env.FIREBASE_PROJECT_ID) throw new AppError('GOOGLE_AUTH_DISABLED', 'Google sign-in is not configured.', 503);
    const input = parse(z.object({ idToken: z.string().min(10).max(8192) }), await body(c));
    const verified = await verifyFirebaseIdToken(input.idToken, c.env.FIREBASE_PROJECT_ID);
    if (!verified.emailVerified) throw new AppError('GOOGLE_EMAIL_UNVERIFIED', 'Your Google email is not verified.', 403);
    const repo = c.get('repo');
    const user = await repo.findOrCreateFederatedUser(verified.email, adminEmails(c.env).has(verified.email) ? 'admin' : 'user');
    if (user.suspended) throw new AppError('ACCOUNT_SUSPENDED', 'This account has been suspended. Contact support.', 403);
    await repo.audit(user.id, 'auth.google', 'user', user.id, { ip: clientIp(c) });
    return ok(c, await issueSession(c, user));
  });

  // --------------------------------------------------------------- authenticated routes
  const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
    const header = c.req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw new AppError('UNAUTHENTICATED', 'Sign in is required.', 401);
    const hash = await sha256Hex(token);
    const user = await c.get('repo').findActiveSession(hash);
    if (!user) throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.', 401);
    c.set('user', user);
    c.set('sessionHash', hash);
    await next();
  };
  const requireAdmin: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
    if (c.get('user').role !== 'admin') throw new AppError('FORBIDDEN', 'Administrator access is required.', 403);
    await next();
  };

  const api = new Hono<{ Bindings: Env; Variables: Vars }>();
  api.use('*', requireAuth);
  api.use('*', limit('API_LIMITER', (c) => c.get('user').id));

  api.post('/auth/logout', async (c) => {
    const hash = c.get('sessionHash');
    if (hash) await c.get('repo').revokeSession(hash);
    return ok(c, { loggedOut: true });
  });

  api.get('/auth/me', async (c) => {
    const repo = c.get('repo');
    const user = await repo.getUser(c.get('user').id);
    if (!user) throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.', 401);
    return ok(c, { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt, usage: await repo.getUsage(user.id) });
  });

  api.get('/account/usage', async (c) => ok(c, await c.get('repo').getUsage(c.get('user').id)));

  api.delete('/account', async (c) => {
    const input = parse(z.object({ password: z.string().max(128).optional(), confirm: z.literal('DELETE') }), await body(c));
    const repo = c.get('repo');
    const user = await repo.getUser(c.get('user').id);
    if (!user) throw notFound('Account not found.');
    if (user.passwordHash && !(input.password && (await verifyPassword(input.password, user.passwordHash)))) throw new AppError('INVALID_CREDENTIALS', 'Password is incorrect.', 401);
    await deletePrefix(c.env.MEDIA_BUCKET, `users/${user.id}/`);
    await repo.deleteUser(user.id);
    return ok(c, { deleted: true });
  });

  // --------------------------------------------------------------- projects
  api.get('/projects', async (c) => {
    const projects = await c.get('repo').listProjects(c.get('user').id);
    return ok(c, await Promise.all(projects.map((project) => presentProject(c, project, false))));
  });

  api.post('/projects', limit('API_LIMITER', (c) => `create:${c.get('user').id}`), async (c) => {
    const input = parse(createProjectSchema, await body(c));
    const { normalizedUrl, videoId } = parseYouTubeUrl(input.youtubeUrl);
    const repo = c.get('repo');
    const userId = c.get('user').id;
    const plan = await repo.getPlan(userId);
    if (input.requestedClipCount > plan.maxClipsPerJob) throw new AppError('CLIP_LIMIT_REACHED', `Your ${plan.code} plan allows up to ${plan.maxClipsPerJob} clips per video.`, 402);
    await repo.reserveCredit(userId, `video:${videoId}`);
    const { projectId, jobId } = await repo.createProject({
      userId, sourceUrl: normalizedUrl, sourceVideoId: videoId,
      jobMetadata: { preferredDuration: input.preferredDuration, requestedClipCount: input.requestedClipCount, aspectRatio: input.aspectRatio, contentGoal: input.contentGoal, hookType: input.hookType },
    });
    try {
      await c.env.JOBS.send({ type: 'analysis.acquire', jobId });
    } catch {
      await repo.finishJob(jobId, 'FAILED', 'The processing queue is unavailable. Please retry.', 'QUEUE_UNAVAILABLE');
      await repo.refundCredit(userId, jobId);
      throw new AppError('QUEUE_UNAVAILABLE', 'The processing queue is unavailable. Please try again shortly.', 503, true);
    }
    await repo.audit(userId, 'project.create', 'project', projectId, { videoId });
    return ok(c, { projectId, jobId, status: 'QUEUED' }, 202);
  });

  api.get('/projects/:projectId', async (c) => {
    const project = await c.get('repo').getProject(c.get('user').id, c.req.param('projectId'));
    if (!project) throw notFound('Project not found.');
    return ok(c, await presentProject(c, project, true));
  });

  api.patch('/projects/:projectId', async (c) => {
    const input = parse(z.object({ name: z.string().trim().min(1).max(200) }), await body(c));
    if (!(await c.get('repo').renameProject(c.get('user').id, c.req.param('projectId'), input.name))) throw notFound('Project not found.');
    return ok(c, { renamed: true });
  });

  api.post('/projects/:projectId/duplicate', async (c) => {
    const repo = c.get('repo');
    const id = await repo.duplicateProject(c.get('user').id, c.req.param('projectId'));
    if (!id) throw notFound('Project not found.');
    const project = await repo.getProject(c.get('user').id, id);
    return ok(c, project ? await presentProject(c, project, false) : null, 201);
  });

  api.delete('/projects/:projectId', async (c) => {
    const repo = c.get('repo');
    const userId = c.get('user').id;
    const project = await repo.getProject(userId, c.req.param('projectId'));
    if (!project) throw notFound('Project not found.');
    if (project.latestJobId) await repo.requestCancel(project.latestJobId);
    const exports = await repo.listProjectExports(userId, project.id);
    await repo.deleteProject(userId, project.id);
    const bucket = c.env.MEDIA_BUCKET;
    if (exports.length > 0) await bucket.delete(exports.map((item) => item.storageKey)).catch(() => undefined);
    await deletePrefix(bucket, `users/${userId}/projects/${project.id}/audio/`).catch(() => undefined);
    await deletePrefix(bucket, `users/${userId}/projects/${project.id}/transcript/`).catch(() => undefined);
    // Duplicates share the source video and transcript; only remove them when nothing references them.
    if (project.sourceKey && (await repo.countKeyReferences('source_key', project.sourceKey)) === 0) await bucket.delete(project.sourceKey).catch(() => undefined);
    if (project.transcriptKey && (await repo.countKeyReferences('transcript_key', project.transcriptKey)) === 0) await bucket.delete(project.transcriptKey).catch(() => undefined);
    await repo.audit(userId, 'project.delete', 'project', project.id);
    return ok(c, { deleted: true });
  });

  api.patch('/projects/:projectId/clips/:clipId', async (c) => {
    const input = parse(clipPatchSchema, await body(c));
    const repo = c.get('repo');
    const userId = c.get('user').id;
    const project = await repo.getProject(userId, c.req.param('projectId'));
    if (!project) throw notFound('Project not found.');
    const current = project.clips.find((clip) => clip.id === c.req.param('clipId'));
    if (!current) throw notFound('Clip not found.');
    const editor = input.editor
      ? {
        ...(input.editor.aspectRatio ? { aspectRatio: input.editor.aspectRatio } : {}),
        ...(input.editor.captions ? { captions: { ...(current.editor?.captions ?? {}), ...input.editor.captions } } : {}),
        ...(input.editor.reframing ? { reframing: { ...(current.editor?.reframing ?? {}), ...input.editor.reframing } } : {}),
        ...(input.editor.audio ? { audio: { ...(current.editor?.audio ?? {}), ...input.editor.audio } } : {}),
      } as Partial<ClipEditorState>
      : undefined;
    const updated = await repo.updateClip(userId, project.id, current.id, { start: input.start, end: input.end, title: input.title, editor });
    if (!updated) throw notFound('Clip not found.');
    return ok(c, updated);
  });

  // --------------------------------------------------------------- rendering & exports
  api.post('/projects/:projectId/clips/:clipId/exports', limit('API_LIMITER', (c) => `render:${c.get('user').id}`), async (c) => {
    const input = parse(renderSchema, await body(c));
    const repo = c.get('repo');
    const userId = c.get('user').id;
    const project = await repo.getProject(userId, c.req.param('projectId'));
    if (!project) throw notFound('Project not found.');
    const clip = project.clips.find((item) => item.id === c.req.param('clipId'));
    if (!clip) throw notFound('Clip not found.');
    if (project.status !== 'READY') throw new AppError('PROJECT_NOT_READY', 'The project is still processing.', 409);
    if (!project.sourceKey) throw new AppError('SOURCE_EXPIRED', 'The source video has expired from storage. Re-analyze the video to export again.', 410);
    const plan = await repo.getPlan(userId);
    if ((await repo.countActiveJobs(userId, 'render')) >= plan.concurrentJobs * 2) throw new AppError('CONCURRENCY_LIMIT', 'Too many renders in progress. Wait for one to finish.', 429);
    const usage = await repo.getUsage(userId);
    if (usage.storageBytes >= plan.storageLimitBytes) throw new AppError('STORAGE_LIMIT_REACHED', 'Your storage limit is reached. Delete old exports to continue.', 402);
    const options = {
      resolution: capResolution(input.resolution, plan),
      fps: input.fps,
      format: input.format,
      codec: plan.code === 'FREE' ? 'h264' as const : input.codec,
      quality: input.quality,
      aspectRatio: input.aspectRatio ?? clip.editor?.aspectRatio ?? '9:16',
    };
    const job = await repo.createRenderJob({ userId, projectId: project.id, clipId: clip.id, metadata: options });
    try {
      await c.env.JOBS.send({ type: 'render', jobId: job.id });
    } catch {
      await repo.finishJob(job.id, 'FAILED', 'The processing queue is unavailable. Please retry.', 'QUEUE_UNAVAILABLE');
      throw new AppError('QUEUE_UNAVAILABLE', 'The processing queue is unavailable. Please try again shortly.', 503, true);
    }
    return ok(c, { jobId: job.id, status: job.state, options }, 202);
  });

  api.get('/exports', async (c) => {
    const records = await c.get('repo').listExports(c.get('user').id);
    return ok(c, await Promise.all(records.map((record) => presentExport(c, record))));
  });

  api.get('/jobs/:jobId/export', async (c) => {
    const record = await c.get('repo').getExportByJob(c.get('user').id, c.req.param('jobId'));
    if (!record) throw notFound('Export not found.');
    return ok(c, await presentExport(c, record));
  });

  api.delete('/exports/:exportId', async (c) => {
    const key = await c.get('repo').deleteExport(c.get('user').id, c.req.param('exportId'));
    if (!key) throw notFound('Export not found.');
    await c.env.MEDIA_BUCKET.delete(key).catch(() => undefined);
    return ok(c, { deleted: true });
  });

  // --------------------------------------------------------------- jobs
  api.get('/jobs', async (c) => ok(c, (await c.get('repo').listJobs(c.get('user').id, 50)).map(presentJob)));

  api.get('/jobs/:jobId', async (c) => {
    const job = await c.get('repo').getJob(c.get('user').id, c.req.param('jobId'));
    if (!job) throw notFound('Processing job not found.');
    return ok(c, presentJob(job));
  });

  api.get('/jobs/:jobId/events', async (c) => {
    const repo = c.get('repo');
    const userId = c.get('user').id;
    const jobId = c.req.param('jobId');
    if (!(await repo.getJob(userId, jobId))) throw notFound('Processing job not found.');
    return streamSSE(c, async (stream) => {
      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
      });
      let last = '';
      // Streams for up to ~10 minutes; the client transparently falls back to polling after that.
      for (let tick = 0; tick < 400 && !aborted; tick += 1) {
        const job = await repo.getJob(userId, jobId);
        if (!job) break;
        const payload = JSON.stringify(presentJob(job));
        if (payload !== last) {
          await stream.writeSSE({ event: 'progress', data: payload });
          last = payload;
        } else if (tick % 10 === 0) {
          await stream.write(': keep-alive\n\n');
        }
        if (TERMINAL_JOB_STATES.includes(job.state)) break;
        await stream.sleep(1500);
      }
    });
  });

  const cancelJob = async (c: AppContext, job: JobRecord) => {
    const repo = c.get('repo');
    if (TERMINAL_JOB_STATES.includes(job.state)) throw new AppError('JOB_NOT_ACTIVE', 'This job is no longer active.', 409);
    await repo.requestCancel(job.id);
    if (job.containerId && c.env.MEDIA) {
      const stub = c.env.MEDIA.get(c.env.MEDIA.idFromString(job.containerId));
      c.executionCtx.waitUntil(stub.destroy().catch(() => undefined));
    }
    if (job.kind === 'analysis') {
      await repo.refundCredit(job.userId, job.id);
      await repo.setProjectStatus(job.projectId, 'FAILED');
    }
  };

  const retryJob = async (c: AppContext, job: JobRecord) => {
    const repo = c.get('repo');
    if (!['FAILED', 'CANCELLED'].includes(job.state)) throw new AppError('JOB_NOT_RETRYABLE', 'Only failed or cancelled jobs can be retried.', 409);
    const project = await repo.getProjectById(job.projectId);
    if (!project) throw notFound('Project not found.');
    if (job.kind === 'render') {
      if (!project.clips.some((clip) => clip.id === job.metadata.clipId)) throw notFound('Clip no longer exists.');
      await repo.resetJobForRetry(job.id);
      await c.env.JOBS.send({ type: 'render', jobId: job.id });
      return;
    }
    await repo.reserveCredit(job.userId, `retry:${job.id}`);
    await repo.resetJobForRetry(job.id);
    await repo.setProjectStatus(project.id, 'PROCESSING');
    await c.env.JOBS.send({ type: 'analysis.acquire', jobId: job.id });
  };

  api.post('/jobs/:jobId/cancel', async (c) => {
    const job = await c.get('repo').getJob(c.get('user').id, c.req.param('jobId'));
    if (!job) throw notFound('Processing job not found.');
    await cancelJob(c, job);
    return ok(c, { jobId: job.id, status: 'CANCELLED' });
  });

  api.post('/jobs/:jobId/retry', async (c) => {
    const job = await c.get('repo').getJob(c.get('user').id, c.req.param('jobId'));
    if (!job) throw notFound('Processing job not found.');
    await retryJob(c, job);
    return ok(c, { jobId: job.id, status: 'QUEUED' }, 202);
  });

  // --------------------------------------------------------------- brand kits & templates
  api.get('/brand-kits', async (c) => ok(c, await c.get('repo').listBrandKits(c.get('user').id)));
  api.post('/brand-kits', async (c) => {
    const input = parse(z.object({ name: z.string().trim().min(1).max(80), data: z.record(z.string(), z.unknown()).default({}), isDefault: z.boolean().default(false) }), await body(c));
    return ok(c, await c.get('repo').createBrandKit(c.get('user').id, input), 201);
  });
  api.get('/templates', async (c) => ok(c, await c.get('repo').listTemplates(c.get('user').id)));
  api.post('/templates', async (c) => {
    const input = parse(z.object({ name: z.string().trim().min(1).max(80), data: z.record(z.string(), z.unknown()).default({}) }), await body(c));
    return ok(c, await c.get('repo').createTemplate(c.get('user').id, input), 201);
  });

  // --------------------------------------------------------------- admin
  const admin = new Hono<{ Bindings: Env; Variables: Vars }>();
  admin.use('*', requireAdmin);
  admin.get('/overview', async (c) => ok(c, await c.get('repo').adminOverview()));
  admin.get('/jobs', async (c) => {
    const limitValue = parse(z.coerce.number().int().min(1).max(200).default(50), c.req.query('limit'));
    const state = c.req.query('state') || undefined;
    return ok(c, (await c.get('repo').adminListJobs(limitValue, state)).map(({ containerId, ...rest }) => (void containerId, rest)));
  });
  admin.post('/jobs/:jobId/retry', async (c) => {
    const job = await c.get('repo').getJobById(c.req.param('jobId'));
    if (!job) throw notFound('Processing job not found.');
    await retryJob(c, job);
    await c.get('repo').audit(c.get('user').id, 'admin.job.retry', 'job', job.id);
    return ok(c, { jobId: job.id, status: 'QUEUED' }, 202);
  });
  admin.post('/jobs/:jobId/cancel', async (c) => {
    const job = await c.get('repo').getJobById(c.req.param('jobId'));
    if (!job) throw notFound('Processing job not found.');
    await cancelJob(c, job);
    await c.get('repo').audit(c.get('user').id, 'admin.job.cancel', 'job', job.id);
    return ok(c, { jobId: job.id, status: 'CANCELLED' });
  });
  admin.get('/users', async (c) => {
    const limitValue = parse(z.coerce.number().int().min(1).max(500).default(100), c.req.query('limit'));
    const search = c.req.query('search')?.trim().slice(0, 100) || undefined;
    return ok(c, await c.get('repo').adminListUsers(limitValue, search));
  });
  admin.patch('/users/:userId', async (c) => {
    const input = parse(z.object({ plan: z.string().optional(), suspended: z.boolean().optional(), role: z.enum(['user', 'admin']).optional() }), await body(c));
    const repo = c.get('repo');
    const userId = c.req.param('userId');
    if (!(await repo.getUser(userId))) throw notFound('User not found.');
    if (input.plan !== undefined) {
      if (!isPlanCode(input.plan)) throw new AppError('VALIDATION_ERROR', 'Unknown plan.', 400);
      await repo.adminSetPlan(userId, input.plan);
    }
    if (input.suspended !== undefined) {
      if (userId === c.get('user').id) throw new AppError('VALIDATION_ERROR', 'You cannot suspend your own account.', 400);
      await repo.adminSetSuspended(userId, input.suspended);
    }
    if (input.role !== undefined) await repo.setUserRole(userId, input.role);
    await repo.audit(c.get('user').id, 'admin.user.update', 'user', userId, input);
    return ok(c, { updated: true });
  });
  admin.post('/users/:userId/reset-usage', async (c) => {
    await c.get('repo').adminResetUsage(c.req.param('userId'));
    await c.get('repo').audit(c.get('user').id, 'admin.user.reset_usage', 'user', c.req.param('userId'));
    return ok(c, { reset: true });
  });
  api.route('/admin', admin);

  app.route('/api/v1', api);
  return app;
}
