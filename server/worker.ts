import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Worker, type Job } from 'bullmq';
import { loadConfig } from './config.js';
import { Repository } from './db.js';
import { AppError, toAppError } from './errors.js';
import { createLogger } from './logger.js';
import { createRedisConnection, QUEUE_NAME } from './queue.js';
import { GeminiAIProvider } from './services/ai.js';
import { buildAssSubtitles, DEFAULT_CAPTION_SETTINGS } from './services/captions.js';
import { computeCrop, detectFaceFocus, outputSize } from './services/reframe.js';
import { extractAudio, FfmpegRenderProvider, probeMedia } from './services/render.js';
import { createObjectStorage } from './services/storage.js';
import { WhisperCliTranscriptionProvider } from './services/transcription.js';
import { YtDlpMediaProvider } from './services/youtube.js';
import {
  isAspectRatio,
  TERMINAL_JOB_STATES,
  type AnalysisJobPayload,
  type AspectRatio,
  type AudioSettings,
  type CaptionSettings,
  type ClipCandidate,
  type JobState,
  type QueuePayload,
  type ReframingSettings,
  type RenderJobPayload,
} from './types.js';

const config = loadConfig();
const logger = createLogger(config);
const repository = new Repository(config);
const connection = createRedisConnection(config);
const storage = createObjectStorage(config);
const media = new YtDlpMediaProvider(config);
const transcription = new WhisperCliTranscriptionProvider(config);
const ai = new GeminiAIProvider(config, (message, error) => logger.warn({ err: error }, message));
const renderer = new FfmpegRenderProvider(config, (stderr) => logger.error({ stderr }, 'ffmpeg failed'));

const DEFAULT_REFRAMING: ReframingSettings = { mode: 'center', panX: 50, panY: 50, zoom: 1 };
const DEFAULT_AUDIO: AudioSettings = { noiseReduction: false, voiceEnhance: false, compressor: false, loudnessNorm: true, volume: 100 };
const cancelled = () => new AppError('JOB_CANCELLED', 'Processing was cancelled.', 409);

async function progress(jobId: string, state: JobState, percent: number, message: string, signal: AbortSignal) {
  if (signal.aborted) throw cancelled();
  const stillActive = await repository.updateJobProgress(jobId, state, percent, message);
  if (!stillActive) throw cancelled();
}

/** Runs work with an AbortSignal that fires when the user cancels the job (polled from the database). */
async function withCancellation<T>(jobId: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setInterval(() => {
    repository.isJobCancelled(jobId).then((isCancelled) => {
      if (isCancelled) controller.abort();
    }).catch(() => undefined);
  }, 3000);
  try {
    return await work(controller.signal);
  } finally {
    clearInterval(timer);
  }
}

async function tempDirFor(jobId: string) {
  const dir = path.resolve(config.TEMP_DIR, jobId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function processAnalysis(payload: AnalysisJobPayload, signal: AbortSignal) {
  const dir = await tempDirFor(payload.jobId);
  const sourcePath = path.join(dir, 'source.mp4');
  const audioPath = path.join(dir, 'audio.wav');
  try {
    await progress(payload.jobId, 'DOWNLOADING', 3, 'Validating video and fetching metadata…', signal);
    const metadata = await media.getMetadata(payload.sourceUrl, signal);
    const plan = await repository.getPlanEntitlements(payload.userId);
    if (metadata.durationSeconds > plan.maxVideoDurationSeconds) {
      throw new AppError('VIDEO_DURATION_LIMIT', `Video exceeds your ${plan.code} plan duration limit (${Math.round(plan.maxVideoDurationSeconds / 60)} minutes).`, 402);
    }
    await repository.updateProjectMetadata(payload.projectId, metadata);

    await progress(payload.jobId, 'DOWNLOADING', 10, 'Downloading video…', signal);
    await media.download(payload.sourceUrl, sourcePath, signal);
    const probe = await probeMedia(config, sourcePath, signal);
    if (!probe.hasAudio) throw new AppError('NO_AUDIO', 'This video has no audio track, so it cannot be transcribed.', 422);
    const sourceKey = `users/${payload.userId}/sources/${payload.projectId}.mp4`;
    await storage.put(sourcePath, sourceKey, 'video/mp4');
    await repository.saveSourceStorage(payload.projectId, sourceKey);

    await progress(payload.jobId, 'EXTRACTING_AUDIO', 22, 'Extracting audio…', signal);
    await extractAudio(config, sourcePath, audioPath, signal);

    await progress(payload.jobId, 'TRANSCRIBING', 30, 'Generating transcript with word-level timestamps (longest step)…', signal);
    const transcript = await transcription.transcribe(audioPath, dir, signal);
    await repository.updateProjectTranscript(payload.projectId, transcript);

    await progress(payload.jobId, 'ANALYZING', 72, 'Finding the strongest moments…', signal);
    const { clips, provider } = await ai.detectClips({
      transcript, title: metadata.title, videoDuration: probe.duration || metadata.durationSeconds,
      preferredDuration: payload.preferredDuration, requestedClipCount: payload.requestedClipCount,
      contentGoal: payload.contentGoal, hookType: payload.hookType,
    });
    if (provider === 'gemini') await repository.recordApiUsage(payload.userId, 'gemini', { model: config.GEMINI_MODEL, projectId: payload.projectId });

    await progress(payload.jobId, 'REFRAMING', 85, 'Detecting speakers for auto-reframe…', signal);
    const job = await repository.getJobById(payload.jobId);
    const requestedAspect = job?.metadata.aspectRatio;
    const aspectRatio: AspectRatio = isAspectRatio(requestedAspect) ? requestedAspect : '9:16';
    const withEditor: ClipCandidate[] = [];
    for (const clip of clips) {
      const face = await detectFaceFocus(config, sourcePath, clip.start, clip.end, signal);
      const reframing: ReframingSettings = face
        ? { mode: 'face', panX: Math.round(face.x * 100), panY: Math.round(face.y * 100), zoom: 1 }
        : { ...DEFAULT_REFRAMING };
      withEditor.push({ ...clip, editor: { aspectRatio, reframing } });
    }

    await progress(payload.jobId, 'GENERATING_CLIPS', 95, 'Saving clip candidates…', signal);
    await repository.saveClips(payload.projectId, withEditor);
    await repository.finishJob(payload.jobId, 'COMPLETED', `${withEditor.length} clip${withEditor.length === 1 ? '' : 's'} ready for editing.`, null, { provider, clipCount: withEditor.length });
    logger.info({ jobId: payload.jobId, projectId: payload.projectId, clips: withEditor.length, provider }, 'analysis completed');
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch((error) => logger.warn({ err: error, jobId: payload.jobId }, 'temp cleanup failed'));
  }
}

async function processRender(payload: RenderJobPayload, signal: AbortSignal) {
  const dir = await tempDirFor(payload.jobId);
  const sourcePath = path.join(dir, 'source.mp4');
  const extension = payload.format === 'mov' ? 'mov' : 'mp4';
  const outputPath = path.join(dir, `output.${extension}`);
  const subtitlePath = path.join(dir, 'captions.ass');
  try {
    const project = await repository.getProject(payload.userId, payload.projectId);
    if (!project) throw new AppError('PROJECT_NOT_FOUND', 'Project not found.', 404);
    const clip = project.clips.find((item) => item.id === payload.clipId);
    if (!clip) throw new AppError('CLIP_NOT_FOUND', 'Clip not found.', 404);
    const plan = await repository.getPlanEntitlements(payload.userId);

    await progress(payload.jobId, 'DOWNLOADING', 8, 'Preparing source media…', signal);
    const sourceKey = await repository.getSourceStorageKey(project.id);
    if (sourceKey && (await storage.size(sourceKey)) !== null) {
      await storage.download(sourceKey, sourcePath);
    } else {
      await media.download(project.sourceUrl, sourcePath, signal);
      const key = `users/${payload.userId}/sources/${project.id}.mp4`;
      await storage.put(sourcePath, key, 'video/mp4');
      await repository.saveSourceStorage(project.id, key);
    }
    const probe = await probeMedia(config, sourcePath, signal);

    const editor = clip.editor ?? {};
    const reframing: ReframingSettings = { ...DEFAULT_REFRAMING, ...(editor.reframing ?? {}) };
    const captions: CaptionSettings = { ...DEFAULT_CAPTION_SETTINGS, ...(editor.captions ?? {}) };
    const audio: AudioSettings = { ...DEFAULT_AUDIO, ...(editor.audio ?? {}) };

    await progress(payload.jobId, 'REFRAMING', 18, 'Calculating reframe…', signal);
    if (reframing.mode === 'face' || reframing.mode === 'speaker') {
      const face = await detectFaceFocus(config, sourcePath, clip.start, clip.end, signal);
      if (face) {
        reframing.panX = Math.round(face.x * 100);
        reframing.panY = Math.round(face.y * 100);
      }
    }
    const crop = computeCrop(probe, payload.aspectRatio, reframing);
    const size = outputSize(payload.aspectRatio, payload.resolution);

    let subtitles: string | undefined;
    if (captions.enabled && project.transcript) {
      await progress(payload.jobId, 'GENERATING_CAPTIONS', 28, 'Generating synchronized captions…', signal);
      await fs.writeFile(subtitlePath, buildAssSubtitles(project.transcript, clip, captions, { ...size, fontFamily: captions.fontFamily }), 'utf8');
      subtitles = subtitlePath;
    }

    await progress(payload.jobId, 'RENDERING', 40, `Rendering ${payload.resolution} ${payload.aspectRatio} with FFmpeg…`, signal);
    await renderer.renderClip({
      sourcePath, outputPath, start: clip.start, duration: clip.end - clip.start, crop, options: payload,
      subtitlePath: subtitles, watermarkText: plan.watermark ? config.WATERMARK_TEXT : undefined, audio, hasAudio: probe.hasAudio,
    }, signal);

    await progress(payload.jobId, 'UPLOADING', 92, 'Uploading export…', signal);
    const contentType = extension === 'mov' ? 'video/quicktime' : 'video/mp4';
    const stored = await storage.put(outputPath, `users/${payload.userId}/projects/${project.id}/exports/${payload.jobId}.${extension}`, contentType);
    const exportId = await repository.saveExport({
      userId: payload.userId, projectId: project.id, clipId: clip.id, jobId: payload.jobId, storageKey: stored.key, contentType, sizeBytes: stored.sizeBytes,
      settings: { resolution: payload.resolution, fps: payload.fps, format: payload.format, codec: payload.codec, aspectRatio: payload.aspectRatio, width: size.width, height: size.height, duration: clip.end - clip.start, watermark: plan.watermark },
    });
    await repository.finishJob(payload.jobId, 'COMPLETED', 'Export is ready to download.', null, { exportId });
    logger.info({ jobId: payload.jobId, exportId, bytes: stored.sizeBytes }, 'render completed');
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch((error) => logger.warn({ err: error, jobId: payload.jobId }, 'temp cleanup failed'));
  }
}

async function handleJob(job: Job<QueuePayload>) {
  const payload = job.data;
  const current = await repository.getJobById(payload.jobId);
  if (!current || TERMINAL_JOB_STATES.includes(current.state)) {
    logger.info({ jobId: payload.jobId, state: current?.state }, 'skipping inactive job');
    return;
  }
  const started = Date.now();
  try {
    await withCancellation(payload.jobId, (signal) => (payload.kind === 'analysis' ? processAnalysis(payload, signal) : processRender(payload, signal)));
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'JOB_CANCELLED') {
      await repository.finishJob(payload.jobId, 'CANCELLED', 'Cancelled by user.', null);
      logger.info({ jobId: payload.jobId }, 'job cancelled');
      return;
    }
    logger.error({ err: error, jobId: payload.jobId, userId: payload.userId, kind: payload.kind, errorCode: appError.code }, 'job failed');
    await repository.finishJob(payload.jobId, 'FAILED', appError.message, appError.code);
    if (payload.kind === 'analysis') {
      await repository.setProjectStatus(payload.projectId, 'FAILED');
      await repository.refundCredit(payload.userId, payload.jobId);
    }
    throw error;
  } finally {
    logger.info({ jobId: payload.jobId, kind: payload.kind, seconds: Math.round((Date.now() - started) / 1000) }, 'job finished');
  }
}

await fs.mkdir(path.resolve(config.TEMP_DIR), { recursive: true });
const worker = new Worker<QueuePayload>(QUEUE_NAME, handleJob, {
  connection,
  concurrency: config.JOB_CONCURRENCY,
  lockDuration: 120_000,
  maxStalledCount: 1,
});
worker.on('error', (error) => logger.error({ err: error }, 'worker error'));
logger.info({ concurrency: config.JOB_CONCURRENCY }, 'ClipForge worker started');

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'worker shutting down (waiting for active jobs)');
  await worker.close();
  await connection.quit().catch(() => undefined);
  await repository.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
