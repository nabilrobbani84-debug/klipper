import { buildAssSubtitles, DEFAULT_CAPTION_SETTINGS } from '../shared/captions.js';
import { AppError, toAppError } from '../shared/errors.js';
import { outputSize } from '../shared/reframe.js';
import { mergeTranscripts } from '../shared/transcript.js';
import {
  isAspectRatio,
  type AcquireRequest,
  type AcquireResult,
  type AudioSettings,
  type CaptionSettings,
  type ClipCandidate,
  type FailureReport,
  type JobState,
  type ProgressReport,
  type ReframingSettings,
  type RenderOptions,
  type RenderRequest,
  type RenderResult,
  type TranscriptDocument,
} from '../shared/types.js';
import { detectClips } from './ai.js';
import { Repository, type JobRecord, type ProjectRow } from './db.js';
import { boolVar, numberVar, type Env, type JobMessage } from './env.js';
import { transcribeChunk } from './transcribe.js';

export const keys = {
  source: (userId: string, projectId: string) => `users/${userId}/sources/${projectId}.mp4`,
  audioPrefix: (userId: string, projectId: string) => `users/${userId}/projects/${projectId}/audio/`,
  transcriptPart: (userId: string, projectId: string, index: number) => `users/${userId}/projects/${projectId}/transcript/part-${String(index).padStart(4, '0')}.json`,
  transcript: (userId: string, projectId: string) => `users/${userId}/projects/${projectId}/transcript.json`,
  export: (userId: string, projectId: string, jobId: string, ext: string) => `users/${userId}/projects/${projectId}/exports/${jobId}.${ext}`,
};

/** Job states during which a container instance owns the job. */
export const CONTAINER_STATES: readonly JobState[] = ['DOWNLOADING', 'EXTRACTING_AUDIO', 'REFRAMING', 'GENERATING_CAPTIONS', 'RENDERING', 'UPLOADING'];

const DEFAULT_REFRAMING: ReframingSettings = { mode: 'face', panX: 50, panY: 50, zoom: 1 };
const DEFAULT_AUDIO: AudioSettings = { noiseReduction: false, voiceEnhance: false, compressor: false, loudnessNorm: true, volume: 100 };

type Logger = (message: string, extra?: Record<string, unknown>) => void;
export const log: Logger = (message, extra = {}) => console.log(JSON.stringify({ level: 'info', message, ...extra }));
export const logError: Logger = (message, extra = {}) => console.error(JSON.stringify({ level: 'error', message, ...extra }));

export async function loadTranscript(env: Env, key: string | null): Promise<TranscriptDocument | null> {
  if (!key) return null;
  const object = await env.MEDIA_BUCKET.get(key);
  return object ? ((await object.json()) as TranscriptDocument) : null;
}

/** Marks a job failed (idempotent), refunds analysis credits and flags the project. */
export async function failJob(env: Env, job: JobRecord, error: unknown) {
  const repo = new Repository(env.DB);
  const appError = toAppError(error);
  const changed = await repo.finishJob(job.id, 'FAILED', appError.message, appError.code);
  if (!changed) return;
  logError('job failed', { jobId: job.id, kind: job.kind, userId: job.userId, errorCode: appError.code, detail: error instanceof Error ? error.message : String(error) });
  if (job.kind === 'analysis') {
    await repo.setProjectStatus(job.projectId, 'FAILED');
    await repo.refundCredit(job.userId, job.id);
  }
}

async function startContainer(env: Env, job: JobRecord, path: string, body: unknown) {
  if (!env.MEDIA) throw new AppError('MEDIA_UNAVAILABLE', 'The media processing container is not configured.', 503, true);
  // A fresh instance per attempt keeps jobs isolated and lets retries ignore stale instances.
  const id = env.MEDIA.idFromName(`${job.id}:${Date.now()}`);
  await new Repository(env.DB).setJobContainer(job.id, id.toString());
  const response = await env.MEDIA.get(id).fetch(new Request(`http://container${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
  if (response.status !== 202) {
    const text = await response.text().catch(() => '');
    logError('container start failed', { jobId: job.id, status: response.status, detail: text.slice(0, 300) });
    throw new AppError('MEDIA_START_FAILED', 'The media worker could not start. Please retry.', 503, true);
  }
}

// ----------------------------------------------------------------------------- analysis steps

async function acquire(env: Env, job: JobRecord, project: ProjectRow) {
  const repo = new Repository(env.DB);
  const plan = await repo.getPlan(job.userId);
  if (!(await repo.updateJobProgress(job.id, 'DOWNLOADING', 2, 'Starting media worker…'))) return;
  const request: AcquireRequest = {
    jobId: job.id,
    sourceUrl: project.sourceUrl,
    sourceKey: keys.source(job.userId, project.id),
    audioPrefix: keys.audioPrefix(job.userId, project.id),
    maxDurationSeconds: Math.min(plan.maxVideoDurationSeconds, numberVar(env.MAX_VIDEO_DURATION_SECONDS, 4 * 3600)),
    maxHeight: numberVar(env.YTDLP_MAX_HEIGHT, 1080),
    audioChunkSeconds: numberVar(env.AUDIO_CHUNK_SECONDS, 240),
    ytdlpCookies: env.YTDLP_COOKIES || undefined,
  };
  await startContainer(env, job, '/acquire', request);
}

async function transcribeStep(env: Env, job: JobRecord, project: ProjectRow, index: number) {
  const repo = new Repository(env.DB);
  const chunks = project.audioChunks;
  if (chunks.length === 0) throw new AppError('AUDIO_MISSING', 'No audio was extracted from this video.', 422);
  if (index < chunks.length) {
    const progress = 30 + Math.round((index / chunks.length) * 45);
    if (!(await repo.updateJobProgress(job.id, 'TRANSCRIBING', progress, `Transcribing audio (${index + 1}/${chunks.length})…`))) return;
    const part = await transcribeChunk(env, chunks[index], index);
    await env.MEDIA_BUCKET.put(keys.transcriptPart(job.userId, project.id, index), JSON.stringify(part), { httpMetadata: { contentType: 'application/json' } });
    await env.JOBS.send({ type: 'analysis.transcribe', jobId: job.id, index: index + 1 });
    return;
  }
  // All chunks done: merge into one transcript document.
  const parts: TranscriptDocument[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const object = await env.MEDIA_BUCKET.get(keys.transcriptPart(job.userId, project.id, i));
    if (object) parts.push((await object.json()) as TranscriptDocument);
  }
  const transcript = mergeTranscripts(parts);
  if (transcript.segments.length === 0) throw new AppError('NO_SPEECH', 'No speech was detected in this video, so clips could not be generated.', 422);
  const transcriptKey = keys.transcript(job.userId, project.id);
  await env.MEDIA_BUCKET.put(transcriptKey, JSON.stringify(transcript), { httpMetadata: { contentType: 'application/json' } });
  await repo.saveTranscriptKey(project.id, transcriptKey);
  // Raw audio and partial transcripts are no longer needed.
  await env.MEDIA_BUCKET.delete([
    ...chunks.map((chunk) => chunk.key),
    ...chunks.map((_, i) => keys.transcriptPart(job.userId, project.id, i)),
  ]).catch(() => undefined);
  await env.JOBS.send({ type: 'analysis.detect', jobId: job.id });
}

async function detectStep(env: Env, job: JobRecord, project: ProjectRow) {
  const repo = new Repository(env.DB);
  if (!(await repo.updateJobProgress(job.id, 'ANALYZING', 78, 'Finding the strongest moments…'))) return;
  const transcript = await loadTranscript(env, project.transcriptKey);
  if (!transcript) throw new AppError('TRANSCRIPT_MISSING', 'The transcript is missing. Please retry the job.', 422);
  const metadata = job.metadata;
  const { clips, provider } = await detectClips(env, {
    transcript,
    title: project.metadata?.title ?? project.name,
    videoDuration: project.metadata?.durationSeconds ?? transcript.segments[transcript.segments.length - 1].end,
    preferredDuration: Number(metadata.preferredDuration ?? 45),
    requestedClipCount: Number(metadata.requestedClipCount ?? 3),
    contentGoal: typeof metadata.contentGoal === 'string' ? metadata.contentGoal : undefined,
    hookType: typeof metadata.hookType === 'string' ? metadata.hookType : undefined,
  }, (message, error) => logError(message, { jobId: job.id, detail: error instanceof Error ? error.message : undefined }));
  if (provider !== 'heuristic') await repo.recordApiUsage(job.userId, provider, { projectId: project.id });
  const aspectRatio = isAspectRatio(metadata.aspectRatio) ? metadata.aspectRatio : '9:16';
  const withEditor: ClipCandidate[] = clips.map((clip) => ({ ...clip, editor: { aspectRatio, reframing: { ...DEFAULT_REFRAMING } } }));
  await repo.updateJobProgress(job.id, 'GENERATING_CLIPS', 95, 'Saving clip candidates…');
  await repo.saveClips(project.id, withEditor);
  await repo.finishJob(job.id, 'COMPLETED', `${withEditor.length} clip${withEditor.length === 1 ? '' : 's'} ready for editing.`, null, { provider, clipCount: withEditor.length });
  log('analysis completed', { jobId: job.id, clips: withEditor.length, provider });
}

// ----------------------------------------------------------------------------- render

async function renderDispatch(env: Env, job: JobRecord, project: ProjectRow) {
  const repo = new Repository(env.DB);
  const clipId = String(job.metadata.clipId ?? '');
  const clip = project.clips.find((item) => item.id === clipId);
  if (!clip) throw new AppError('CLIP_NOT_FOUND', 'Clip not found.', 404);
  if (!project.sourceKey) throw new AppError('SOURCE_EXPIRED', 'The source video has expired from storage. Re-analyze the video to export again.', 410);
  const plan = await repo.getPlan(job.userId);
  const options = job.metadata as unknown as RenderOptions;
  const editor = clip.editor ?? {};
  const captions: CaptionSettings = { ...DEFAULT_CAPTION_SETTINGS, ...(editor.captions ?? {}) };
  const captionFont = env.CAPTION_FONT || 'DejaVu Sans';
  let ass: string | null = null;
  if (captions.enabled) {
    const transcript = await loadTranscript(env, project.transcriptKey);
    if (transcript) ass = buildAssSubtitles(transcript, clip, captions, { ...outputSize(options.aspectRatio, options.resolution), fontFamily: captionFont });
  }
  const extension = options.format === 'mov' ? 'mov' : 'mp4';
  const request: RenderRequest = {
    jobId: job.id,
    sourceKey: project.sourceKey,
    outputKey: keys.export(job.userId, project.id, job.id, extension),
    start: clip.start,
    duration: clip.end - clip.start,
    options,
    reframing: { ...DEFAULT_REFRAMING, ...(editor.reframing ?? {}) },
    audio: { ...DEFAULT_AUDIO, ...(editor.audio ?? {}) },
    ass,
    watermarkText: plan.watermark ? (env.WATERMARK_TEXT || 'ClipForge AI') : null,
    faceDetection: boolVar(env.FACE_DETECTION, true),
    captionFont,
  };
  if (!(await repo.updateJobProgress(job.id, 'DOWNLOADING', 3, 'Starting render worker…'))) return;
  await startContainer(env, job, '/render', request);
}

// ----------------------------------------------------------------------------- queue consumer

export async function processMessage(env: Env, message: JobMessage) {
  const repo = new Repository(env.DB);
  const job = await repo.getJobById(message.jobId);
  if (!job || !(await repo.isJobActive(job.id))) return;
  const project = await repo.getProjectById(job.projectId);
  if (!project) return;
  switch (message.type) {
    case 'analysis.acquire': return acquire(env, job, project);
    case 'analysis.transcribe': return transcribeStep(env, job, project, message.index);
    case 'analysis.detect': return detectStep(env, job, project);
    case 'render': return renderDispatch(env, job, project);
  }
}

/** Errors with a 5xx status (or unknown errors) are transient and retried; 4xx app errors fail immediately. */
export function isRetryable(error: unknown): boolean {
  return !(error instanceof AppError) || error.statusCode >= 500;
}

export async function handleQueueBatch(batch: MessageBatch<JobMessage>, env: Env) {
  for (const message of batch.messages) {
    try {
      await processMessage(env, message.body);
      message.ack();
    } catch (error) {
      const job = await new Repository(env.DB).getJobById(message.body.jobId).catch(() => null);
      if (job && isRetryable(error) && message.attempts < 3) {
        logError('job step failed, retrying', { jobId: job.id, step: message.body.type, attempt: message.attempts, detail: error instanceof Error ? error.message : String(error) });
        message.retry({ delaySeconds: 15 * message.attempts });
      } else {
        if (job) await failJob(env, job, error);
        message.ack();
      }
    }
  }
}

// ----------------------------------------------------------------------------- container callbacks

export async function onContainerProgress(env: Env, job: JobRecord, report: ProgressReport): Promise<boolean> {
  const allowed: JobState[] = ['DOWNLOADING', 'EXTRACTING_AUDIO', 'REFRAMING', 'GENERATING_CAPTIONS', 'RENDERING', 'UPLOADING'];
  const state = allowed.includes(report.state) ? report.state : job.state;
  return new Repository(env.DB).updateJobProgress(job.id, state, report.progress, String(report.message ?? ''));
}

export async function onAcquired(env: Env, job: JobRecord, result: AcquireResult) {
  const repo = new Repository(env.DB);
  const project = await repo.getProjectById(job.projectId);
  if (!project) return;
  const prefix = `users/${job.userId}/`;
  if (result.chunks.length === 0 || result.chunks.some((chunk) => !chunk.key.startsWith(prefix))) throw new AppError('AUDIO_MISSING', 'No audio was extracted from this video.', 422);
  const metadata = { ...result.metadata, width: result.width, height: result.height, durationSeconds: result.duration || result.metadata.durationSeconds };
  await repo.saveAcquired(project.id, { metadata, sourceKey: keys.source(job.userId, project.id), chunks: result.chunks });
  if (!(await repo.updateJobProgress(job.id, 'TRANSCRIBING', 30, 'Transcribing audio…'))) return;
  await env.JOBS.send({ type: 'analysis.transcribe', jobId: job.id, index: 0 });
}

export async function onRendered(env: Env, job: JobRecord, result: RenderResult) {
  const repo = new Repository(env.DB);
  const expectedPrefix = `users/${job.userId}/projects/${job.projectId}/exports/`;
  if (!result.key.startsWith(expectedPrefix)) throw new AppError('FORBIDDEN', 'Invalid export key.', 403);
  const options = job.metadata as unknown as RenderOptions & { clipId: string };
  const project = await repo.getProjectById(job.projectId);
  const clip = project?.clips.find((item) => item.id === options.clipId);
  const plan = await repo.getPlan(job.userId);
  const exportId = await repo.saveExport({
    userId: job.userId, projectId: job.projectId, clipId: options.clipId, jobId: job.id, storageKey: result.key,
    contentType: result.contentType, sizeBytes: result.sizeBytes,
    settings: { resolution: options.resolution, fps: options.fps, format: options.format, codec: options.codec, aspectRatio: options.aspectRatio, width: result.width, height: result.height, duration: clip ? clip.end - clip.start : 0, watermark: plan.watermark },
  });
  await repo.finishJob(job.id, 'COMPLETED', 'Export is ready to download.', null, { exportId });
  log('render completed', { jobId: job.id, exportId, bytes: result.sizeBytes });
}

export async function onContainerFailed(env: Env, job: JobRecord, report: FailureReport) {
  const code = /^[A-Z_]{3,40}$/.test(report.code) ? report.code : 'MEDIA_FAILED';
  await failJob(env, job, new AppError(code, String(report.message || 'Media processing failed.').slice(0, 300), 422));
}
