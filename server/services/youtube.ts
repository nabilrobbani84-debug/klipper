import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { MediaMetadata } from '../types.js';
import { ExecError, run } from './exec.js';

const ALLOWED_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Server-side URL validation. Only canonical YouTube hosts are accepted and the URL is rebuilt
 * from the extracted video ID, so nothing user-controlled other than the ID reaches yt-dlp (SSRF guard).
 */
export function parseYouTubeUrl(value: string): { normalizedUrl: string; videoId: string } {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AppError('INVALID_YOUTUBE_URL', 'Enter a valid YouTube URL.', 400);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new AppError('INVALID_YOUTUBE_URL', 'Only YouTube web links are accepted.', 400);
  if (url.username || url.password || url.port) throw new AppError('INVALID_YOUTUBE_URL', 'The YouTube URL contains unsupported components.', 400);
  const hostname = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(hostname)) throw new AppError('INVALID_YOUTUBE_URL', 'Only youtube.com and youtu.be URLs are supported.', 400);

  const parts = url.pathname.split('/').filter(Boolean);
  let videoId = '';
  if (hostname.endsWith('youtu.be')) videoId = parts[0] ?? '';
  else if (url.pathname === '/watch') videoId = url.searchParams.get('v') ?? '';
  else if (['shorts', 'embed', 'live', 'v'].includes(parts[0] ?? '')) videoId = parts[1] ?? '';
  if (!VIDEO_ID.test(videoId)) throw new AppError('INVALID_YOUTUBE_URL', 'The URL does not contain a valid YouTube video ID.', 400);
  return { normalizedUrl: `https://www.youtube.com/watch?v=${videoId}`, videoId };
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function classifyYtDlpError(error: unknown, fallback: AppError): AppError {
  if (error instanceof ExecError) {
    if (error.aborted) return new AppError('JOB_CANCELLED', 'Processing was cancelled.', 409);
    const text = error.stderr.toLowerCase();
    if (text.includes('private video') || text.includes('video unavailable') || text.includes('has been removed')) {
      return new AppError('VIDEO_UNAVAILABLE', 'Video is unavailable (private, removed, or region-locked).', 422);
    }
    if (text.includes('sign in to confirm') || text.includes('bot')) {
      return new AppError('YOUTUBE_BLOCKED', 'YouTube blocked automated access from this server. Configure YTDLP_COOKIES_FILE and retry.', 503);
    }
    if (text.includes('live event') || text.includes('is live')) {
      return new AppError('VIDEO_IS_LIVE', 'Live streams cannot be processed until they have ended.', 422);
    }
  }
  return fallback;
}

export interface MediaProvider {
  getMetadata(url: string, signal?: AbortSignal): Promise<MediaMetadata>;
  download(url: string, outputPath: string, signal?: AbortSignal): Promise<void>;
}

export class YtDlpMediaProvider implements MediaProvider {
  constructor(private readonly config: AppConfig) {}

  private baseArgs(): string[] {
    const args = ['--no-playlist', '--no-warnings', '--socket-timeout', '30', '--retries', '3'];
    if (this.config.YTDLP_COOKIES_FILE) args.push('--cookies', this.config.YTDLP_COOKIES_FILE);
    return args;
  }

  async getMetadata(url: string, signal?: AbortSignal): Promise<MediaMetadata> {
    const parsed = parseYouTubeUrl(url);
    try {
      const { stdout } = await run(this.config.YTDLP_BIN, [...this.baseArgs(), '--dump-single-json', '--skip-download', parsed.normalizedUrl], { timeoutMs: 90_000, signal, maxBuffer: 32 * 1024 * 1024 });
      const raw = JSON.parse(stdout) as Record<string, unknown>;
      if (raw.is_live === true) throw new AppError('VIDEO_IS_LIVE', 'Live streams cannot be processed until they have ended.', 422);
      const duration = asNumber(raw.duration) ?? 0;
      if (duration <= 0) throw new AppError('VIDEO_UNAVAILABLE', 'Video duration could not be determined.', 422);
      if (duration > this.config.MAX_VIDEO_DURATION_SECONDS) throw new AppError('VIDEO_DURATION_LIMIT', 'This video exceeds the maximum duration allowed by the service.', 422);
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
        formats: Array.isArray(raw.formats)
          ? raw.formats.slice(-60).map((format) => {
            const item = format as Record<string, unknown>;
            return {
              formatId: String(item.format_id ?? ''), ext: String(item.ext ?? ''), width: asNumber(item.width) ?? undefined,
              height: asNumber(item.height) ?? undefined, vcodec: String(item.vcodec ?? ''), acodec: String(item.acodec ?? ''),
            };
          })
          : [],
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw classifyYtDlpError(error, new AppError('MEDIA_METADATA_FAILED', 'YouTube video could not be processed. Check that it is public and available.', 422));
    }
  }

  async download(url: string, outputPath: string, signal?: AbortSignal): Promise<void> {
    const parsed = parseYouTubeUrl(url);
    const height = this.config.YTDLP_MAX_HEIGHT;
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    try {
      await run(this.config.YTDLP_BIN, [
        ...this.baseArgs(),
        '--format', `bv*[height<=${height}][ext=mp4]+ba[ext=m4a]/bv*[height<=${height}]+ba/b[height<=${height}]/b`,
        '--merge-output-format', 'mp4',
        '--max-filesize', '4G',
        '--output', outputPath,
        parsed.normalizedUrl,
      ], { timeoutMs: 60 * 60_000, signal });
      await fs.access(outputPath);
    } catch (error) {
      throw classifyYtDlpError(error, new AppError('MEDIA_DOWNLOAD_FAILED', 'The source video could not be downloaded for processing.', 422));
    }
  }
}
