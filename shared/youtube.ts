import { AppError } from './errors.js';

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
