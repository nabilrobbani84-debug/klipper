import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { z } from 'zod';
import {
  createMediaToken,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  requireAdmin,
  requireAuth,
  verifyMediaToken,
  verifyPassword,
} from './auth.js';
import { adminEmails, type AppConfig } from './config.js';
import type { Repository } from './db.js';
import { AppError, errorHandler, formatZodError, notFound } from './errors.js';
import { requestLogger } from './logger.js';
import type { Metrics } from './metrics.js';
import { capResolution, isPlanCode, PLAN_ENTITLEMENTS } from './plans.js';
import type { ProcessingQueue } from './queue.js';
import { parseRangeHeader, type ObjectStorage } from './services/storage.js';
import { parseYouTubeUrl } from './services/youtube.js';
import { TERMINAL_JOB_STATES, type AnalysisJobPayload, type ClipEditorState, type ExportRecord, type JobRecord, type ProjectRecord, type QueuePayload, type RenderJobPayload } from './types.js';

export interface ApiDependencies {
  config: AppConfig;
  repository: Repository;
  queue: ProcessingQueue;
  storage: ObjectStorage;
  metrics: Metrics;
  logger: Logger;
}

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

const hex = z.string().max(40);
const clipPatchSchema = z.object({
  start: z.number().nonnegative().optional(),
  end: z.number().positive().optional(),
  title: z.string().trim().min(1).max(140).optional(),
  editor: z.object({
    aspectRatio: aspectSchema.optional(),
    captions: z.object({
      enabled: z.boolean().optional(), preset: z.string().max(40).optional(), fontFamily: z.string().max(80).optional(),
      fontSize: z.number().min(8).max(160).optional(), textColor: hex.optional(), highlightColor: hex.optional(), strokeColor: hex.optional(),
      strokeWidth: z.number().min(0).max(20).optional(), backgroundColor: hex.optional(), hasBackground: z.boolean().optional(),
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
const renameSchema = z.object({ name: z.string().trim().min(1).max(200) });
const brandKitSchema = z.object({ name: z.string().trim().min(1).max(80), data: z.record(z.string(), z.unknown()).default({}), isDefault: z.boolean().default(false) });
const templateSchema = z.object({ name: z.string().trim().min(1).max(80), data: z.record(z.string(), z.unknown()).default({}) });
const adminUserPatchSchema = z.object({ plan: z.string().optional(), suspended: z.boolean().optional(), role: z.enum(['user', 'admin']).optional() });
const deleteAccountSchema = z.object({ password: z.string().min(1).max(128).optional(), confirm: z.literal('DELETE') });

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw formatZodError(result.error);
  return result.data;
}

const route = (handler: (req: Request, res: Response) => Promise<void>): RequestHandler => (req, res, next) => {
  handler(req, res).catch(next);
};

function send<T>(req: Request, res: Response, data: T, status = 200) {
  res.status(status).json({ success: true, data, error: null, requestId: String(req.id) });
}

const param = (req: Request, name: string) => String(req.params[name] ?? '');

export function createApp(deps: ApiDependencies): Express {
  const { config, repository, queue, storage, metrics } = deps;
  const app = express();
  const admins = adminEmails(config);
  const publicBase = config.APP_URL.replace(/\/$/, '');
  const corsOrigins = config.CORS_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean);

  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);
  app.use(requestLogger(deps.logger));
  app.use((req, res, next) => {
    res.setHeader('X-Request-Id', String(req.id));
    next();
  });
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        'media-src': ["'self'", 'blob:', 'https:'],
        'connect-src': ["'self'", ...corsOrigins.filter((origin) => origin.startsWith('https://'))],
        'frame-ancestors': ["'none'"],
        'upgrade-insecure-requests': config.NODE_ENV === 'production' ? [] : null,
      },
    },
  }));
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || corsOrigins.includes(origin)), credentials: false, exposedHeaders: ['X-Request-Id'] }));
  app.use(express.json({ limit: '256kb' }));
  app.use((req, _res, next) => {
    metrics.increment('http.requests');
    next();
  });

  // ------------------------------------------------------------ health
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/ready', route(async (_req, res) => {
    try {
      await repository.health();
      await queue.waitUntilReady();
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  }));
  app.get('/metrics', (req, res) => {
    const token = req.header('authorization')?.replace(/^Bearer /, '') ?? '';
    const expected = config.METRICS_TOKEN ?? '';
    const allowed = config.NODE_ENV !== 'production' || (expected.length > 0 && token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected)));
    if (!allowed) {
      res.status(404).end();
      return;
    }
    res.json(metrics.snapshot());
  });

  // ------------------------------------------------------------ helpers
  const mediaUrl = async (key: string, userId: string, downloadName?: string): Promise<string> => {
    const direct = await storage.signedUrl(key, config.MEDIA_URL_TTL_SECONDS, downloadName);
    if (direct) return direct;
    return `${publicBase}/media/${createMediaToken({ key, userId, download: downloadName }, config.AUTH_SECRET, config.MEDIA_URL_TTL_SECONDS)}`;
  };

  const presentProject = async (project: ProjectRecord) => {
    const sourceKey = project.status !== 'PROCESSING' || project.clips.length > 0 ? await repository.getSourceStorageKey(project.id) : null;
    return { ...project, sourceMediaUrl: sourceKey ? await mediaUrl(sourceKey, project.userId) : null };
  };

  const presentExport = async (record: ExportRecord, userId: string) => {
    const extension = record.contentType === 'video/quicktime' ? 'mov' : 'mp4';
    const safeTitle = record.clipTitle.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'clip';
    const { storageKey, ...rest } = record;
    return {
      ...rest,
      previewUrl: await mediaUrl(storageKey, userId),
      downloadUrl: await mediaUrl(storageKey, userId, `${safeTitle}.${extension}`),
    };
  };

  const enqueue = async (payload: QueuePayload, priority: number, bullJobId: string) => {
    await queue.add(payload.kind, payload, { jobId: bullJobId, priority });
    metrics.increment(`jobs.queued.${payload.kind}`);
  };

  const issueSession = async (user: { id: string; email: string; role: 'user' | 'admin' }) => {
    const session = createSessionToken(user, config.AUTH_SECRET, Math.round(config.SESSION_TTL_HOURS * 3600));
    await repository.createSession(user.id, hashSessionToken(session.token), session.expiresAt);
    return { token: session.token, expiresAt: session.expiresAt.toISOString(), user: { id: user.id, email: user.email, role: user.role } };
  };

  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { success: false, data: null, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } } });
  const apiLimiter = rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false, message: { success: false, data: null, error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down.' } } });
  const createLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? '0.0.0.0'), message: { success: false, data: null, error: { code: 'RATE_LIMITED', message: 'Too many processing requests this hour.' } } });

  // ------------------------------------------------------------ public config
  app.get('/api/v1/config', (req, res) => {
    send(req, res, {
      registrationOpen: config.ALLOW_REGISTRATION,
      plans: Object.values(PLAN_ENTITLEMENTS),
      billingEnabled: false,
    });
  });

  // ------------------------------------------------------------ auth
  const auth = express.Router();
  auth.post('/register', authLimiter, route(async (req, res) => {
    if (!config.ALLOW_REGISTRATION) throw new AppError('REGISTRATION_CLOSED', 'Registration is currently closed.', 403);
    const input = parse(credentialsSchema, req.body);
    const user = await repository.registerUser({ email: input.email, passwordHash: await hashPassword(input.password), role: admins.has(input.email) ? 'admin' : 'user' });
    await repository.audit(user.id, 'auth.register', 'user', user.id);
    send(req, res, await issueSession(user), 201);
  }));
  auth.post('/login', authLimiter, route(async (req, res) => {
    const input = parse(credentialsSchema.extend({ password: z.string().min(1).max(128) }), req.body);
    const user = await repository.findUserByEmail(input.email);
    const valid = user?.passwordHash ? await verifyPassword(input.password, user.passwordHash) : await hashPassword(input.password).then(() => false);
    if (!user || !valid) throw new AppError('INVALID_CREDENTIALS', 'Email or password is incorrect.', 401);
    if (user.suspended) throw new AppError('ACCOUNT_SUSPENDED', 'This account has been suspended. Contact support.', 403);
    if (admins.has(user.email) && user.role !== 'admin') {
      await repository.setUserRole(user.id, 'admin');
      user.role = 'admin';
    }
    await repository.audit(user.id, 'auth.login', 'user', user.id, { ip: req.ip });
    send(req, res, await issueSession(user));
  }));
  app.use('/api/v1/auth', auth);

  // ------------------------------------------------------------ authenticated API
  const api = express.Router();
  api.use(apiLimiter);
  api.use(requireAuth(config, repository));
  api.use((req, _res, next) => {
    if (!(config.ALLOW_DEV_AUTH && !req.sessionToken && req.user)) {
      next();
      return;
    }
    repository.ensureDevUser(req.user.id).then(() => next(), next);
  });

  api.post('/auth/logout', route(async (req, res) => {
    if (req.sessionToken) await repository.revokeSession(hashSessionToken(req.sessionToken));
    send(req, res, { loggedOut: true });
  }));

  api.get('/auth/me', route(async (req, res) => {
    const user = await repository.getUser(req.user!.id);
    const usage = await repository.getUsage(req.user!.id);
    send(req, res, { id: req.user!.id, email: user?.email ?? req.user!.email ?? null, role: user?.role ?? req.user!.role ?? 'user', createdAt: user?.createdAt ?? null, usage });
  }));

  api.get('/account/usage', route(async (req, res) => {
    send(req, res, await repository.getUsage(req.user!.id));
  }));

  api.delete('/account', route(async (req, res) => {
    const input = parse(deleteAccountSchema, req.body);
    const user = await repository.getUser(req.user!.id);
    if (user?.passwordHash) {
      if (!input.password || !(await verifyPassword(input.password, user.passwordHash))) throw new AppError('INVALID_CREDENTIALS', 'Password is incorrect.', 401);
    }
    await storage.deletePrefix(`users/${req.user!.id}/`);
    await repository.deleteUser(req.user!.id);
    send(req, res, { deleted: true });
  }));

  // ------------------------------------------------------------ projects
  api.get('/projects', route(async (req, res) => {
    const projects = await repository.listProjects(req.user!.id);
    send(req, res, await Promise.all(projects.map(presentProject)));
  }));

  api.post('/projects', createLimiter, route(async (req, res) => {
    const input = parse(createProjectSchema, req.body);
    const { normalizedUrl, videoId } = parseYouTubeUrl(input.youtubeUrl);
    const planBefore = await repository.getPlanEntitlements(req.user!.id);
    if (input.requestedClipCount > planBefore.maxClipsPerJob) throw new AppError('CLIP_LIMIT_REACHED', `Your ${planBefore.code} plan allows up to ${planBefore.maxClipsPerJob} clips per video.`, 402);
    const plan = await repository.reserveCredit(req.user!.id, { sourceVideoId: videoId });
    const jobMetadata = { preferredDuration: input.preferredDuration, requestedClipCount: input.requestedClipCount, aspectRatio: input.aspectRatio, contentGoal: input.contentGoal, hookType: input.hookType };
    const { project, job } = await repository.createProject({ userId: req.user!.id, sourceUrl: normalizedUrl, sourceVideoId: videoId, jobMetadata });
    const payload: AnalysisJobPayload = {
      kind: 'analysis', jobId: job.id, projectId: project.id, userId: req.user!.id, sourceUrl: normalizedUrl, sourceVideoId: videoId,
      preferredDuration: input.preferredDuration, requestedClipCount: input.requestedClipCount, contentGoal: input.contentGoal, hookType: input.hookType,
    };
    try {
      await enqueue(payload, plan.priority, job.id);
    } catch (error) {
      await repository.finishJob(job.id, 'FAILED', 'The processing queue is unavailable. Please retry.', 'QUEUE_UNAVAILABLE');
      await repository.refundCredit(req.user!.id, job.id);
      throw new AppError('QUEUE_UNAVAILABLE', 'The processing queue is unavailable. Please try again shortly.', 503, true);
    }
    await repository.audit(req.user!.id, 'project.create', 'project', project.id, { videoId });
    send(req, res, { projectId: project.id, jobId: job.id, status: job.state }, 202);
  }));

  api.get('/projects/:projectId', route(async (req, res) => {
    const project = await repository.getProject(req.user!.id, param(req, 'projectId'));
    if (!project) throw notFound('Project not found.');
    send(req, res, await presentProject(project));
  }));

  api.patch('/projects/:projectId', route(async (req, res) => {
    const input = parse(renameSchema, req.body);
    if (!(await repository.renameProject(req.user!.id, param(req, 'projectId'), input.name))) throw notFound('Project not found.');
    send(req, res, { renamed: true });
  }));

  api.post('/projects/:projectId/duplicate', route(async (req, res) => {
    const id = await repository.duplicateProject(req.user!.id, param(req, 'projectId'));
    if (!id) throw notFound('Project not found.');
    const project = await repository.getProject(req.user!.id, id);
    send(req, res, project ? await presentProject(project) : null, 201);
  }));

  api.delete('/projects/:projectId', route(async (req, res) => {
    const projectId = param(req, 'projectId');
    const project = await repository.getProject(req.user!.id, projectId);
    if (!project) throw notFound('Project not found.');
    if (project.latestJobId) await repository.requestCancel(project.latestJobId);
    const sourceKey = await repository.getSourceStorageKey(projectId);
    const exportKeys = (await repository.listExports(req.user!.id)).filter((item) => item.projectId === projectId).map((item) => item.storageKey);
    await repository.deleteProject(req.user!.id, projectId);
    for (const key of exportKeys) await storage.delete(key).catch(() => undefined);
    await storage.deletePrefix(`users/${req.user!.id}/projects/${projectId}/`).catch(() => undefined);
    // Duplicated projects share source media; only delete it once nothing references it.
    if (sourceKey && (await repository.countSourceReferences(sourceKey)) === 0) await storage.delete(sourceKey).catch(() => undefined);
    await repository.audit(req.user!.id, 'project.delete', 'project', projectId);
    send(req, res, { deleted: true });
  }));

  api.patch('/projects/:projectId/clips/:clipId', route(async (req, res) => {
    const input = parse(clipPatchSchema, req.body);
    const project = await repository.getProject(req.user!.id, param(req, 'projectId'));
    if (!project) throw notFound('Project not found.');
    const current = project.clips.find((clip) => clip.id === param(req, 'clipId'));
    if (!current) throw notFound('Clip not found.');
    const editor = input.editor
      ? {
        ...(input.editor.aspectRatio ? { aspectRatio: input.editor.aspectRatio } : {}),
        ...(input.editor.captions ? { captions: { ...(current.editor?.captions ?? {}), ...input.editor.captions } } : {}),
        ...(input.editor.reframing ? { reframing: { ...(current.editor?.reframing ?? {}), ...input.editor.reframing } } : {}),
        ...(input.editor.audio ? { audio: { ...(current.editor?.audio ?? {}), ...input.editor.audio } } : {}),
      }
      : undefined;
    const updated = await repository.updateClip(req.user!.id, project.id, current.id, { start: input.start, end: input.end, title: input.title, editor: editor as Partial<ClipEditorState> | undefined });
    if (!updated) throw notFound('Clip not found.');
    send(req, res, updated);
  }));

  // ------------------------------------------------------------ exports / rendering
  api.post('/projects/:projectId/clips/:clipId/exports', createLimiter, route(async (req, res) => {
    const input = parse(renderSchema, req.body ?? {});
    const project = await repository.getProject(req.user!.id, param(req, 'projectId'));
    if (!project) throw notFound('Project not found.');
    const clip = project.clips.find((item) => item.id === param(req, 'clipId'));
    if (!clip) throw notFound('Clip not found.');
    if (project.status !== 'READY') throw new AppError('PROJECT_NOT_READY', 'The project is still processing.', 409);
    const plan = await repository.getPlanEntitlements(req.user!.id);
    if ((await repository.countActiveJobs(req.user!.id, 'render')) >= plan.concurrentJobs * 2) throw new AppError('CONCURRENCY_LIMIT', 'Too many renders in progress. Wait for one to finish.', 429);
    const usage = await repository.getUsage(req.user!.id);
    if (usage.storageBytes >= plan.storageLimitBytes) throw new AppError('STORAGE_LIMIT_REACHED', 'Your storage limit is reached. Delete old exports to continue.', 402);
    const options = {
      resolution: capResolution(input.resolution, plan),
      fps: input.fps,
      format: input.format,
      codec: plan.code === 'FREE' ? 'h264' as const : input.codec,
      quality: input.quality,
      aspectRatio: input.aspectRatio ?? clip.editor?.aspectRatio ?? '9:16',
    };
    const job = await repository.createRenderJob({ userId: req.user!.id, projectId: project.id, clipId: clip.id, metadata: { ...options } });
    const payload: RenderJobPayload = { kind: 'render', jobId: job.id, projectId: project.id, userId: req.user!.id, clipId: clip.id, ...options };
    try {
      await enqueue(payload, plan.priority, job.id);
    } catch {
      await repository.finishJob(job.id, 'FAILED', 'The processing queue is unavailable. Please retry.', 'QUEUE_UNAVAILABLE');
      throw new AppError('QUEUE_UNAVAILABLE', 'The processing queue is unavailable. Please try again shortly.', 503, true);
    }
    send(req, res, { jobId: job.id, status: job.state, options }, 202);
  }));

  api.get('/exports', route(async (req, res) => {
    const records = await repository.listExports(req.user!.id);
    send(req, res, await Promise.all(records.map((record) => presentExport(record, req.user!.id))));
  }));

  api.get('/jobs/:jobId/export', route(async (req, res) => {
    const record = await repository.getExportByJob(req.user!.id, param(req, 'jobId'));
    if (!record) throw notFound('Export not found.');
    send(req, res, await presentExport(record, req.user!.id));
  }));

  api.delete('/exports/:exportId', route(async (req, res) => {
    const key = await repository.deleteExport(req.user!.id, param(req, 'exportId'));
    if (!key) throw notFound('Export not found.');
    await storage.delete(key).catch(() => undefined);
    send(req, res, { deleted: true });
  }));

  // ------------------------------------------------------------ jobs
  api.get('/jobs', route(async (req, res) => {
    send(req, res, await repository.listJobs(req.user!.id, 50));
  }));

  api.get('/jobs/:jobId', route(async (req, res) => {
    const job = await repository.getJob(req.user!.id, param(req, 'jobId'));
    if (!job) throw notFound('Processing job not found.');
    send(req, res, job);
  }));

  api.get('/jobs/:jobId/events', route(async (req, res) => {
    const jobId = param(req, 'jobId');
    const initial = await repository.getJob(req.user!.id, jobId);
    if (!initial) throw notFound('Processing job not found.');
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    let closed = false;
    let lastPayload = '';
    let ticks = 0;
    req.on('close', () => {
      closed = true;
    });
    while (!closed) {
      const job = await repository.getJob(req.user!.id, jobId).catch(() => null);
      if (!job) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: 'Processing job not found.' })}\n\n`);
        break;
      }
      const payload = JSON.stringify(job);
      if (payload !== lastPayload) {
        res.write(`event: progress\ndata: ${payload}\n\n`);
        lastPayload = payload;
      } else if (ticks % 10 === 0) {
        res.write(': keep-alive\n\n');
      }
      if (TERMINAL_JOB_STATES.includes(job.state)) break;
      ticks += 1;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    res.end();
  }));

  const cancelJob = async (job: JobRecord) => {
    if (TERMINAL_JOB_STATES.includes(job.state)) throw new AppError('JOB_NOT_ACTIVE', 'This job is no longer active.', 409);
    await repository.requestCancel(job.id);
    const queued = await queue.getJob(job.id).catch(() => undefined);
    if (queued && (await queued.isWaiting().catch(() => false))) await queued.remove().catch(() => undefined);
    if (job.kind === 'analysis') {
      await repository.refundCredit(job.userId, job.id);
      await repository.setProjectStatus(job.projectId, 'FAILED');
    }
  };

  const retryJob = async (job: JobRecord) => {
    if (!['FAILED', 'CANCELLED'].includes(job.state)) throw new AppError('JOB_NOT_RETRYABLE', 'Only failed or cancelled jobs can be retried.', 409);
    const project = await repository.getProject(job.userId, job.projectId);
    if (!project) throw notFound('Project not found.');
    const metadata = job.metadata;
    const plan = job.kind === 'analysis' ? await repository.reserveCredit(job.userId, { retryOf: job.id }) : await repository.getPlanEntitlements(job.userId);
    let payload: QueuePayload;
    if (job.kind === 'render') {
      const parsed = renderSchema.parse(metadata);
      const clipId = String(metadata.clipId ?? '');
      if (!project.clips.some((clip) => clip.id === clipId)) throw notFound('Clip no longer exists.');
      payload = { kind: 'render', jobId: job.id, projectId: project.id, userId: job.userId, clipId, ...parsed, resolution: capResolution(parsed.resolution, plan), aspectRatio: parsed.aspectRatio ?? '9:16' };
    } else {
      payload = {
        kind: 'analysis', jobId: job.id, projectId: project.id, userId: job.userId, sourceUrl: project.sourceUrl, sourceVideoId: project.sourceVideoId,
        preferredDuration: Number(metadata.preferredDuration ?? 45), requestedClipCount: Number(metadata.requestedClipCount ?? 3),
        contentGoal: typeof metadata.contentGoal === 'string' ? metadata.contentGoal : undefined,
        hookType: typeof metadata.hookType === 'string' ? metadata.hookType : undefined,
      };
      await repository.setProjectStatus(project.id, 'PROCESSING');
    }
    await repository.resetJobForRetry(job.id);
    await enqueue(payload, plan.priority, `${job.id}-retry-${Date.now()}`);
  };

  api.post('/jobs/:jobId/cancel', route(async (req, res) => {
    const job = await repository.getJob(req.user!.id, param(req, 'jobId'));
    if (!job) throw notFound('Processing job not found.');
    await cancelJob(job);
    send(req, res, { jobId: job.id, status: 'CANCELLED' });
  }));

  api.post('/jobs/:jobId/retry', route(async (req, res) => {
    const job = await repository.getJob(req.user!.id, param(req, 'jobId'));
    if (!job) throw notFound('Processing job not found.');
    await retryJob(job);
    send(req, res, { jobId: job.id, status: 'QUEUED' }, 202);
  }));

  // ------------------------------------------------------------ brand kits & templates
  api.get('/brand-kits', route(async (req, res) => send(req, res, await repository.listBrandKits(req.user!.id))));
  api.post('/brand-kits', route(async (req, res) => send(req, res, await repository.createBrandKit(req.user!.id, parse(brandKitSchema, req.body)), 201)));
  api.get('/templates', route(async (req, res) => send(req, res, await repository.listTemplates(req.user!.id))));
  api.post('/templates', route(async (req, res) => send(req, res, await repository.createTemplate(req.user!.id, parse(templateSchema, req.body)), 201)));

  // ------------------------------------------------------------ admin
  const adminRoute = (handler: (req: Request, res: Response) => Promise<void>) => route(async (req, res) => {
    requireAdmin(req);
    await handler(req, res);
  });
  api.get('/admin/overview', adminRoute(async (req, res) => {
    const [stats, queueCounts, workers] = await Promise.all([
      repository.adminOverview(),
      queue.getJobCounts('waiting', 'active', 'delayed', 'prioritized', 'failed').catch(() => null),
      queue.getWorkersCount().catch(() => null),
    ]);
    send(req, res, { ...stats, queue: queueCounts, workersOnline: workers });
  }));
  api.get('/admin/jobs', adminRoute(async (req, res) => {
    const limit = parse(z.coerce.number().int().min(1).max(200).default(50), req.query.limit);
    const state = typeof req.query.state === 'string' && req.query.state ? req.query.state : undefined;
    send(req, res, await repository.adminListJobs(limit, state));
  }));
  api.post('/admin/jobs/:jobId/retry', adminRoute(async (req, res) => {
    const job = await repository.getJobById(param(req, 'jobId'));
    if (!job) throw notFound('Processing job not found.');
    await retryJob(job);
    await repository.audit(req.user!.id, 'admin.job.retry', 'job', job.id);
    send(req, res, { jobId: job.id, status: 'QUEUED' }, 202);
  }));
  api.post('/admin/jobs/:jobId/cancel', adminRoute(async (req, res) => {
    const job = await repository.getJobById(param(req, 'jobId'));
    if (!job) throw notFound('Processing job not found.');
    await cancelJob(job);
    await repository.audit(req.user!.id, 'admin.job.cancel', 'job', job.id);
    send(req, res, { jobId: job.id, status: 'CANCELLED' });
  }));
  api.get('/admin/users', adminRoute(async (req, res) => {
    const limit = parse(z.coerce.number().int().min(1).max(500).default(100), req.query.limit);
    const search = typeof req.query.search === 'string' && req.query.search.trim() ? req.query.search.trim().slice(0, 100) : undefined;
    send(req, res, await repository.adminListUsers(limit, search));
  }));
  api.patch('/admin/users/:userId', adminRoute(async (req, res) => {
    const input = parse(adminUserPatchSchema, req.body);
    const userId = param(req, 'userId');
    if (!(await repository.getUser(userId))) throw notFound('User not found.');
    if (input.plan !== undefined) {
      if (!isPlanCode(input.plan)) throw new AppError('VALIDATION_ERROR', 'Unknown plan.', 400);
      await repository.adminSetPlan(userId, input.plan);
    }
    if (input.suspended !== undefined) {
      if (userId === req.user!.id) throw new AppError('VALIDATION_ERROR', 'You cannot suspend your own account.', 400);
      await repository.adminSetSuspended(userId, input.suspended);
    }
    if (input.role !== undefined) await repository.setUserRole(userId, input.role);
    await repository.audit(req.user!.id, 'admin.user.update', 'user', userId, input);
    send(req, res, { updated: true });
  }));
  api.post('/admin/users/:userId/reset-usage', adminRoute(async (req, res) => {
    await repository.adminResetUsage(param(req, 'userId'));
    await repository.audit(req.user!.id, 'admin.user.reset_usage', 'user', param(req, 'userId'));
    send(req, res, { reset: true });
  }));

  app.use('/api/v1', api);
  app.use('/api', (_req, _res, next) => next(notFound('API route not found.')));

  // ------------------------------------------------------------ signed media (video preview + downloads)
  app.get('/media/:token', route(async (req, res) => {
    const media = verifyMediaToken(param(req, 'token'), config.AUTH_SECRET);
    if (!media) throw new AppError('MEDIA_LINK_EXPIRED', 'This media link has expired. Reload the page.', 403);
    const size = await storage.size(media.key);
    if (size === null) throw notFound('Media not found.');
    const contentType = media.key.endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (media.download) res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(media.download)}"`);
    const range = parseRangeHeader(req.header('range'), size);
    if (range === 'unsatisfiable') {
      res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
      return;
    }
    if (range) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader('Content-Length', String(range.end - range.start + 1));
    } else {
      res.setHeader('Content-Length', String(size));
    }
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = await storage.open(media.key, range ?? undefined);
    req.on('close', () => stream.destroy());
    stream.on('error', (error) => {
      req.log.warn({ err: error }, 'media stream failed');
      res.destroy();
    });
    stream.pipe(res);
  }));

  // ------------------------------------------------------------ SPA (same-origin production deployment)
  const dist = path.resolve(config.FRONTEND_DIST);
  if (config.SERVE_FRONTEND && existsSync(path.join(dist, 'index.html'))) {
    app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y', index: false }));
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/|media\/|health$|ready$|metrics$).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use((_req, _res, next) => next(notFound()));
  app.use(errorHandler());
  return app;
}

export const __testing = { createProjectSchema, renderSchema, clipPatchSchema, credentialsSchema, randomId: () => crypto.randomUUID() };
