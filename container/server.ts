import { promises as fs } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { AppError, toAppError } from '../shared/errors.js';
import { computeCrop, outputSize } from '../shared/reframe.js';
import type { AcquireRequest, AcquireResult, AudioChunk, JobState, ProgressReply, RenderRequest, RenderResult } from '../shared/types.js';
import { cutSample, detectFaceFocus, extractAudioChunks, probeMedia, YtDlp } from './media.js';
import { renderClip } from './render.js';
import { objectUrl, uploadFile } from './storage.js';

/**
 * Job server running inside the Cloudflare Container. The Worker POSTs one job (/acquire or /render);
 * we reply 202 at once, do the work in the background, report through `http://api.internal`
 * (intercepted by the Worker's outbound handler) and exit when done. One container = one job.
 */
const API_BASE = process.env.API_BASE_URL ?? 'http://api.internal';
const PORT = Number(process.env.PORT ?? 8080);
const WORK_ROOT = process.env.WORK_DIR ?? path.join(os.tmpdir(), 'clipforge');
const HEARTBEAT_MS = 20_000;

let busy = false;

function log(message: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ level: 'info', message, ...extra }));
}

async function callApi<T>(pathname: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${pathname}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok) throw new Error(`api ${pathname} HTTP ${response.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

class JobContext {
  readonly controller = new AbortController();
  private state: JobState = 'DOWNLOADING';
  private progressValue = 1;
  private message = 'Starting…';
  private timer: NodeJS.Timeout;

  constructor(readonly jobId: string) {
    // Heartbeat keeps the container alive and is how cancellation reaches us.
    this.timer = setInterval(() => void this.flush(), HEARTBEAT_MS);
  }

  get signal() {
    return this.controller.signal;
  }

  async report(state: JobState, progress: number, message: string) {
    this.state = state;
    this.progressValue = progress;
    this.message = message;
    await this.flush();
    if (this.signal.aborted) throw new AppError('JOB_CANCELLED', 'Processing was cancelled.', 409);
  }

  private async flush() {
    try {
      const reply = await callApi<ProgressReply>('/progress', { state: this.state, progress: this.progressValue, message: this.message });
      if (reply.cancelled) this.controller.abort();
    } catch (error) {
      log('progress report failed', { jobId: this.jobId, detail: (error as Error).message });
    }
  }

  stop() {
    clearInterval(this.timer);
  }
}

async function acquire(request: AcquireRequest, job: JobContext, dir: string) {
  let cookiesFile: string | null = null;
  if (request.ytdlpCookies) {
    cookiesFile = path.join(dir, 'cookies.txt');
    await fs.writeFile(cookiesFile, request.ytdlpCookies, { mode: 0o600 });
  }
  const ytdlp = new YtDlp(cookiesFile);
  await job.report('DOWNLOADING', 4, 'Validating video and fetching metadata…');
  const metadata = await ytdlp.metadata(request.sourceUrl, request.maxDurationSeconds, job.signal);

  await job.report('DOWNLOADING', 8, `Downloading “${metadata.title.slice(0, 60)}”…`);
  const source = path.join(dir, 'source.mp4');
  await ytdlp.download(request.sourceUrl, source, request.maxHeight, job.signal);
  const probe = await probeMedia(source, job.signal);
  if (!probe.hasAudio) throw new AppError('NO_AUDIO', 'This video has no audio track, so it cannot be transcribed.', 422);

  await job.report('UPLOADING', 16, 'Storing source video…');
  await uploadFile(source, request.sourceKey, 'video/mp4');

  await job.report('EXTRACTING_AUDIO', 22, 'Extracting audio…');
  const files = await extractAudioChunks(source, path.join(dir, 'audio'), request.audioChunkSeconds, job.signal);
  if (files.length === 0) throw new AppError('AUDIO_EXTRACTION_FAILED', 'No audio could be extracted from this video.', 422);
  const chunks: AudioChunk[] = [];
  for (const [index, file] of files.entries()) {
    const key = `${request.audioPrefix}${path.basename(file)}`;
    await uploadFile(file, key, 'audio/mpeg');
    const offset = index * request.audioChunkSeconds;
    chunks.push({ key, offset, duration: Math.min(request.audioChunkSeconds, Math.max(0, probe.duration - offset)) });
    if (index % 5 === 4) await job.report('EXTRACTING_AUDIO', 22 + Math.round(((index + 1) / files.length) * 6), `Uploading audio (${index + 1}/${files.length})…`);
  }
  const result: AcquireResult = { metadata, width: probe.width, height: probe.height, duration: probe.duration, hasAudio: probe.hasAudio, chunks };
  await callApi('/acquired', result);
}

async function render(request: RenderRequest, job: JobContext, dir: string) {
  const sourceUrl = objectUrl(request.sourceKey);
  await job.report('DOWNLOADING', 6, 'Reading source video…');
  const probe = await probeMedia(sourceUrl, job.signal);

  const reframing = { ...request.reframing };
  if (request.faceDetection && (reframing.mode === 'face' || reframing.mode === 'speaker')) {
    await job.report('REFRAMING', 15, 'Detecting the speaker for auto-reframe…');
    const sample = path.join(dir, 'sample.mp4');
    await cutSample(sourceUrl, request.start, request.duration, sample, job.signal);
    const face = await detectFaceFocus(sample, 0, request.duration, job.signal);
    if (face) {
      reframing.panX = Math.round(face.x * 100);
      reframing.panY = Math.round(face.y * 100);
    }
  } else if (reframing.mode === 'center') {
    reframing.panX = 50;
    reframing.panY = 50;
  }
  const crop = computeCrop(probe, request.options.aspectRatio, reframing);

  let subtitlePath: string | undefined;
  if (request.ass) {
    await job.report('GENERATING_CAPTIONS', 25, 'Preparing captions…');
    subtitlePath = path.join(dir, 'captions.ass');
    await fs.writeFile(subtitlePath, request.ass, 'utf8');
  }

  const extension = request.options.format === 'mov' ? 'mov' : 'mp4';
  const output = path.join(dir, `output.${extension}`);
  await job.report('RENDERING', 30, `Rendering ${request.options.resolution} ${request.options.aspectRatio}…`);
  let lastReported = 0;
  await renderClip({
    source: sourceUrl, outputPath: output, start: request.start, duration: request.duration, crop, options: request.options,
    subtitlePath, watermarkText: request.watermarkText, captionFont: request.captionFont, audio: request.audio, hasAudio: probe.hasAudio,
  }, job.signal, (fraction) => {
    const percent = 30 + Math.round(fraction * 58);
    if (percent - lastReported >= 5) {
      lastReported = percent;
      void job.report('RENDERING', percent, `Rendering… ${Math.round(fraction * 100)}%`).catch(() => undefined);
    }
  });

  await job.report('UPLOADING', 92, 'Uploading export…');
  const contentType = extension === 'mov' ? 'video/quicktime' : 'video/mp4';
  const sizeBytes = await uploadFile(output, request.outputKey, contentType);
  const size = outputSize(request.options.aspectRatio, request.options.resolution);
  const result: RenderResult = { key: request.outputKey, sizeBytes, width: size.width, height: size.height, contentType };
  await callApi('/rendered', result);
}

async function runJob(kind: 'acquire' | 'render', payload: AcquireRequest | RenderRequest) {
  const job = new JobContext(payload.jobId);
  const dir = path.join(WORK_ROOT, payload.jobId);
  const started = Date.now();
  try {
    await fs.mkdir(dir, { recursive: true });
    if (kind === 'acquire') await acquire(payload as AcquireRequest, job, dir);
    else await render(payload as RenderRequest, job, dir);
    log('job finished', { jobId: payload.jobId, kind, seconds: Math.round((Date.now() - started) / 1000) });
  } catch (error) {
    const appError = toAppError(error, 'MEDIA_FAILED', 'Media processing failed. Please retry.');
    log('job failed', { jobId: payload.jobId, kind, code: appError.code, detail: error instanceof Error ? error.message : String(error) });
    if (appError.code !== 'JOB_CANCELLED') await callApi('/failed', { code: appError.code, message: appError.message }).catch(() => undefined);
  } finally {
    job.stop();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    // One job per container: exit so the instance stops and stops billing.
    setTimeout(() => process.exit(0), 500);
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 8 * 1024 * 1024) throw new Error('payload too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://container');
  if (request.method === 'GET' && (url.pathname === '/ping' || url.pathname === '/health')) {
    send(response, 200, { ok: true, busy });
    return;
  }
  if (request.method === 'POST' && (url.pathname === '/acquire' || url.pathname === '/render')) {
    if (busy) {
      send(response, 409, { error: 'busy' });
      return;
    }
    readJson(request).then((payload) => {
      const body = payload as { jobId?: unknown };
      if (typeof body.jobId !== 'string') {
        send(response, 400, { error: 'jobId required' });
        return;
      }
      busy = true;
      send(response, 202, { accepted: true });
      void runJob(url.pathname === '/acquire' ? 'acquire' : 'render', payload as AcquireRequest | RenderRequest);
    }).catch((error: Error) => send(response, 400, { error: error.message }));
    return;
  }
  send(response, 404, { error: 'not found' });
});

server.listen(PORT, () => log('media container listening', { port: PORT }));
