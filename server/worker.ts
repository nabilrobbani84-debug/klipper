import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Worker, type Job } from 'bullmq';
import { loadConfig } from './config.js';
import { PostgresProjectRepository } from './db.js';
import { createLogger } from './logger.js';
import { createRedisConnection, QUEUE_NAME } from './queue.js';
import { YtDlpMediaProvider } from './services/youtube.js';
import { WhisperCliTranscriptionProvider } from './services/transcription.js';
import { GeminiAIProvider } from './services/ai.js';
import { FfmpegRenderProvider } from './services/render.js';
import { LocalObjectStorage } from './services/storage.js';
import { AppError } from './errors.js';
import type { AnalysisJobPayload, JobState, QueuePayload, RenderJobPayload } from './types.js';

const execFileAsync = promisify(execFile);
const config = loadConfig();
const logger = createLogger(config);
const repository = new PostgresProjectRepository(config);
const connection = createRedisConnection(config);
const media = new YtDlpMediaProvider(config);
const transcription = new WhisperCliTranscriptionProvider(config);
const ai = new GeminiAIProvider(config);
const renderer = new FfmpegRenderProvider(config);
const storage = new LocalObjectStorage(config);

async function update(jobId: string, state: JobState, progress: number, message: string) {
  await repository.updateJob(jobId, { state, progress, message });
}

async function extractAudio(sourcePath: string, outputPath: string) {
  try {
    await execFileAsync(config.FFMPEG_BIN, ['-y', '-i', sourcePath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outputPath], { timeout: 10 * 60_000, maxBuffer: 2 * 1024 * 1024 });
  } catch {
    throw new AppError('AUDIO_EXTRACTION_FAILED', 'Audio extraction failed. Please retry the job.', 422);
  }
}

async function ensureNotCancelled(jobId: string) {
  if (await repository.isJobCancelled(jobId)) throw new AppError('JOB_CANCELLED', 'Processing was cancelled.', 409);
}

async function processAnalysis(job: Job<AnalysisJobPayload>) {
  const payload = job.data;
  const tempDir = path.resolve(config.TEMP_DIR, payload.jobId);
  const sourcePath = path.join(tempDir, 'source.mp4');
  const audioPath = path.join(tempDir, 'audio.wav');
  try {
    await fs.mkdir(tempDir, { recursive: true });
    await ensureNotCancelled(payload.jobId);
    await update(payload.jobId, 'DOWNLOADING', 10, 'Fetching YouTube metadata and source media.');
    const metadata = await media.getMetadata(payload.sourceUrl);
    await repository.updateProjectMetadata(payload.projectId, metadata);
    await ensureNotCancelled(payload.jobId);
    await media.download(payload.sourceUrl, sourcePath);
    await update(payload.jobId, 'EXTRACTING_AUDIO', 25, 'Extracting audio for transcription.');
    await extractAudio(sourcePath, audioPath);
    await ensureNotCancelled(payload.jobId);
    await update(payload.jobId, 'TRANSCRIBING', 45, 'Generating a word-timestamped transcript.');
    const transcript = await transcription.transcribe(audioPath, tempDir);
    await repository.updateProjectTranscript(payload.projectId, transcript);
    await ensureNotCancelled(payload.jobId);
    await update(payload.jobId, 'ANALYZING', 65, 'Analyzing transcript for complete clip moments.');
    const clips = await ai.detectClips({ transcript, title: metadata.title, preferredDuration: payload.preferredDuration, requestedClipCount: payload.requestedClipCount });
    await ensureNotCancelled(payload.jobId);
    await update(payload.jobId, 'GENERATING_CLIPS', 85, 'Persisting clip candidates.');
    await repository.saveClips(payload.projectId, clips);
    await update(payload.jobId, 'COMPLETED', 100, 'Clip candidates are ready for editing and export.');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch((error) => logger.warn({ error, jobId: payload.jobId }, 'temporary cleanup failed'));
  }
}

async function processRender(job: Job<RenderJobPayload>) {
  const payload = job.data;
  const tempDir = path.resolve(config.TEMP_DIR, payload.jobId);
  const sourcePath = path.join(tempDir, 'source.mp4');
  const outputPath = path.join(tempDir, 'output.mp4');
  try {
    await fs.mkdir(tempDir, { recursive: true });
    await ensureNotCancelled(payload.jobId);
    const project = await repository.getProject(payload.userId, payload.projectId);
    if (!project) throw new AppError('PROJECT_NOT_FOUND', 'Project not found.', 404);
    const clip = project.clips.find((item) => item.id === payload.clipId);
    if (!clip) throw new AppError('CLIP_NOT_FOUND', 'Clip not found.', 404);
    await update(payload.jobId, 'DOWNLOADING', 15, 'Preparing source media for rendering.');
    await media.download(project.sourceUrl, sourcePath);
    await ensureNotCancelled(payload.jobId);
    await update(payload.jobId, 'RENDERING', 55, 'Rendering H.264/AAC output with FFmpeg.');
    await renderer.renderClip({ sourcePath, outputPath, start: clip.start, duration: clip.duration, aspectRatio: payload.aspectRatio, quality: payload.quality });
    await ensureNotCancelled(payload.jobId);
    await update(payload.jobId, 'UPLOADING', 85, 'Storing rendered export.');
    const key = `users/${payload.userId}/projects/${payload.projectId}/exports/${payload.jobId}.mp4`;
    const stored = await storage.put(outputPath, key, 'video/mp4');
    await repository.saveExport({ userId: payload.userId, projectId: payload.projectId, clipId: payload.clipId, storageKey: stored.key, contentType: stored.contentType, sizeBytes: stored.sizeBytes });
    await update(payload.jobId, 'COMPLETED', 100, 'Export is ready.');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch((error) => logger.warn({ error, jobId: payload.jobId }, 'temporary cleanup failed'));
  }
}

async function process(job: Job<QueuePayload>) {
  try {
    if (job.data.kind === 'analysis') return await processAnalysis(job as Job<AnalysisJobPayload>);
    return await processRender(job as Job<RenderJobPayload>);
  } catch (error) {
    const appError = error instanceof AppError ? error : new AppError('JOB_FAILED', 'Processing failed. Please retry the job.', 422);
    const cancelled = appError.code === 'JOB_CANCELLED';
    await repository.updateJob(job.data.jobId, { state: cancelled ? 'CANCELLED' : 'FAILED', progress: cancelled ? 0 : 100, message: appError.message, errorCode: appError.code });
    if (job.data.kind === 'analysis' && !cancelled) await repository.markProjectFailed(job.data.projectId);
    if (cancelled) return;
    throw error;
  }
}

const worker = new Worker<QueuePayload>(QUEUE_NAME, process, { connection, concurrency: config.JOB_CONCURRENCY, limiter: { max: config.JOB_CONCURRENCY, duration: 1000 } });
worker.on('completed', (job) => logger.info({ jobId: job.id }, 'processing job completed'));
worker.on('failed', (job, error) => logger.error({ jobId: job?.id, error }, 'processing job failed'));
logger.info({ concurrency: config.JOB_CONCURRENCY }, 'ClipForge worker listening');

async function shutdown(signal: string) {
  logger.info({ signal }, 'worker shutting down');
  await worker.close();
  await connection.quit();
  await repository.pool.end();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
