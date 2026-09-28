import crypto from 'node:crypto';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { AppConfig } from './config.js';
import type pino from 'pino';
import { requestLogger } from './logger.js';
import { AppError, errorHandler, formatZodError, notFound } from './errors.js';
import type { ProjectRepository } from './db.js';
import type { Metrics } from './metrics.js';
import type { Queue } from 'bullmq';
import type { QueuePayload } from './types.js';
import { parseYouTubeUrl } from './services/youtube.js';

const createProjectSchema = z.object({
  youtubeUrl: z.string().trim().min(1).max(2048), contentGoal: z.string().max(80).optional(), hookType: z.string().max(80).optional(),
  preferredDuration: z.coerce.number().int().min(15).max(180).default(45), aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:5']).default('9:16'),
  requestedClipCount: z.coerce.number().int().min(1).max(10).default(3),
});
const renderSchema = z.object({ quality: z.enum(['draft', 'standard', 'high', 'ultra']).default('standard'), aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:5']).default('9:16') });

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => { void handler(req, res).catch(next); };
}

function send<T>(req: Request, res: Response, data: T, status = 200) {
  res.status(status).json({ success: true, data, error: null, requestId: String(req.id) });
}

export interface ApiDependencies { config: AppConfig; repository: ProjectRepository; queue: Queue<QueuePayload>; metrics: Metrics; logger: pino.Logger; }

export function createApp(deps: ApiDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestLogger(deps.logger));
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || deps.config.CORS_ORIGIN.split(',').map((value) => value.trim()).includes(origin)), credentials: true }));
  app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use(express.json({ limit: '64kb' }));
  app.use((req, _res, next) => { req.id = req.id || req.header('x-request-id') || crypto.randomUUID(); next(); });

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', asyncRoute(async (_req, res) => { await deps.repository.health(); await deps.queue.waitUntilReady(); res.json({ status: 'ready' }); }));
  app.get('/metrics', (_req, res) => res.json(deps.metrics.snapshot()));

  const api = express.Router();
  api.use(requireAuth(deps.config));

  api.get('/projects', asyncRoute(async (req, res) => { send(req, res, await deps.repository.listProjects(req.user!.id)); }));
  api.get('/projects/:projectId', asyncRoute(async (req, res) => {
    const project = await deps.repository.getProject(req.user!.id, req.params.projectId);
    if (!project) throw notFound('Project not found.');
    send(req, res, project);
  }));
  api.post('/projects', asyncRoute(async (req, res) => {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) throw formatZodError(parsed.error);
    const { normalizedUrl, videoId } = parseYouTubeUrl(parsed.data.youtubeUrl);
    const result = await deps.repository.createProject({ userId: req.user!.id, sourceUrl: normalizedUrl, sourceVideoId: videoId });
    const payload: QueuePayload = { kind: 'analysis', jobId: result.job.id, projectId: result.project.id, userId: req.user!.id, sourceUrl: normalizedUrl, sourceVideoId: videoId, preferredDuration: parsed.data.preferredDuration, requestedClipCount: parsed.data.requestedClipCount };
    await deps.queue.add('analysis', payload, { jobId: result.job.id });
    deps.metrics.increment('jobs.queued');
    send(req, res, { projectId: result.project.id, jobId: result.job.id, status: result.job.state }, 202);
  }));

  api.get('/jobs/:jobId', asyncRoute(async (req, res) => {
    const job = await deps.repository.getJob(req.user!.id, req.params.jobId);
    if (!job) throw notFound('Processing job not found.');
    send(req, res, job);
  }));
  api.get('/jobs/:jobId/events', asyncRoute(async (req, res) => {
    const initial = await deps.repository.getJob(req.user!.id, req.params.jobId);
    if (!initial) throw notFound('Processing job not found.');
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    let closed = false;
    const write = async () => {
      if (closed) return;
      const job = await deps.repository.getJob(req.user!.id, req.params.jobId);
      if (!job) { res.write(`event: error\\ndata: ${JSON.stringify({ message: 'Processing job not found.' })}\\n\\n`); return; }
      res.write(`event: progress\\ndata: ${JSON.stringify(job)}\\n\\n`);
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.state)) { res.end(); return; }
      setTimeout(() => void write(), 1000);
    };
    req.on('close', () => { closed = true; });
    await write();
  }));
  api.post('/jobs/:jobId/cancel', asyncRoute(async (req, res) => {
    const job = await deps.repository.getJob(req.user!.id, req.params.jobId);
    if (!job) throw notFound('Processing job not found.');
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.state)) throw new AppError('JOB_NOT_ACTIVE', 'This job is no longer active.', 409);
    await deps.repository.updateJob(job.id, { state: 'CANCELLED', message: 'Cancellation requested by user.', errorCode: null });
    send(req, res, { jobId: job.id, status: 'CANCELLED' });
  }));
  api.post('/jobs/:jobId/retry', asyncRoute(async (req, res) => {
    const job = await deps.repository.getJob(req.user!.id, req.params.jobId);
    if (!job) throw notFound('Processing job not found.');
    if (!['FAILED', 'CANCELLED'].includes(job.state)) throw new AppError('JOB_NOT_RETRYABLE', 'Only failed or cancelled jobs can be retried.', 409);
    const project = await deps.repository.getProject(req.user!.id, job.projectId);
    if (!project) throw notFound('Project not found.');
    await deps.repository.updateJob(job.id, { state: 'QUEUED', progress: 0, message: 'Retry queued.', errorCode: null });
    const payload: QueuePayload = job.kind === 'render'
      ? { kind: 'render', jobId: job.id, projectId: project.id, userId: req.user!.id, clipId: project.clips[0]?.id ?? '', quality: 'standard', aspectRatio: '9:16' }
      : { kind: 'analysis', jobId: job.id, projectId: project.id, userId: req.user!.id, sourceUrl: project.sourceUrl, sourceVideoId: project.sourceVideoId, preferredDuration: 45, requestedClipCount: 3 };
    await deps.queue.add(job.kind === 'render' ? 'render-retry' : 'analysis-retry', payload, { jobId: `${job.id}-${Date.now()}` });
    send(req, res, { jobId: job.id, status: 'QUEUED' }, 202);
  }));
  api.post('/projects/:projectId/clips/:clipId/exports', asyncRoute(async (req, res) => {
    const parsed = renderSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw formatZodError(parsed.error);
    const project = await deps.repository.getProject(req.user!.id, req.params.projectId);
    if (!project) throw notFound('Project not found.');
    const clip = project.clips.find((item) => item.id === req.params.clipId);
    if (!clip) throw notFound('Clip not found.');
    const job = await deps.repository.createRenderJob({ userId: req.user!.id, projectId: project.id, clipId: clip.id, metadata: parsed.data });
    const payload: QueuePayload = { kind: 'render', jobId: job.id, projectId: project.id, userId: req.user!.id, clipId: clip.id, quality: parsed.data.quality, aspectRatio: parsed.data.aspectRatio };
    await deps.queue.add('render', payload, { jobId: job.id });
    deps.metrics.increment('jobs.render_queued');
    send(req, res, { jobId: job.id, status: job.state }, 202);
  }));

  app.use('/api/v1', api);
  app.use((_req, _res, next) => next(notFound()));
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => errorHandler()(err, req, res, next));
  return app;
}
