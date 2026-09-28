import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';
import type { MediaMetadata } from '../types.js';

const execFileAsync = promisify(execFile);

export function parseYouTubeUrl(value: string): { normalizedUrl: string; videoId: string } {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new AppError('INVALID_YOUTUBE_URL', 'Enter a valid YouTube URL.', 400); }
  if (url.protocol !== 'https:') throw new AppError('INVALID_YOUTUBE_URL', 'Only HTTPS YouTube URLs are accepted.', 400);
  if (url.username || url.password || url.port) throw new AppError('INVALID_YOUTUBE_URL', 'The YouTube URL contains unsupported components.', 400);
  const hostname = url.hostname.toLowerCase();
  const allowed = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);
  if (!allowed.has(hostname)) throw new AppError('INVALID_YOUTUBE_URL', 'Only youtube.com and youtu.be URLs are supported.', 400);

  let videoId = '';
  if (hostname.includes('youtu.be')) videoId = url.pathname.split('/').filter(Boolean)[0] ?? '';
  else if (url.pathname === '/watch') videoId = url.searchParams.get('v') ?? '';
  else if (url.pathname.startsWith('/shorts/')) videoId = url.pathname.split('/')[2] ?? '';
  else if (url.pathname.startsWith('/embed/')) videoId = url.pathname.split('/')[2] ?? '';
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new AppError('INVALID_YOUTUBE_URL', 'The URL does not contain a valid YouTube video ID.', 400);
  return { normalizedUrl: `https://www.youtube.com/watch?v=${videoId}`, videoId };
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export interface MediaProvider {
  getMetadata(url: string): Promise<MediaMetadata>;
  download(url: string, outputPath: string): Promise<void>;
}

export class YtDlpMediaProvider implements MediaProvider {
  constructor(private readonly config: AppConfig) {}

  async getMetadata(url: string): Promise<MediaMetadata> {
    const parsed = parseYouTubeUrl(url);
    try {
      const { stdout } = await execFileAsync(this.config.YTDLP_BIN, [
        '--dump-single-json', '--skip-download', '--no-playlist', '--no-warnings', '--socket-timeout', '20', parsed.normalizedUrl,
      ], { timeout: 60_000, maxBuffer: 12 * 1024 * 1024 });
      const raw = JSON.parse(stdout) as Record<string, unknown>;
      const duration = asNumber(raw.duration) ?? 0;
      if (duration <= 0 || duration > this.config.MAX_VIDEO_DURATION_SECONDS) {
        throw new AppError('VIDEO_DURATION_LIMIT', 'This video exceeds the maximum duration allowed by the service.', 422);
      }
      return {
        sourceUrl: parsed.normalizedUrl, sourceId: parsed.videoId, title: String(raw.title ?? 'Untitled YouTube video'),
        channel: String(raw.uploader ?? raw.channel ?? 'Unknown channel'), durationSeconds: duration,
        thumbnailUrl: typeof raw.thumbnail === 'string' ? raw.thumbnail : null,
        description: typeof raw.description === 'string' ? raw.description : null,
        width: asNumber(raw.width), height: asNumber(raw.height),
        formats: Array.isArray(raw.formats) ? raw.formats.slice(0, 100).map((format) => {
          const item = format as Record<string, unknown>;
          return { formatId: String(item.format_id ?? ''), ext: String(item.ext ?? ''), width: asNumber(item.width) ?? undefined,
            height: asNumber(item.height) ?? undefined, vcodec: String(item.vcodec ?? ''), acodec: String(item.acodec ?? '') };
        }) : [],
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('MEDIA_METADATA_FAILED', 'YouTube video metadata could not be fetched. Check that the video is public and available.', 422);
    }
  }

  async download(url: string, outputPath: string): Promise<void> {
    const parsed = parseYouTubeUrl(url);
    try {
      await execFileAsync(this.config.YTDLP_BIN, [
        '--no-playlist', '--no-warnings', '--socket-timeout', '20', '--format', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
        '--merge-output-format', 'mp4', '--output', outputPath, parsed.normalizedUrl,
      ], { timeout: 20 * 60_000, maxBuffer: 4 * 1024 * 1024 });
    } catch {
      throw new AppError('MEDIA_DOWNLOAD_FAILED', 'The source video could not be downloaded for processing.', 422);
    }
  }
}
