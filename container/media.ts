import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../shared/errors.js';
import { parseYouTubeUrl } from '../shared/youtube.js';
import type { MediaMetadata } from '../shared/types.js';
import { ExecError, run } from './exec.js';

export const BIN = {
  ytdlp: process.env.YTDLP_BIN ?? 'yt-dlp',
  ffmpeg: process.env.FFMPEG_BIN ?? 'ffmpeg',
  ffprobe: process.env.FFPROBE_BIN ?? 'ffprobe',
  python: process.env.PYTHON_BIN ?? 'python3',
};

const cancelled = () => new AppError('JOB_CANCELLED', 'Processing was cancelled.', 409);

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function classifyYtDlpError(error: unknown, fallback: AppError): AppError {
  if (error instanceof ExecError) {
    if (error.aborted) return cancelled();
    const text = error.stderr.toLowerCase();
    if (text.includes('private video') || text.includes('video unavailable') || text.includes('has been removed')) {
      return new AppError('VIDEO_UNAVAILABLE', 'Video is unavailable (private, removed, or region-locked).', 422);
    }
    if (text.includes('sign in to confirm') || text.includes('not a bot')) {
      return new AppError('YOUTUBE_BLOCKED', 'YouTube blocked automated access from the processing server. Add a YTDLP_COOKIES secret and retry.', 503);
    }
    if (text.includes('live event') || text.includes('is live')) return new AppError('VIDEO_IS_LIVE', 'Live streams cannot be processed until they have ended.', 422);
    if (text.includes('age')) return new AppError('VIDEO_AGE_RESTRICTED', 'Age-restricted videos need a YTDLP_COOKIES secret from a signed-in account.', 422);
  }
  return fallback;
}

export class YtDlp {
  constructor(private readonly cookiesFile: string | null) {}

  private baseArgs(): string[] {
    // yt-dlp needs a JavaScript runtime for YouTube; Node is already in the image.
    const args = ['--no-playlist', '--no-warnings', '--socket-timeout', '30', '--retries', '3', '--js-runtimes', 'node'];
    if (this.cookiesFile) args.push('--cookies', this.cookiesFile);
    return args;
  }

  async metadata(url: string, maxDuration: number, signal: AbortSignal): Promise<MediaMetadata> {
    const parsed = parseYouTubeUrl(url);
    try {
      const { stdout } = await run(BIN.ytdlp, [...this.baseArgs(), '--dump-single-json', '--skip-download', parsed.normalizedUrl], { timeoutMs: 120_000, signal, maxBuffer: 64 * 1024 * 1024 });
      const raw = JSON.parse(stdout) as Record<string, unknown>;
      if (raw.is_live === true) throw new AppError('VIDEO_IS_LIVE', 'Live streams cannot be processed until they have ended.', 422);
      const duration = asNumber(raw.duration) ?? 0;
      if (duration <= 0) throw new AppError('VIDEO_UNAVAILABLE', 'Video duration could not be determined.', 422);
      if (duration > maxDuration) throw new AppError('VIDEO_DURATION_LIMIT', `Video exceeds your plan duration limit (${Math.round(maxDuration / 60)} minutes).`, 402);
      return {
        sourceUrl: parsed.normalizedUrl,
        sourceId: parsed.videoId,
        title: String(raw.title ?? 'Untitled YouTube video').slice(0, 300),
        channel: String(raw.uploader ?? raw.channel ?? 'Unknown channel').slice(0, 200),
        durationSeconds: duration,
        thumbnailUrl: typeof raw.thumbnail === 'string' ? raw.thumbnail : `https://i.ytimg.com/vi/${parsed.videoId}/hqdefault.jpg`,
        description: typeof raw.description === 'string' ? raw.description.slice(0, 5000) : null,
        width: asNumber(raw.width),
        height: asNumber(raw.height),
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw classifyYtDlpError(error, new AppError('MEDIA_METADATA_FAILED', 'YouTube video could not be processed. Check that it is public and available.', 422));
    }
  }

  async download(url: string, outputPath: string, maxHeight: number, signal: AbortSignal): Promise<void> {
    const parsed = parseYouTubeUrl(url);
    try {
      await run(BIN.ytdlp, [
        ...this.baseArgs(),
        '--format', `bv*[height<=${maxHeight}][ext=mp4]+ba[ext=m4a]/bv*[height<=${maxHeight}]+ba/b[height<=${maxHeight}]/b`,
        '--merge-output-format', 'mp4',
        '--max-filesize', '6G',
        '--output', outputPath,
        parsed.normalizedUrl,
      ], { timeoutMs: 90 * 60_000, signal });
      await fs.access(outputPath);
    } catch (error) {
      throw classifyYtDlpError(error, new AppError('MEDIA_DOWNLOAD_FAILED', 'The source video could not be downloaded for processing.', 422));
    }
  }
}

export interface ProbeResult { width: number; height: number; duration: number; hasAudio: boolean; }

export async function probeMedia(file: string, signal?: AbortSignal): Promise<ProbeResult> {
  try {
    const { stdout } = await run(BIN.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { timeoutMs: 120_000, signal });
    const data = JSON.parse(stdout) as { streams?: Array<Record<string, unknown>>; format?: { duration?: string } };
    const video = data.streams?.find((stream) => stream.codec_type === 'video');
    if (!video) throw new AppError('MEDIA_INVALID', 'The source file has no video stream.', 422);
    const sideRotation = Array.isArray(video.side_data_list) ? Number((video.side_data_list as Array<Record<string, unknown>>).find((item) => 'rotation' in item)?.rotation ?? 0) : 0;
    const rotation = Math.abs(Number((video.tags as Record<string, unknown> | undefined)?.rotate ?? sideRotation ?? 0)) % 360;
    const width = Number(video.width);
    const height = Number(video.height);
    const rotated = rotation === 90 || rotation === 270;
    return {
      width: rotated ? height : width,
      height: rotated ? width : height,
      duration: Number(data.format?.duration ?? video.duration ?? 0),
      hasAudio: Boolean(data.streams?.some((stream) => stream.codec_type === 'audio')),
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof ExecError && error.aborted) throw cancelled();
    throw new AppError('MEDIA_INVALID', 'The source media could not be read.', 422);
  }
}

/**
 * Extracts speech-optimised audio (16 kHz mono MP3, ~1 MB per 4 minutes) split into fixed-length
 * chunks that Workers AI Whisper can transcribe one at a time.
 */
export async function extractAudioChunks(source: string, outDir: string, chunkSeconds: number, signal: AbortSignal): Promise<string[]> {
  await fs.mkdir(outDir, { recursive: true });
  try {
    await run(BIN.ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error', '-i', source, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k',
      '-f', 'segment', '-segment_time', String(chunkSeconds), '-reset_timestamps', '1', path.join(outDir, 'chunk-%04d.mp3'),
    ], { timeoutMs: 60 * 60_000, signal });
  } catch (error) {
    if (error instanceof ExecError && error.aborted) throw cancelled();
    throw new AppError('AUDIO_EXTRACTION_FAILED', 'Audio extraction failed. The video may not contain an audio track.', 422);
  }
  return (await fs.readdir(outDir)).filter((name) => name.endsWith('.mp3')).sort().map((name) => path.join(outDir, name));
}

/**
 * Stream-copies the clip window from the remote source into a small local file used only for face
 * detection. (The render itself reads the remote source directly with frame-accurate seeking.)
 */
export async function cutSample(sourceUrl: string, start: number, duration: number, outputPath: string, signal: AbortSignal): Promise<void> {
  try {
    await run(BIN.ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error', '-ss', start.toFixed(3), '-i', sourceUrl, '-t', duration.toFixed(3),
      '-map', '0:v:0', '-an', '-c', 'copy', '-avoid_negative_ts', 'make_zero', outputPath,
    ], { timeoutMs: 30 * 60_000, signal });
  } catch (error) {
    if (error instanceof ExecError && error.aborted) throw cancelled();
    throw new AppError('SOURCE_READ_FAILED', 'The source video could not be read from storage. Please retry.', 503, true);
  }
}

const FACE_SCRIPT = process.env.FACE_SCRIPT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'face_center.py');

export interface FaceFocus { found: number; x: number; y: number; }

/** Median dominant-face position (0-1) inside the window, or null when OpenCV finds no face. */
export async function detectFaceFocus(file: string, start: number, end: number, signal: AbortSignal): Promise<FaceFocus | null> {
  try {
    const { stdout } = await run(BIN.python, [FACE_SCRIPT, file, String(start), String(end)], { timeoutMs: 5 * 60_000, signal });
    const result = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as Partial<FaceFocus>;
    if (!result.found || typeof result.x !== 'number' || typeof result.y !== 'number') return null;
    return { found: result.found, x: result.x, y: result.y };
  } catch (error) {
    if (error instanceof ExecError && error.aborted) throw cancelled();
    return null;
  }
}
