import { Container, type OutboundHandlerContext } from '@cloudflare/containers';
import { AppError, toAppError } from '../shared/errors.js';
import { parseRangeHeader } from '../shared/range.js';
import type { AcquireResult, FailureReport, ProgressReport, ProgressReply, RenderResult } from '../shared/types.js';
import { Repository, type JobRecord } from './db.js';
import type { Env } from './env.js';
import { CONTAINER_STATES, failJob, logError, onAcquired, onContainerFailed, onContainerProgress, onRendered } from './pipeline.js';

const MAX_SINGLE_PUT = 64 * 1024 * 1024;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

/** Resolves the job owned by the calling container instance (one instance per job attempt). */
async function jobFor(env: Env, ctx: OutboundHandlerContext): Promise<JobRecord | null> {
  return new Repository(env.DB).getJobByContainer(ctx.containerId);
}

/**
 * `http://r2.internal/...` — the container's only path to R2. Keys are restricted to the job owner's
 * prefix, so a container can never read or write another user's media.
 */
async function storageHandler(request: Request, env: Env, ctx: OutboundHandlerContext): Promise<Response> {
  const job = await jobFor(env, ctx);
  if (!job) return json({ error: 'no job assigned' }, 403);
  const url = new URL(request.url);
  const key = url.searchParams.get('key') ?? '';
  if (!key.startsWith(`users/${job.userId}/`) || key.includes('..')) return json({ error: 'forbidden key' }, 403);
  const bucket = env.MEDIA_BUCKET;

  if (url.pathname === '/object' && (request.method === 'GET' || request.method === 'HEAD')) {
    const head = await bucket.head(key);
    if (!head) return new Response(null, { status: 404 });
    const range = parseRangeHeader(request.headers.get('range'), head.size);
    if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { 'content-range': `bytes */${head.size}` } });
    const headers = new Headers({ 'accept-ranges': 'bytes', 'content-type': head.httpMetadata?.contentType ?? 'application/octet-stream' });
    if (range) {
      headers.set('content-range', `bytes ${range.start}-${range.end}/${head.size}`);
      headers.set('content-length', String(range.end - range.start + 1));
    } else {
      headers.set('content-length', String(head.size));
    }
    if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });
    const object = await bucket.get(key, range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined);
    if (!object) return new Response(null, { status: 404 });
    return new Response(object.body, { status: range ? 206 : 200, headers });
  }

  const contentType = request.headers.get('content-type') ?? 'application/octet-stream';
  if (url.pathname === '/object' && request.method === 'PUT') {
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_SINGLE_PUT) return json({ error: 'use multipart upload' }, 413);
    await bucket.put(key, body, { httpMetadata: { contentType } });
    return json({ key, size: body.byteLength });
  }
  if (url.pathname === '/mpu/create' && request.method === 'POST') {
    const upload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType } });
    return json({ uploadId: upload.uploadId });
  }
  const uploadId = url.searchParams.get('uploadId') ?? '';
  if (url.pathname === '/mpu/part' && request.method === 'PUT') {
    const partNumber = Number(url.searchParams.get('part'));
    if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) return json({ error: 'bad part' }, 400);
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_SINGLE_PUT) return json({ error: 'part too large' }, 413);
    const part = await bucket.resumeMultipartUpload(key, uploadId).uploadPart(partNumber, body);
    return json(part);
  }
  if (url.pathname === '/mpu/complete' && request.method === 'POST') {
    const { parts } = (await request.json()) as { parts: R2UploadedPart[] };
    const object = await bucket.resumeMultipartUpload(key, uploadId).complete(parts);
    return json({ key, size: object.size });
  }
  if (url.pathname === '/mpu/abort' && request.method === 'POST') {
    await bucket.resumeMultipartUpload(key, uploadId).abort().catch(() => undefined);
    return json({ aborted: true });
  }
  return json({ error: 'not found' }, 404);
}

/** `http://api.internal/...` — progress, heartbeat and results reported by the container. */
async function apiHandler(request: Request, env: Env, ctx: OutboundHandlerContext): Promise<Response> {
  const job = await jobFor(env, ctx);
  if (!job) return json({ cancelled: true } satisfies ProgressReply);
  const path = new URL(request.url).pathname;
  try {
    const body = request.method === 'POST' ? await request.json() : {};
    if (path === '/progress') {
      const active = await onContainerProgress(env, job, body as ProgressReport);
      if (active && env.MEDIA) await env.MEDIA.get(env.MEDIA.idFromString(ctx.containerId)).renewActivityTimeout().catch(() => undefined);
      return json({ cancelled: !active } satisfies ProgressReply);
    }
    if (path === '/acquired') {
      await onAcquired(env, job, body as AcquireResult);
      return json({ ok: true });
    }
    if (path === '/rendered') {
      await onRendered(env, job, body as RenderResult);
      return json({ ok: true });
    }
    if (path === '/failed') {
      await onContainerFailed(env, job, body as FailureReport);
      return json({ ok: true });
    }
    return json({ error: 'not found' }, 404);
  } catch (error) {
    const appError = toAppError(error);
    if (path !== '/progress') await failJob(env, job, appError);
    return json({ error: appError.message, cancelled: true }, appError.statusCode);
  }
}

/**
 * Container-enabled Durable Object running yt-dlp, FFmpeg and OpenCV (see container/).
 * One instance is created per job attempt; it exits when its job is done.
 */
export class MediaContainer extends Container<Env> {
  defaultPort = 8080;
  // Kept alive by progress heartbeats; stops if the container goes quiet for this long.
  sleepAfter = '10m';
  enableInternet = true;

  static outboundByHost = {
    'r2.internal': storageHandler,
    'api.internal': apiHandler,
  };

  override async onStop(): Promise<void> {
    // If the process exits while it still owns the job (crash, OOM, eviction), fail it instead of hanging.
    const repo = new Repository(this.env.DB);
    const job = await repo.getJobByContainer(this.ctx.id.toString()).catch(() => null);
    if (job && (CONTAINER_STATES.includes(job.state) || job.state === 'QUEUED')) {
      await failJob(this.env, job, new AppError('MEDIA_WORKER_STOPPED', 'The media worker stopped unexpectedly. Please retry.', 503, true));
    }
  }

  override onError(error: unknown): void {
    logError('container error', { containerId: this.ctx.id.toString(), detail: error instanceof Error ? error.message : String(error) });
  }
}
